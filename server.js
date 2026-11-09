const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1); // Render vb. proxy arkasında https'i doğru algılamak için

// --- OTURUM ÇEREZİ (imzalı, ek paket gerektirmez) ---
if (!process.env.SESSION_SECRET) {
    console.warn("⚠️ SESSION_SECRET tanımlı değil; çerez imzası MONGO_URI üzerinden üretiliyor. Ayrı bir SESSION_SECRET eklemeniz önerilir.");
}
const OTURUM_SECRET = process.env.SESSION_SECRET || process.env.MONGO_URI || 'degistir-beni';
const OTURUM_SURESI_MS = 1000 * 60 * 60 * 24 * 30;      // "Beni hatırla" işaretliyse: 30 gün
// "Beni hatırla" işaretli değilse: 15 dakika işlem yapılmazsa oturum biter (her işlemde süre yenilenir).
// Telefon tarayıcıları kapatılan sekmeleri ve oturum çerezlerini geri yüklediği için
// sunucu "tarayıcı kapandı mı" bilemez; bu yüzden işlem yapılmayan süreye bakılır.
const KISA_OTURUM_SURESI_MS = 1000 * 60 * 15;

function oturumImzala(deger) {
    return crypto.createHmac('sha256', OTURUM_SECRET).update(deger).digest('hex');
}

function oturumCerezOlustur(email, kalici) {
    const payload = Buffer.from(JSON.stringify({ e: email, t: Date.now(), k: kalici ? 1 : 0 })).toString('base64url');
    return `${payload}.${oturumImzala(payload)}`;
}

function oturumOku(req) {
    const header = req.headers.cookie || '';
    const parca = header.split(';').map(s => s.trim()).find(s => s.startsWith('oturum='));
    if (!parca) return null;
    const deger = decodeURIComponent(parca.substring('oturum='.length));
    const [payload, imza] = deger.split('.');
    if (!payload || !imza) return null;

    const beklenen = oturumImzala(payload);
    const a = Buffer.from(imza);
    const b = Buffer.from(beklenen);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    try {
        const veri = JSON.parse(Buffer.from(payload, 'base64url').toString());
        // k alanı olmayan eski çerezler (bu özellikten önce verilenler) kalıcı sayılır
        const kalici = veri.k !== 0;
        const sure = kalici ? OTURUM_SURESI_MS : KISA_OTURUM_SURESI_MS;
        if (Date.now() - veri.t > sure) return null;
        return { email: veri.e, kalici };
    } catch (e) {
        return null;
    }
}

function oturumEmailOku(req) {
    const oturum = oturumOku(req);
    return oturum ? oturum.email : null;
}

function oturumCerezYaz(req, res, email, kalici) {
    const secure = req.secure ? '; Secure' : '';
    // Max-Age yoksa tarayıcı çerezi oturum çerezi sayar ve tarayıcı kapanınca siler
    const omur = kalici ? `; Max-Age=${OTURUM_SURESI_MS / 1000}` : '';
    res.setHeader('Set-Cookie', `oturum=${encodeURIComponent(oturumCerezOlustur(email, kalici))}; Path=/; HttpOnly; SameSite=Lax${omur}${secure}`);
}

function oturumCerezSil(req, res) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `oturum=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

// API için oturum doğrulama: e-posta istemciden değil, imzalı çerezden alınır
async function oturumGerekli(req, res, next) {
    const oturum = oturumOku(req);
    if (!oturum) {
        return res.status(401).json({ success: false, message: "Oturum süresi doldu, lütfen tekrar giriş yapın." });
    }
    // Hesap silinmişse eski çerez artık işlem yapamaz
    try {
        if (!(await User.exists({ email: oturum.email }))) {
            oturumCerezSil(req, res);
            return res.status(401).json({ success: false, message: "Hesap bulunamadı, lütfen tekrar giriş yapın." });
        }
    } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false, message: "Sunucu hatası." });
    }
    req.oturumEmail = oturum.email;
    // Kısa oturumlarda her işlem süreyi yeniler (işlem yapıldığı sürece oturum açık kalır)
    if (!oturum.kalici) oturumCerezYaz(req, res, oturum.email, false);
    next();
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
// Panel dosyaları public/ içinde aranır; bulunamazsa proje kökünde de aranır.
// Hiçbiri yoksa sebebi açıkça loglanır.
['panel.css', 'panel.js'].forEach(ad => {
    app.get('/' + ad, (req, res) => {
        const adaylar = [path.join(__dirname, 'public', ad), path.join(__dirname, ad)];
        const bulunan = adaylar.find(p => fs.existsSync(p));
        if (!bulunan) {
            console.error(`❌ ${ad} bulunamadı. Aranan yerler: ${adaylar.join(' , ')}`);
            return res.status(404).send(`/* ${ad} sunucuda bulunamadi */`);
        }
        res.set('Cache-Control', 'no-cache');
        res.sendFile(bulunan);
    });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false })); // '/' adresini aşağıdaki rota yönetir

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, { dbName: 'ucusDB' })
  .then(() => console.log("✔️ [BAŞARILI] ucusDB bağlantısı aktif."))
  .catch(err => console.error("❌ Bağlantı Hatası: ", err));

// --- MONGODB ŞEMALARI ---

const UserSchema = new mongoose.Schema({
    email: String,
    password: String,
    // Kişisel bilgiler (hepsi isteğe bağlı; yalnızca kullanıcının kendisi görür/değiştirir)
    profil: {
        adSoyad: String,
        boy: Number,
        kilo: Number,
        dogumTarihi: String,
        kanGrubu: String
    }
});
const User = mongoose.model('User', UserSchema, 'users');

const ReportDateSchema = new mongoose.Schema({
    userEmail: String,
    alan: String,
    tarih: String
});
const ReportDate = mongoose.model('ReportDate', ReportDateSchema, 'report_dates');

const FlightSchema = new mongoose.Schema({
    userEmail: String,
    tarih: String,
    havaAraciTipi: String,
    egitimTipi: String,
    sure: String,
    gorevAciklamasi: String
});
const Flight = mongoose.model('Flight', FlightSchema, 'flights');

// Yönetici işlemlerinin kaydı (kim, ne zaman, neyi değiştirdi)
const AdminLogSchema = new mongoose.Schema({
    admin: String,
    islem: String,
    hedef: String,
    detay: String,
    zaman: { type: Date, default: Date.now }
});
const AdminLog = mongoose.model('AdminLog', AdminLogSchema, 'admin_logs');

// Yönetici hesapları: ADMIN_EMAIL ortam değişkeni (virgülle birden fazla yazılabilir)
const ADMIN_EMAILLERI = (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
if (!ADMIN_EMAILLERI.length) {
    console.warn("⚠️ ADMIN_EMAIL tanımlı değil; yönetim paneli kapalı.");
}
function adminMi(email) {
    return !!email && ADMIN_EMAILLERI.includes(String(email).toLowerCase());
}


// --- SABİTLER ---

const DONEM_HEDEF_SAAT = 140;
const IZINLI_TARIH_ALANLARI = ['muayene1Tarih', 'muayene4Tarih', 'aletKartTarih', 'standTarih'];
const HAVA_ARACLARI_LISTESI = ['s70', 's70i', 't70', 'atak', 'mi17', 'gökbey', 'cayrokopter', 'ab-205'];
const EGITIM_TIPLERI = ['ggg', 'gş', 'au(sim)'];
const KAN_GRUPLARI = ['A Rh+', 'A Rh-', 'B Rh+', 'B Rh-', 'AB Rh+', 'AB Rh-', '0 Rh+', '0 Rh-'];
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const RENK_KIRMIZI = '#e74c3c';
const RENK_TURUNCU = '#e67e22';
const RENK_YESIL = '#2ecc71';


// --- GÜVENLİK YARDIMCILARI ---

// Kullanıcıdan gelen her metin HTML'e basılmadan önce buradan geçer
function esc(deger) {
    return String(deger === undefined || deger === null ? '' : deger)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// <script type="application/json"> içine güvenle gömülecek JSON
function jsonGuvenli(nesne) {
    return JSON.stringify(nesne)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .split('\u2028').join('\\u2028')
        .split('\u2029').join('\\u2029');
}

function metinMi(v) {
    return typeof v === 'string';
}


// --- YARDIMCI FONKSİYONLAR ---

// "2:10", "2.5", "2,5" biçimlerini dakikaya çevirir; geçersizse null döner
function sureyiDakikayaCevir(girdi) {
    if (girdi === undefined || girdi === null) return null;
    const s = String(girdi).trim().replace(',', '.');
    if (!s) return null;

    if (s.includes(':')) {
        const [saatStr, dakikaStr = ''] = s.split(':');
        const saat = Number(saatStr);
        const dakika = Number(dakikaStr === '' ? 0 : dakikaStr);
        if (!Number.isFinite(saat) || !Number.isFinite(dakika) || saat < 0 || dakika < 0) return null;
        return Math.round(saat * 60 + dakika);
    }

    const sayi = Number(s);
    if (!Number.isFinite(sayi) || sayi < 0) return null;
    return Math.round(sayi * 60);
}

function dakikayiSaatMetnine(toplamDakika) {
    const saat = Math.floor(toplamDakika / 60);
    const dakika = toplamDakika % 60;
    return `${saat.toString().padStart(2, '0')}:${dakika.toString().padStart(2, '0')}`;
}

function sureMetniDakika(sure) {
    if (sure && sure.includes(':')) {
        const [saat, dakika] = sure.split(':').map(Number);
        return (saat || 0) * 60 + (dakika || 0);
    }
    return 0;
}

function hesaplaToplamSaat(flights) {
    let toplamDakika = 0;
    flights.forEach(f => { toplamDakika += sureMetniDakika(f.sure); });
    return dakikayiSaatMetnine(toplamDakika);
}

function hesaplaAktifDonemSaati(flights) {
    const simdi = new Date();
    const buYil = simdi.getFullYear();
    const eylulSiniri = new Date(buYil, 8, 1);

    let aktifDonemYili = buYil;
    if (simdi >= eylulSiniri) {
        aktifDonemYili = buYil + 1;
    }

    const baslangicTarihi = new Date((aktifDonemYili - 1), 8, 1);
    const bitisTarihi = new Date(aktifDonemYili, 8, 1);

    let toplamDakika = 0;
    let donemUcuslari = [];

    flights.forEach(f => {
        if (f.tarih) {
            const ucusTarihi = new Date(f.tarih);
            if (ucusTarihi >= baslangicTarihi && ucusTarihi < bitisTarihi) {
                donemUcuslari.push(f);
                toplamDakika += sureMetniDakika(f.sure);
            }
        }
    });

    // Dönem hedefi: 140 saat. Güncel dönem saati düşülerek kalan süre bulunur.
    const kalanDakika = Math.max(0, (DONEM_HEDEF_SAAT * 60) - toplamDakika);

    // İlerleme çubuğu ve tempo bilgisi
    const yuzde = Math.min(100, Math.floor((toplamDakika / (DONEM_HEDEF_SAAT * 60)) * 100));
    const kalanGun = Math.max(0, Math.ceil((bitisTarihi.getTime() - simdi.getTime()) / (1000 * 3600 * 24)));
    let tempo = '';
    if (kalanDakika === 0) {
        tempo = 'Dönem hedefi tamamlandı. 🎉';
    } else if (kalanGun > 0) {
        const gunlukDk = Math.ceil(kalanDakika / kalanGun);
        const gunlukMetin = gunlukDk >= 60
            ? `${Math.floor(gunlukDk / 60)} sa ${gunlukDk % 60} dk`
            : `${gunlukDk} dk`;
        tempo = `Dönem bitimine ${kalanGun} gün var. Hedef için günde ortalama ~${gunlukMetin} yeterli.`;
    }

    return {
        yil: aktifDonemYili,
        sure: dakikayiSaatMetnine(toplamDakika),
        kalan: dakikayiSaatMetnine(kalanDakika),
        donemUcuslari: donemUcuslari,
        yuzde: yuzde,
        tempo: tempo
    };
}

function getGunFarki(hedefTarih) {
    if (!hedefTarih) return null;
    const bugun = new Date();
    const hedef = new Date(hedefTarih);
    const zamanFarki = hedef.getTime() - bugun.getTime();
    return Math.ceil(zamanFarki / (1000 * 3600 * 24));
}

function formatTRTarih(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return "";
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

function formatKalanGunMetni(kalanGun) {
    if (kalanGun < 0) {
        return "60 günden fazla";
    }
    return `${kalanGun} Gün`;
}

// 60 günlük sayaçlar: 15 gün ve altı kırmızı, 16-30 gün turuncu, üstü yeşil
function sayacRengi(kalanGun) {
    if (kalanGun <= 15) return RENK_KIRMIZI;
    if (kalanGun <= 30) return RENK_TURUNCU;
    return RENK_YESIL;
}

function hesaplaGggVeSonUcusDurumu(flights) {
    const gercekUcuslar = flights.filter(f => f.egitimTipi !== 'au(sim)');

    const sonUcus = gercekUcuslar[0];
    const sonGggUcus = gercekUcuslar.find(f => f.egitimTipi === 'ggg');

    const sonUcusTarihStr = sonUcus ? sonUcus.tarih : new Date().toISOString().split('T')[0];
    const sonGggTarihStr = sonGggUcus ? sonGggUcus.tarih : new Date().toISOString().split('T')[0];

    const hedefGgg = new Date(sonGggTarihStr); hedefGgg.setDate(hedefGgg.getDate() + 60);
    const hedefSonUcus = new Date(sonUcusTarihStr); hedefSonUcus.setDate(hedefSonUcus.getDate() + 60);

    const kalanGgg = getGunFarki(hedefGgg);
    const kalanSonUcus = getGunFarki(hedefSonUcus);

    return {
        kalanGgg: formatKalanGunMetni(kalanGgg),
        hedefGggStr: formatTRTarih(hedefGgg),
        renkGgg: sayacRengi(kalanGgg),
        kalanSonUcus: formatKalanGunMetni(kalanSonUcus),
        hedefSonUcusStr: formatTRTarih(hedefSonUcus),
        renkSonUcus: sayacRengi(kalanSonUcus)
    };
}

function hesaplaAracaGoreDetayliDurum(flights) {
    let sonuc = { ggg: {}, sonUcus: {} };

    const gercekUcuslar = flights.filter(f => f.egitimTipi !== 'au(sim)');

    HAVA_ARACLARI_LISTESI.forEach(arac => {
        const aracGggUcuslari = gercekUcuslar.filter(f => f.havaAraciTipi === arac && f.egitimTipi === 'ggg');
        const sonGgg = aracGggUcuslari[0];

        if (sonGgg) {
            const hedef = new Date(sonGgg.tarih);
            hedef.setDate(hedef.getDate() + 60);
            const kalan = getGunFarki(hedef);
            sonuc.ggg[arac] = {
                tarih: formatTRTarih(sonGgg.tarih),
                kalanGunStr: formatKalanGunMetni(kalan),
                renk: sayacRengi(kalan)
            };
        } else {
            sonuc.ggg[arac] = { yok: true };
        }

        const aracTumGercekUcuslari = gercekUcuslar.filter(f => f.havaAraciTipi === arac);
        const sonGenel = aracTumGercekUcuslari[0];

        if (sonGenel) {
            const hedef = new Date(sonGenel.tarih);
            hedef.setDate(hedef.getDate() + 60);
            const kalan = getGunFarki(hedef);
            sonuc.sonUcus[arac] = {
                tarih: formatTRTarih(sonGenel.tarih),
                tip: (sonGenel.egitimTipi || '').toUpperCase(),
                kalanGunStr: formatKalanGunMetni(kalan),
                renk: sayacRengi(kalan)
            };
        } else {
            sonuc.sonUcus[arac] = { yok: true };
        }
    });

    return sonuc;
}


// Yaklaşan süreler (30 gün ve altı) için uyarı listesi
const UYARI_ESIGI_GUN = 30;
function hesaplaUyarilar(flights, kayitliTarihler) {
    const liste = [];
    const ekle = (simge, metin, kalan) => {
        liste.push({ simge, metin, kalan, seviye: kalan <= 15 ? 'k' : 't' });
    };

    // Tarihli belgeler: süresi dolmuşsa da gösterilir
    const belgeler = [
        ['muayene1Tarih', 1, '1 Yıllık Muayene'],
        ['muayene4Tarih', 4, '4 Yıllık Muayene'],
        ['aletKartTarih', 1, 'Alet Kart'],
        ['standTarih', 1, 'Standardizasyon']
    ];
    belgeler.forEach(([alan, yil, etiket]) => {
        const kayit = (kayitliTarihler || []).find(t => t.alan === alan);
        if (!kayit || !kayit.tarih) return;
        const hedef = new Date(kayit.tarih);
        if (isNaN(hedef.getTime())) return;
        hedef.setFullYear(hedef.getFullYear() + yil);
        const kalan = getGunFarki(hedef);
        if (kalan <= UYARI_ESIGI_GUN) ekle('⚠️', etiket, kalan);
    });

    // 60 günlük sayaçlar: araç bazında, süresi dolmak üzere olanlar (dolmuşlar gürültü yapmasın diye gösterilmez)
    const gercek = flights.filter(f => f.egitimTipi !== 'au(sim)');
    HAVA_ARACLARI_LISTESI.forEach(arac => {
        const sonGgg = gercek.find(f => f.havaAraciTipi === arac && f.egitimTipi === 'ggg');
        if (sonGgg) {
            const h = new Date(sonGgg.tarih); h.setDate(h.getDate() + 60);
            const k = getGunFarki(h);
            if (k >= 0 && k <= UYARI_ESIGI_GUN) ekle('🌙', `GGG sayacı (${arac.toUpperCase()})`, k);
        }
        const sonGenel = gercek.find(f => f.havaAraciTipi === arac);
        if (sonGenel) {
            const h = new Date(sonGenel.tarih); h.setDate(h.getDate() + 60);
            const k = getGunFarki(h);
            if (k >= 0 && k <= UYARI_ESIGI_GUN) ekle('⏳', `Son uçuş sayacı (${arac.toUpperCase()})`, k);
        }
    });

    liste.sort((a, b) => a.kalan - b.kalan);
    return liste.slice(0, 6);
}

function uyariBandiHtml(uyarilar) {
    if (!uyarilar.length) return '';
    return `<div class="uyari-alani" role="status">${uyarilar.map(u => {
        const sag = u.kalan < 0 ? 'Süresi doldu' : (u.kalan === 0 ? 'Bugün doluyor' : `${u.kalan} gün kaldı`);
        return `<div class="uyari-satiri uy-${u.seviye}"><span aria-hidden="true">${u.simge}</span><span>${esc(u.metin)}</span><b>${esc(sag)}</b></div>`;
    }).join('')}</div>`;
}


// --- PANEL HTML ÜRETİMİ ---
// Tüm dinamik değerler esc() ile kaçışlanır. Stil ve istemci kodu public/panel.css ve public/panel.js içindedir.

const ARAC_SECENEKLERI = HAVA_ARACLARI_LISTESI.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
const EGITIM_SECENEKLERI = EGITIM_TIPLERI.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
const AY_SECENEKLERI =AYLAR.map((ad, i) => `<option value="${String(i + 1).padStart(2, '0')}">${ad}</option>`).join('');

function tarihSayaciHtml(baslangicTarihi, periyotYil, etiket, alan) {
    if (!baslangicTarihi) {
        return `<div class="sayac sayac-bos" data-eylem="tarih-modal" data-alan="${esc(alan)}" data-etiket="${esc(etiket)}" data-tarih=""><strong>${esc(etiket)}</strong><br><span class="uyari">⚠️ TARİH GİRİLMEDİ</span></div>`;
    }
    const hedef = new Date(baslangicTarihi);
    hedef.setFullYear(hedef.getFullYear() + periyotYil);
    const kalanGun = getGunFarki(hedef);
    const renk = kalanGun <= 90 ? RENK_KIRMIZI : '#3498db';
    return `<div class="sayac" data-eylem="tarih-modal" data-alan="${esc(alan)}" data-etiket="${esc(etiket)}" data-tarih="${esc(baslangicTarihi)}" style="--renk:${renk};"><strong>${esc(etiket)}</strong><br><span class="sayac-deger">${esc(kalanGun)} Gün</span><span class="tarih-etiket">Son Tarih: ${esc(formatTRTarih(hedef))}</span></div>`;
}

// Uçuş temaları: GGG (gece görüş gözlüğü) = ay ışığı, GŞ (gündüz) = gün ışığı. Diğer türler (ör. simülatör) sade kalır.
function ucusTemasi(egitimTipi) {
    if (egitimTipi === 'ggg') return { sinif: ' tema-ay', ikon: '<span class="tema-ikon" aria-hidden="true">🌙</span>' };
    if (egitimTipi === 'gş') return { sinif: ' tema-gunes', ikon: '<span class="tema-ikon" aria-hidden="true">☀️</span>' };
    return { sinif: '', ikon: '' };
}

function ucusSatiriHtml(f) {
    const id = esc(f._id);
    const aciklama = f.gorevAciklamasi || '';
    const kisa = aciklama.length > 40 ? aciklama.substring(0, 40) + '...' : aciklama;
    const tema = ucusTemasi(f.egitimTipi);
    return `
        <tr id="row-${id}" class="ucus-satiri${tema.sinif}" data-eylem="detay" data-id="${id}" data-tarih="${esc(f.tarih)}" data-hava="${esc(f.havaAraciTipi)}" data-egitim="${esc(f.egitimTipi)}" data-sure="${esc(f.sure)}" data-aciklama="${esc(aciklama)}">
            <td class="c-tarih">${esc(f.tarih)}</td>
            <td class="c-arac">${esc(f.havaAraciTipi)}</td>
            <td class="c-egitim">${tema.ikon}${esc(f.egitimTipi)}</td>
            <td class="c-sure">${esc(f.sure)}</td>
            <td class="c-aciklama" title="${esc(aciklama)}">${esc(kisa)}</td>
            <td class="c-islem"><button type="button" class="duz-btn" data-eylem="ucus-duzenle" data-id="${id}" aria-label="Uçuşu düzenle">Düzenle</button><button type="button" class="sil-btn" data-eylem="ucus-sil" data-id="${id}">Sil</button></td>
        </tr>
        <tr id="detay-${id}" class="detay-satiri">
            <td colspan="6">
                <div class="detay-baslik">📋 Tam Görev Açıklaması:</div>
                <div class="detay-kutu">${aciklama ? esc(aciklama) : 'Görev açıklaması girilmemiş.'}</div>
            </td>
        </tr>`;
}

function panelHtmlOlustur(email, flights, kayitliTarihler, yonetici, profil) {
    profil = profil || {};
    const toplamUcusSuresi = hesaplaToplamSaat(flights);
    const aktifDonem = hesaplaAktifDonemSaati(flights);
    const gggDurum = hesaplaGggVeSonUcusDurumu(flights);
    const aracBazliDurum = hesaplaAracaGoreDetayliDurum(flights);
    const uyarilar = hesaplaUyarilar(flights, kayitliTarihler);

    const staticYears = Array.from({ length: 10 }, (_, i) => 2024 + i);
    const bugunTarihStr = new Date().toISOString().split('T')[0];

    const tarihBul = (alanAdi) => {
        const bulma = kayitliTarihler.find(t => t.alan === alanAdi);
        return bulma ? bulma.tarih : null;
    };

    const panelVeri = {
        aracBazli: aracBazliDurum,
        donemUcuslari: aktifDonem.donemUcuslari.map(f => ({
            tarih: f.tarih,
            havaAraciTipi: f.havaAraciTipi,
            egitimTipi: f.egitimTipi,
            sure: f.sure
        }))
    };

    const icerik = `
        <div class="container">

            <div class="marka">
                <span class="marka-ikon" aria-hidden="true">✈</span>
                <span class="marka-ad">Uçuş <b>Logbook</b></span>
                <button type="button" class="tema-btn" data-eylem="tema-degistir" aria-label="Koyu / açık tema">
                    <span class="tb-koyu" aria-hidden="true">🌙</span><span class="tb-acik" aria-hidden="true">☀️</span>
                </button>
            </div>

            ${uyariBandiHtml(uyarilar)}

            <div class="ust-panel">
                <div class="ozet-kart">
                    <div class="saatler-wrapper">
                        <div>
                            <span class="mini-etiket">TOPLAM SAAT</span>
                            <h2 id="toplamSaatGosterge">${esc(toplamUcusSuresi)}</h2>
                        </div>
                        <div class="donem-alani" data-eylem="donem-modal" title="Dönem Uçuşlarını Görmek İçin Tıkla">
                            <span class="mini-etiket">${esc(aktifDonem.yil)} DÖNEMİ 🔍</span>
                            <h2 id="donemSaatGosterge">${esc(aktifDonem.sure)}<span class="kalan-saat" title="${DONEM_HEDEF_SAAT} saatten kalan">(${esc(aktifDonem.kalan)})</span></h2>
                        </div>
                    </div>
                    <div class="ozet-alt">
                        <button type="button" class="profil-btn" data-eylem="profil-modal" title="Profil ve şifre ayarları">👤 ${esc(profil.adSoyad || email)}</button>
                        ${yonetici ? '<a class="cikis-link" href="/admin">Yönetim</a>' : ''}
                        <a class="cikis-link" href="/logout">Çıkış</a>
                    </div>
                </div>

                <div class="sayac-grid">
                    <div class="sayac" data-eylem="sayac-modal" data-tip="ggg" style="--renk:${gggDurum.renkGgg};" title="Tüm Araçların GGG Durumunu Gör">
                        <strong>🌙 GGG Sayaç (60G)</strong><br><span class="sayac-deger">${esc(gggDurum.kalanGgg)}</span>
                        <span class="tarih-etiket">Son Tarih: ${esc(gggDurum.hedefGggStr)}</span>
                    </div>
                    <div class="sayac" data-eylem="sayac-modal" data-tip="sonUcus" style="--renk:${gggDurum.renkSonUcus};" title="Tüm Araçların Son Uçuş Durumunu Gör">
                        <strong>☀️ Son Uçuş (60G)</strong><br><span class="sayac-deger">${esc(gggDurum.kalanSonUcus)}</span>
                        <span class="tarih-etiket">Son Tarih: ${esc(gggDurum.hedefSonUcusStr)}</span>
                    </div>
                    ${tarihSayaciHtml(tarihBul('muayene1Tarih'), 1, '1 Yıllık Muayene', 'muayene1Tarih')}
                    ${tarihSayaciHtml(tarihBul('muayene4Tarih'), 4, '4 Yıllık Muayene', 'muayene4Tarih')}
                    ${tarihSayaciHtml(tarihBul('aletKartTarih'), 1, 'Alet Kart', 'aletKartTarih')}
                    ${tarihSayaciHtml(tarihBul('standTarih'), 1, 'Standardizasyon', 'standTarih')}
                </div>
            </div>

            <div class="ilerleme-kart">
                <div class="ilerleme-ust">
                    <span class="ilerleme-saat">${esc(aktifDonem.sure)} <small>/ ${DONEM_HEDEF_SAAT}:00</small></span>
                    <span class="ilerleme-yuzde">%${esc(aktifDonem.yuzde)}</span>
                </div>
                <div class="ilerleme-cubuk" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${esc(aktifDonem.yuzde)}" aria-label="${esc(aktifDonem.yil)} dönemi hedef ilerlemesi"><i style="width:${esc(aktifDonem.yuzde)}%"></i></div>
                ${aktifDonem.tempo ? `<div class="ilerleme-not">📈 ${esc(aktifDonem.tempo)}</div>` : ''}
            </div>

            <div class="akordeon-container">
                <button type="button" class="akordeon-toggle-btn" aria-expanded="false" data-eylem="akordeon" data-icerik="filtreIcerikKutusu" data-ok="filtreOkIkon">
                    <span>🔍 Geçmiş Uçuş Aramak İçin Tıkla</span>
                    <span id="filtreOkIkon">▼</span>
                </button>
                <div id="filtreIcerikKutusu" class="akordeon-icerik">
                    <div class="filtre-alan"><label for="filtreYil">📋 Yıl Seçimi (1 Eylül Dönemi):</label><select id="filtreYil"><option value="">Yıl Seçin</option>${staticYears.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                    <div class="filtre-alan"><label for="filtreAy">Ay:</label><select id="filtreAy"><option value="">Ay Seçin</option>${AY_SECENEKLERI}</select></div>
                    <div class="filtre-alan"><label for="filtreHavaAraci">Hava Aracı:</label><select id="filtreHavaAraci"><option value="">Hava Aracı</option>${ARAC_SECENEKLERI}</select></div>
                    <div class="filtre-alan"><label for="filtreUcusTipi">Uçuş Tipi:</label><select id="filtreUcusTipi"><option value="">Uçuş Tipi</option>${EGITIM_SECENEKLERI}</select></div>
                    <div class="filtre-butonlar"><button type="button" class="btn-filtre" data-eylem="filtre-uygula">Uygula</button><button type="button" class="btn-temizle" data-eylem="filtre-temizle">Temizle</button></div>
                    <div id="filtreSaatKutusu" class="filtre-saat-kutusu" hidden>⏱️ Filtrelenen Süre: <span id="filtreliSaatGosterge">00:00</span></div>
                </div>
            </div>

            <a href="/kdu.html" target="_blank" rel="noopener" class="kdu-link-btn">
                📟 KDU (Keyboard Display Unit) Aç
            </a>

            <div class="akordeon-container ekle-toggle-stil">
                <button type="button" class="akordeon-toggle-btn ekle-toggle-btn" aria-expanded="false" data-eylem="akordeon" data-icerik="ekleIcerikKutusu" data-ok="ekleOkIkon">
                    <span>✈️ Yeni Uçuş Saati Girmek İçin Tıkla</span>
                    <span id="ekleOkIkon">▼</span>
                </button>
                <div id="ekleIcerikKutusu" class="akordeon-icerik">
                    <button type="button" id="sonKopyaBtn" class="kopya-btn" data-eylem="son-kopyala" hidden>
                        <span aria-hidden="true">📋</span>
                        <span><b>Son uçuşu kopyala</b><small id="sonKopyaOzet"></small></span>
                    </button>
                    <form id="ucusFormu" class="form-grid">
                        <div><label for="tarih">Tarih:</label><input type="date" id="tarih" value="${esc(bugunTarihStr)}"></div>
                        <div><label for="havaAraciTipi">Hava Aracı Tipi:</label><select id="havaAraciTipi">${ARAC_SECENEKLERI}</select></div>
                        <div><label for="egitimTipi">Eğitim Sınıflandırması:</label><select id="egitimTipi"><option value="" disabled selected>Lütfen Seçiniz</option>${EGITIM_SECENEKLERI}</select></div>
                        <div>
                            <label for="sureAlani">Uçuş Süresi:</label>
                            <button type="button" id="sureAlani" class="sure-alani" data-eylem="sure-modal"><span id="sureAlaniMetin" class="yer-tutucu">Süre seçin</span><span aria-hidden="true">⏱️</span></button>
                        </div>
                        <div class="span-2"><label for="gorevAciklamasi">Görev Açıklaması:</label><textarea id="gorevAciklamasi" maxlength="1000"></textarea></div>
                        <button type="button" id="btnUcusEkle" class="btn-ekle span-2" data-eylem="ucus-ekle">✈️ Uçuşu Ekle</button>
                    </form>
                </div>
            </div>

            <div class="arac-cubugu">
                <button type="button" class="arac-btn" data-eylem="istatistik-ac">📊 İstatistik</button>
                <button type="button" class="arac-btn" data-eylem="csv-indir">⬇ Excel (CSV)</button>
                <button type="button" class="arac-btn" data-eylem="pdf-indir">⬇ PDF</button>
            </div>

            <div class="tablo-sarmal">
                <table>
                    <thead><tr><th>Tarih</th><th>Hava Aracı</th><th>Eğitim</th><th>Süre</th><th>Görev Açıklaması</th><th>İşlem</th></tr></thead>
                    <tbody id="ucusTabloGovde">
                        ${flights.map(ucusSatiriHtml).join('')}
                    </tbody>
                </table>
                <div id="bosMesaj" class="bos-mesaj" hidden>Kayıt bulunamadı.</div>
            </div>

            <div id="sayfalamaAlani" class="sayfalama-alani"></div>

        </div>

        <!-- DÖNEM UÇUŞLARI MODALI -->
        <div id="donemUcuslariModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu genis">
                <h3 class="modal-baslik">📋 ${esc(aktifDonem.yil)} Dönemi Uçuş Listesi</h3>
                <div id="donemUcuslariIcerik" class="modal-liste"></div>
                <button type="button" class="btn-iptal modal-kapat-btn" data-eylem="modal-kapat" data-modal="donemUcuslariModal">Kapat</button>
            </div>
        </div>

        <!-- ARAÇ BAZLI DETAYLI SAYAÇ MODALI -->
        <div id="detayliSayacModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu">
                <h3 id="sayacModalBaslik" class="modal-baslik">✈️ Hava Araçları Durumu</h3>
                <div id="sayacModalIcerik" class="modal-liste"></div>
                <button type="button" class="btn-iptal modal-kapat-btn" data-eylem="modal-kapat" data-modal="detayliSayacModal">Kapat</button>
            </div>
        </div>

        <!-- PROFİL VE ŞİFRE MODALI -->
        <div id="profilModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu profil-kutu">
                <h3 class="modal-baslik">👤 Profilim</h3>
                <div class="profil-mail">${esc(email)}</div>
                <div class="sekme-cubugu" role="tablist">
                    <button type="button" class="sekme aktif" role="tab" data-eylem="profil-sekme" data-sekme="bilgi">Bilgilerim</button>
                    <button type="button" class="sekme" role="tab" data-eylem="profil-sekme" data-sekme="sifre">🔐 Şifre</button>
                </div>
                <div class="profil-govde">
                    <div id="profilBilgi">
                        <label for="profilAd">Ad Soyad</label>
                        <input type="text" id="profilAd" maxlength="60" autocomplete="name" value="${esc(profil.adSoyad || '')}" placeholder="İsteğe bağlı">
                        <div class="duz-grid">
                            <div><label for="profilBoy">Boy (cm)</label><input type="number" id="profilBoy" inputmode="numeric" min="100" max="250" step="1" value="${esc(profil.boy || '')}" placeholder="175"></div>
                            <div><label for="profilKilo">Kilo (kg)</label><input type="number" id="profilKilo" inputmode="decimal" min="30" max="300" step="0.1" value="${esc(profil.kilo || '')}" placeholder="75"></div>
                            <div><label for="profilDogum">Doğum Tarihi</label><input type="date" id="profilDogum" value="${esc(profil.dogumTarihi || '')}"></div>
                            <div><label for="profilKan">Kan Grubu</label><select id="profilKan"><option value="">Seçin</option>${KAN_GRUPLARI.map(k => `<option value="${esc(k)}"${profil.kanGrubu === k ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></div>
                        </div>
                        <div id="profilHesap" class="profil-hesap" hidden></div>
                        <p class="profil-not">Bu bilgiler yalnızca sana aittir, başka kullanıcılar göremez.</p>
                        <div class="modal-butonlar">
                            <button type="button" class="btn-tamam" data-eylem="profil-kaydet">Kaydet</button>
                            <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="profilModal">Kapat</button>
                        </div>
                    </div>
                    <div id="profilSifre" hidden>
                        <label for="eskiSifre">Mevcut Şifre:</label>
                        <input type="password" id="eskiSifre" placeholder="Mevcut şifreniz" autocomplete="current-password">
                        <label for="yeniSifre1">Yeni Şifre:</label>
                        <input type="password" id="yeniSifre1" placeholder="En az 8 karakter, 1 büyük, 1 rakam" autocomplete="new-password">
                        <label for="yeniSifre2">Yeni Şifre (Tekrar):</label>
                        <input type="password" id="yeniSifre2" placeholder="Yeni şifreyi tekrar girin" autocomplete="new-password">
                        <div class="modal-butonlar">
                            <button type="button" class="btn-tamam" data-eylem="sifre-guncelle">Güncelle</button>
                            <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="profilModal">Kapat</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- UÇUŞ DÜZENLEME MODALI -->
        <div id="duzenleModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu">
                <h3 class="modal-baslik">✏️ Uçuşu Düzenle</h3>
                <input type="hidden" id="duzId">
                <div class="duz-grid">
                    <div><label for="duzTarih">Tarih</label><input type="date" id="duzTarih"></div>
                    <div><label for="duzArac">Hava Aracı</label><select id="duzArac">${ARAC_SECENEKLERI}</select></div>
                    <div><label for="duzEgitim">Eğitim</label><select id="duzEgitim">${EGITIM_SECENEKLERI}</select></div>
                    <div><label for="duzSureAlani">Süre</label>
                        <button type="button" id="duzSureAlani" class="sure-alani" data-eylem="sure-modal" data-hedef="duzSureAlani" data-metin="duzSureMetin"><span id="duzSureMetin" class="yer-tutucu">Süre seçin</span><span aria-hidden="true">⏱️</span></button>
                    </div>
                </div>
                <label for="duzAciklama">Görev Açıklaması</label>
                <textarea id="duzAciklama" maxlength="1000"></textarea>
                <div class="modal-butonlar">
                    <button type="button" class="btn-tamam" data-eylem="duzenle-kaydet">Kaydet</button>
                    <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="duzenleModal">İptal</button>
                </div>
            </div>
        </div>

        <!-- İSTATİSTİK MODALI -->
        <div id="istatistikModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu genis">
                <h3 class="modal-baslik">📊 ${esc(aktifDonem.yil)} Dönemi İstatistikleri</h3>
                <div id="istatistikIcerik" class="modal-liste"></div>
                <button type="button" class="btn-iptal modal-kapat-btn" data-eylem="modal-kapat" data-modal="istatistikModal">Kapat</button>
            </div>
        </div>

        <!-- YAZDIRMA (PDF) ALANI: yalnızca yazdırırken görünür -->
        <div id="yazdirAlani" class="yazdir-alani"></div>

        <!-- UÇUŞ SÜRESİ SEÇİCİ MODALI -->
        <div id="sureModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu kucuk">
                <h3 class="modal-baslik">⏱️ Uçuş Süresi</h3>
                <div class="sure-tekerlek">
                    <div class="tekerlek-band"></div>
                    <div class="tekerlek-kolon"><div class="tekerlek" id="sureSaat" data-max="23" tabindex="0" role="listbox" aria-label="Saat"></div><span class="tekerlek-birim">saat</span></div>
                    <div class="tekerlek-kolon"><div class="tekerlek" id="sureDakika" data-max="59" tabindex="0" role="listbox" aria-label="Dakika"></div><span class="tekerlek-birim">dk</span></div>
                </div>
                <div class="modal-butonlar">
                    <button type="button" class="btn-tamam" data-eylem="sure-tamam">Tamam</button>
                    <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="sureModal">İptal</button>
                </div>
            </div>
        </div>

        <!-- TARİH MODALI -->
        <div id="tarihModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu kucuk">
                <h3 id="modalBaslik" class="modal-baslik">Tarih Girin</h3>
                <div class="modal-mevcut-tarih">Mevcut Kayıtlı Tarih: <span id="modalMevcutTarihText">-</span></div>
                <input type="hidden" id="hedefAlan">
                <input type="date" id="yeniKategoriTarih">
                <div class="modal-butonlar">
                    <button type="button" class="btn-tamam" data-eylem="tarih-kaydet">Kaydet</button>
                    <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="tarihModal">İptal</button>
                </div>
            </div>
        </div>
    `;

    return `<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0b1220">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Logbook">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <title>Uçuş Takip Paneli</title>
    <script>try{var t=localStorage.getItem('logbookTema');if(t==='acik')document.documentElement.setAttribute('data-tema','acik');}catch(e){}</script>
    <link rel="stylesheet" href="/panel.css">
</head>
<body>
    <div class="yildizlar" aria-hidden="true"></div>
    <div id="toastAlani" class="toast-alani" aria-live="polite"></div>

    <div id="uygulama">${icerik}</div>

    <!-- ONAY PENCERESİ (alert/confirm yerine) -->
    <div id="onayModal" class="modal-arka" role="dialog" aria-modal="true">
        <div class="modal-kutu kucuk">
            <h3 id="onayMetin" class="modal-baslik"></h3>
            <div class="modal-butonlar">
                <button type="button" id="onayEvet" class="btn-tamam">Evet</button>
                <button type="button" id="onayHayir" class="btn-iptal">Vazgeç</button>
            </div>
        </div>
    </div>

    <script type="application/json" id="panelVeri">${jsonGuvenli(panelVeri)}</script>
    <script src="/panel.js"></script>
</body>
</html>`;
}


// --- GİRİŞ / KAYIT YARDIMCILARI ---

const EPOSTA_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Kullanıcı bulunamasa da bcrypt çalıştırılır; yanıt süresinden hesabın var olup olmadığı anlaşılmasın
const SAHTE_HASH = bcrypt.hashSync('sahte-sifre-123A', 10);

function sifreKuraliUygun(sifre) {
    return sifre.length >= 8 && /[A-Z]/.test(sifre) && /[0-9]/.test(sifre);
}

// Basit bellek içi deneme sınırı. Sunucu yeniden başlarsa sayaçlar sıfırlanır.
function denemeSiniri(limit, pencereMs) {
    const kayitlar = new Map();
    setInterval(() => {
        const simdi = Date.now();
        for (const [k, v] of kayitlar) {
            if (simdi - v.ilk > pencereMs) kayitlar.delete(k);
        }
    }, 5 * 60 * 1000).unref();

    return {
        // Engelliyse kalan dakikayı, değilse 0 döner
        engelli(anahtar) {
            const k = kayitlar.get(anahtar);
            if (!k) return 0;
            const kalanMs = k.ilk + pencereMs - Date.now();
            if (kalanMs <= 0) { kayitlar.delete(anahtar); return 0; }
            return k.sayi >= limit ? Math.ceil(kalanMs / 60000) : 0;
        },
        hata(anahtar) {
            const simdi = Date.now();
            const k = kayitlar.get(anahtar);
            if (!k || simdi - k.ilk > pencereMs) kayitlar.set(anahtar, { sayi: 1, ilk: simdi });
            else k.sayi++;
        },
        temizle(anahtar) { kayitlar.delete(anahtar); }
    };
}

const girisSiniriHesap = denemeSiniri(5, 15 * 60 * 1000);   // aynı IP + aynı e-posta: 15 dakikada 5 hatalı deneme
const girisSiniriIp = denemeSiniri(50, 15 * 60 * 1000);     // aynı IP: 15 dakikada 50 hatalı deneme
const kayitSiniriIp = denemeSiniri(10, 60 * 60 * 1000);     // aynı IP: saatte 10 kayıt denemesi

// Mesaj giriş sayfasında gösterilir. Metin sunucudan değil, istemcideki sabit listeden gelir.
function girisSayfasinaDon(res, anahtar, kod, sekme, dakika) {
    let url = `/?${anahtar}=${encodeURIComponent(kod)}&sekme=${sekme}`;
    if (dakika) url += `&dk=${dakika}`;
    return res.redirect(url);
}


// --- ROTALAR ---

app.get('/', (req, res) => {
    // Geçerli oturum varsa giriş formu yerine doğrudan panel açılır
    if (oturumEmailOku(req)) return res.redirect('/login');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sayfa yenilendiğinde (GET /login) geçerli oturum varsa paneli tekrar göster
app.get('/login', (req, res) => {
    const oturum = oturumOku(req);
    if (!oturum) return res.redirect('/');
    req.oturumEmail = oturum.email;
    req.oturumKalici = oturum.kalici;
    return loginHandler(req, res);
});

app.get('/register', (req, res) => {
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    oturumCerezSil(req, res);
    res.redirect('/');
});

const loginHandler = async (req, res) => {
    const cerezle = !!req.oturumEmail;
    const govde = req.body || {};
    const email = String(cerezle ? req.oturumEmail : (metinMi(govde.email) ? govde.email : '')).trim().toLowerCase();
    const password = metinMi(govde.password) ? govde.password : '';
    const hesapAnahtar = `${req.ip}|${email}`;
    // Çerezle gelen istekte seçim korunur; formdan gelen girişte "Beni hatırla" kutusuna bakılır
    const kalici = cerezle ? req.oturumKalici !== false : (govde.hatirla === 'on' || govde.hatirla === '1');

    if (!cerezle) {
        if (!email || !password) return girisSayfasinaDon(res, 'hata', 'eksik', 'login');
        const bekle = girisSiniriHesap.engelli(hesapAnahtar) || girisSiniriIp.engelli(req.ip);
        if (bekle) return girisSayfasinaDon(res, 'hata', 'cok-deneme', 'login', bekle);
    }

    const basarisiz = () => {
        girisSiniriHesap.hata(hesapAnahtar);
        girisSiniriIp.hata(req.ip);
        // Hesap var mı yok mu belli olmasın diye iki durumda da aynı mesaj gösterilir
        return girisSayfasinaDon(res, 'hata', 'giris', 'login');
    };

    try {
        const user = await User.findOne({ email });
        if (!user) {
            if (cerezle) {
                oturumCerezSil(req, res);
                return res.redirect('/');
            }
            await bcrypt.compare(password, SAHTE_HASH);
            return basarisiz();
        }

        let isMatch = false;
        if (cerezle) {
            isMatch = true; // geçerli imzalı oturum çerezi
        } else {
            isMatch = await bcrypt.compare(password, user.password || '');
            if (!isMatch && user.password && password === user.password) {
                // Eski, şifrelenmemiş kayıt: doğru girildiyse hemen şifrelenmiş haline çevrilir
                isMatch = true;
                user.password = await bcrypt.hash(password, 10);
                await user.save();
            }
        }

        if (!isMatch) return basarisiz();
        if (!cerezle) girisSiniriHesap.temizle(hesapAnahtar);

        oturumCerezYaz(req, res, email, kalici);

        const flights = await Flight.find({ userEmail: email }).sort({ tarih: -1 });
        const kayitliTarihler = await ReportDate.find({ userEmail: email });

        res.set('Cache-Control', 'no-store');
        res.send(panelHtmlOlustur(email, flights, kayitliTarihler, adminMi(email), user.profil));
    } catch (error) {
        console.error(error);
        if (cerezle) return res.status(500).send("Sunucu hatası.");
        return girisSayfasinaDon(res, 'hata', 'sunucu', 'login');
    }
};

app.post('/login', loginHandler);

app.post('/register', async (req, res) => {
    const govde = req.body || {};
    const email = metinMi(govde.email) ? govde.email.trim().toLowerCase() : '';
    const password = metinMi(govde.password) ? govde.password : '';

    const bekle = kayitSiniriIp.engelli(req.ip);
    if (bekle) return girisSayfasinaDon(res, 'hata', 'cok-deneme', 'register', bekle);
    kayitSiniriIp.hata(req.ip);

    if (!email || !password) return girisSayfasinaDon(res, 'hata', 'eksik', 'register');
    if (email.length > 254 || !EPOSTA_REGEX.test(email)) return girisSayfasinaDon(res, 'hata', 'eposta', 'register');
    if (metinMi(govde.password2) && govde.password2 !== password) return girisSayfasinaDon(res, 'hata', 'eslesme', 'register');
    if (!sifreKuraliUygun(password)) return girisSayfasinaDon(res, 'hata', 'kural', 'register');

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) return girisSayfasinaDon(res, 'hata', 'var', 'register');

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();

        return girisSayfasinaDon(res, 'basari', 'kayit', 'login');
    } catch (error) {
        console.error(error);
        return girisSayfasinaDon(res, 'hata', 'sunucu', 'register');
    }
});


// Profil formunu doğrular. Tüm alanlar isteğe bağlıdır; boş bırakılan alan silinir.
function profilDogrula(g) {
    g = g || {};
    const sayiOku = (v) => {
        if (v === undefined || v === null || v === '') return { bos: true };
        const n = Number(String(v).trim().replace(',', '.'));
        return Number.isFinite(n) ? { n } : { hata: true };
    };

    const adSoyad = metinMi(g.adSoyad) ? g.adSoyad.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    if (adSoyad.length > 60) return { hata: 'Ad soyad en fazla 60 karakter olabilir.' };

    const boy = sayiOku(g.boy);
    if (boy.hata || (!boy.bos && (boy.n < 100 || boy.n > 250))) return { hata: 'Boy 100 ile 250 cm arasında olmalıdır.' };

    const kilo = sayiOku(g.kilo);
    if (kilo.hata || (!kilo.bos && (kilo.n < 30 || kilo.n > 300))) return { hata: 'Kilo 30 ile 300 kg arasında olmalıdır.' };

    let dogumTarihi = '';
    if (g.dogumTarihi !== undefined && g.dogumTarihi !== null && g.dogumTarihi !== '') {
        const bugun = new Date().toISOString().slice(0, 10);
        if (!metinMi(g.dogumTarihi) || !/^\d{4}-\d{2}-\d{2}$/.test(g.dogumTarihi) || isNaN(new Date(g.dogumTarihi).getTime())
            || g.dogumTarihi < '1930-01-01' || g.dogumTarihi > bugun) {
            return { hata: 'Geçerli bir doğum tarihi girin.' };
        }
        dogumTarihi = g.dogumTarihi;
    }

    const kanGrubu = metinMi(g.kanGrubu) ? g.kanGrubu : '';
    if (kanGrubu && !KAN_GRUPLARI.includes(kanGrubu)) return { hata: 'Geçersiz kan grubu.' };

    return {
        veri: {
            adSoyad,
            boy: boy.bos ? null : Math.round(boy.n),
            kilo: kilo.bos ? null : Math.round(kilo.n * 10) / 10,
            dogumTarihi,
            kanGrubu
        }
    };
}


// --- API (hepsi oturum çerezi gerektirir) ---

app.post('/api/update-profile', oturumGerekli, async (req, res) => {
    const d = profilDogrula(req.body);
    if (d.hata) return res.json({ success: false, message: d.hata });
    try {
        const sonuc = await User.findOneAndUpdate({ email: req.oturumEmail }, { $set: { profil: d.veri } });
        if (!sonuc) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/update-password', oturumGerekli, async (req, res) => {
    const { eskiSifre, yeniSifre } = req.body || {};
    if (!metinMi(eskiSifre) || !metinMi(yeniSifre)) {
        return res.json({ success: false, message: "Geçersiz istek." });
    }
    if (yeniSifre.length < 8 || !/[A-Z]/.test(yeniSifre) || !/[0-9]/.test(yeniSifre)) {
        return res.json({ success: false, message: "Yeni şifre en az 8 karakter, 1 büyük harf ve 1 rakam içermelidir." });
    }

    try {
        const user = await User.findOne({ email: req.oturumEmail });
        if(!user) {
            return res.json({ success: false, message: "Kullanıcı bulunamadı." });
        }

        let isMatch = await bcrypt.compare(eskiSifre, user.password);
        if (!isMatch && eskiSifre === user.password) isMatch = true;

        if(!isMatch) {
            return res.json({ success: false, message: "Mevcut şifreniz yanlış." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(yeniSifre, salt);

        user.password = hashedPassword;
        await user.save();

        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: "Sunucu hatası." });
    }
});

app.post('/api/update-user-date', oturumGerekli, async (req, res) => {
    const { alan, tarih } = req.body || {};
    if (!IZINLI_TARIH_ALANLARI.includes(alan) || !metinMi(tarih) || !/^\d{4}-\d{2}-\d{2}$/.test(tarih) || isNaN(new Date(tarih).getTime())) {
        return res.json({ success: false, message: "Geçersiz tarih." });
    }
    try {
        await ReportDate.findOneAndUpdate(
            { userEmail: req.oturumEmail, alan: alan },
            { tarih: tarih },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.delete('/api/delete-flight', oturumGerekli, async (req, res) => {
    const { id } = req.body || {};
    if (!metinMi(id) || !mongoose.isValidObjectId(id)) {
        return res.json({ success: false, message: "Geçersiz kayıt." });
    }
    try {
        // Sadece oturumdaki kullanıcının kendi kaydı silinebilir
        await Flight.findOneAndDelete({ _id: id, userEmail: req.oturumEmail });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/update-flight', oturumGerekli, async (req, res) => {
    const govde = req.body || {};
    if (!metinMi(govde.id) || !mongoose.isValidObjectId(govde.id)) {
        return res.json({ success: false, message: "Geçersiz kayıt." });
    }
    const d = ucusGovdesiniDogrula(govde);
    if (d.hata) return res.json({ success: false, message: d.hata });

    try {
        // Sadece oturumdaki kullanıcının kendi kaydı güncellenir
        const sonuc = await Flight.findOneAndUpdate({ _id: govde.id, userEmail: req.oturumEmail }, { $set: d.veri }, { new: true });
        if (!sonuc) return res.json({ success: false, message: "Kayıt bulunamadı." });
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/add-flight', oturumGerekli, async (req, res) => {
    const d = ucusGovdesiniDogrula(req.body);
    if (d.hata) return res.json({ success: false, message: d.hata });

    try {
        await new Flight({ userEmail: req.oturumEmail, ...d.veri }).save();
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

// =====================================================================
// YÖNETİM PANELİ
// Yalnızca ADMIN_EMAIL ortam değişkenindeki hesap(lar) erişebilir.
// Yönetici olmayanlara her adres 404 döner (sayfanın varlığı belli olmaz).
// =====================================================================

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Eski kayıtlarda e-posta büyük/küçük harf karışık saklanmış olabilir; bu yüzden harfe duyarsız eşleşir
function emailFiltresi(email) {
    return new RegExp('^' + escapeRegex(email) + '$', 'i');
}

function epostaTemizle(deger) {
    return metinMi(deger) ? deger.trim().toLowerCase() : '';
}

function donemSiniri() {
    const simdi = new Date();
    const yil = simdi.getMonth() >= 8 ? simdi.getFullYear() + 1 : simdi.getFullYear();
    return { yil, bas: `${yil - 1}-09-01`, bit: `${yil}-09-01` };
}

function gunOncesiTarih(gun) {
    return new Date(Date.now() - gun * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

// Uçuş formunu doğrular; kullanıcı ve yönetici aynı kuralları kullanır
function ucusGovdesiniDogrula(g) {
    g = g || {};
    if (!metinMi(g.tarih) || !/^\d{4}-\d{2}-\d{2}$/.test(g.tarih) || isNaN(new Date(g.tarih).getTime())) {
        return { hata: "Geçersiz tarih." };
    }
    if (!HAVA_ARACLARI_LISTESI.includes(g.havaAraciTipi)) {
        return { hata: "Geçersiz hava aracı." };
    }
    if (!EGITIM_TIPLERI.includes(g.egitimTipi)) {
        return { hata: "Geçersiz eğitim sınıflandırması." };
    }
    const dakika = sureyiDakikayaCevir(g.sure);
    if (dakika === null || dakika <= 0) {
        return { hata: "Geçersiz uçuş süresi. Örnek: 2:10 veya 2.5" };
    }
    if (dakika > 24 * 60) {
        return { hata: "Uçuş süresi 24 saatten uzun olamaz." };
    }
    return {
        veri: {
            tarih: g.tarih,
            havaAraciTipi: g.havaAraciTipi,
            egitimTipi: g.egitimTipi,
            sure: dakikayiSaatMetnine(dakika),
            gorevAciklamasi: metinMi(g.gorevAciklamasi) ? g.gorevAciklamasi.trim().substring(0, 1000) : ''
        }
    };
}

function geciciSifreUret() {
    const BUYUK = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const KUCUK = 'abcdefghijkmnpqrstuvwxyz';
    const RAKAM = '23456789';
    const hepsi = BUYUK + KUCUK + RAKAM;
    const sec = (k) => k[crypto.randomInt(k.length)];
    const harfler = [sec(BUYUK), sec(KUCUK), sec(RAKAM)];
    while (harfler.length < 10) harfler.push(sec(hepsi));
    for (let i = harfler.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [harfler[i], harfler[j]] = [harfler[j], harfler[i]];
    }
    return harfler.join('');
}

async function logYaz(admin, islem, hedef, detay) {
    try {
        await new AdminLog({ admin, islem, hedef, detay: String(detay || '').substring(0, 500) }).save();
    } catch (e) {
        console.error('Yönetim günlüğü yazılamadı:', e);
    }
}

// Sayfa istekleri için: yönetici değilse 404
function adminSayfaGerekli(req, res, next) {
    const oturum = oturumOku(req);
    if (!oturum || !adminMi(oturum.email)) return res.status(404).send('Bulunamadı');
    req.adminEmail = oturum.email;
    if (!oturum.kalici) oturumCerezYaz(req, res, oturum.email, false);
    next();
}

// API istekleri için: yönetici değilse 404; değişiklik isteklerinde özel başlık şart
// (başka bir sitedeki form veya betik bu başlığı gönderemez)
function adminApiGerekli(req, res, next) {
    const oturum = oturumOku(req);
    if (!oturum || !adminMi(oturum.email)) return res.status(404).json({ success: false, message: 'Bulunamadı' });
    if (req.method !== 'GET' && req.headers['x-yonetim'] !== '1') {
        return res.status(403).json({ success: false, message: 'Geçersiz istek.' });
    }
    req.adminEmail = oturum.email;
    if (!oturum.kalici) oturumCerezYaz(req, res, oturum.email, false);
    next();
}

const ADMIN_DOSYALARI = {
    '/admin': 'index.html',
    '/admin/admin.css': 'admin.css',
    '/admin/admin.js': 'admin.js'
};
Object.keys(ADMIN_DOSYALARI).forEach(url => {
    app.get(url, adminSayfaGerekli, (req, res) => {
        const yol = path.join(__dirname, 'admin', ADMIN_DOSYALARI[url]);
        if (!fs.existsSync(yol)) {
            console.error(`❌ Yönetim dosyası bulunamadı: ${yol}`);
            return res.status(404).send('Yönetim dosyası sunucuda bulunamadı.');
        }
        res.set('Cache-Control', 'no-store');
        res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
        res.sendFile(yol);
    });
});

// Tüm kullanıcılar için uçuş sayısı, toplam saat, dönem saati ve son uçuş tarihi
async function kullaniciOzetleriniHesapla() {
    const [kullanicilar, ucuslar] = await Promise.all([
        User.find({}, 'email').lean(),
        Flight.find({}, 'userEmail tarih sure').lean()
    ]);
    const donem = donemSiniri();
    const harita = new Map();
    kullanicilar.forEach(u => {
        const e = String(u.email || '').toLowerCase();
        harita.set(e, {
            email: u.email,
            kayit: u._id && u._id.getTimestamp ? u._id.getTimestamp().toISOString() : null,
            ucusSayisi: 0,
            toplamDakika: 0,
            donemDakika: 0,
            sonUcus: null
        });
    });
    ucuslar.forEach(f => {
        const k = harita.get(String(f.userEmail || '').toLowerCase());
        if (!k) return;
        const dk = sureMetniDakika(f.sure);
        k.ucusSayisi++;
        k.toplamDakika += dk;
        if (f.tarih && f.tarih >= donem.bas && f.tarih < donem.bit) k.donemDakika += dk;
        if (f.tarih && (!k.sonUcus || f.tarih > k.sonUcus)) k.sonUcus = f.tarih;
    });
    return { liste: Array.from(harita.values()), donem };
}

app.get('/api/admin/kullanicilar', adminApiGerekli, async (req, res) => {
    try {
        const { liste, donem } = await kullaniciOzetleriniHesapla();
        const simdi = new Date();
        const ayBasi = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
        const otuzGun = gunOncesiTarih(30);
        const ozet = {
            kullaniciSayisi: liste.length,
            buAyKayit: liste.filter(u => u.kayit && new Date(u.kayit) >= ayBasi).length,
            aktif30: liste.filter(u => u.sonUcus && u.sonUcus >= otuzGun).length,
            ucusSayisi: liste.reduce((t, u) => t + u.ucusSayisi, 0),
            toplamDakika: liste.reduce((t, u) => t + u.toplamDakika, 0),
            donemDakika: liste.reduce((t, u) => t + u.donemDakika, 0)
        };
        res.json({ success: true, ozet, kullanicilar: liste, donem: { yil: donem.yil, bas: donem.bas, bit: donem.bit, hedefDakika: DONEM_HEDEF_SAAT * 60 }, adminEmail: req.adminEmail });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Liste alınamadı.' });
    }
});

app.get('/api/admin/kullanici', adminApiGerekli, async (req, res) => {
    const email = epostaTemizle(req.query && req.query.email);
    if (!email) return res.json({ success: false, message: 'E-posta gerekli.' });
    try {
        const user = await User.findOne({ email }, 'email').lean();
        if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

        const ucuslar = await Flight.find({ userEmail: emailFiltresi(email) })
            .sort({ tarih: -1 })
            .lean();
        const tarihler = await ReportDate.find({ userEmail: emailFiltresi(email) }).lean();
        const donem = donemSiniri();

        res.json({
            success: true,
            kullanici: {
                email: user.email,
                kayit: user._id && user._id.getTimestamp ? user._id.getTimestamp().toISOString() : null
            },
            ucuslar: ucuslar.map(f => ({
                id: String(f._id),
                tarih: f.tarih,
                havaAraciTipi: f.havaAraciTipi,
                egitimTipi: f.egitimTipi,
                sure: f.sure,
                gorevAciklamasi: f.gorevAciklamasi || ''
            })),
            tarihler: tarihler.map(t => ({ alan: t.alan, tarih: t.tarih })),
            donem: { yil: donem.yil, bas: donem.bas, bit: donem.bit, hedefDakika: DONEM_HEDEF_SAAT * 60 },
            araclar: HAVA_ARACLARI_LISTESI,
            egitimTipleri: EGITIM_TIPLERI
        });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Kullanıcı bilgisi alınamadı.' });
    }
});

// Geçici şifre üretir ve kaydeder; yeni şifre yalnızca bu yanıtta görünür
app.post('/api/admin/sifre-sifirla', adminApiGerekli, async (req, res) => {
    const email = epostaTemizle(req.body && req.body.email);
    try {
        const user = await User.findOne({ email });
        if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

        const sifre = geciciSifreUret();
        user.password = await bcrypt.hash(sifre, 10);
        await user.save();
        await logYaz(req.adminEmail, 'Şifre sıfırlandı', email, 'Geçici şifre üretildi');
        res.json({ success: true, sifre });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Şifre sıfırlanamadı.' });
    }
});

// Hesabı, uçuşlarını ve kayıtlı tarihlerini siler. Onay için e-postanın aynen yazılması gerekir.
app.delete('/api/admin/kullanici', adminApiGerekli, async (req, res) => {
    const email = epostaTemizle(req.body && req.body.email);
    const onay = epostaTemizle(req.body && req.body.onay);
    if (!email || onay !== email) return res.json({ success: false, message: 'Onay için e-posta adresini aynen yazın.' });
    if (email === req.adminEmail) return res.json({ success: false, message: 'Kendi hesabınızı buradan silemezsiniz.' });

    try {
        const user = await User.findOne({ email });
        if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

        const ucusSonuc = await Flight.deleteMany({ userEmail: emailFiltresi(email) });
        const tarihSonuc = await ReportDate.deleteMany({ userEmail: emailFiltresi(email) });
        await User.deleteOne({ email });

        const ucusAdedi = (ucusSonuc && ucusSonuc.deletedCount) || 0;
        const tarihAdedi = (tarihSonuc && tarihSonuc.deletedCount) || 0;
        await logYaz(req.adminEmail, 'Hesap silindi', email, `${ucusAdedi} uçuş ve ${tarihAdedi} tarih kaydı da silindi`);
        res.json({ success: true, silinenUcus: ucusAdedi });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Hesap silinemedi.' });
    }
});

app.post('/api/admin/ucus', adminApiGerekli, async (req, res) => {
    const email = epostaTemizle(req.body && req.body.email);
    const d = ucusGovdesiniDogrula(req.body);
    if (d.hata) return res.json({ success: false, message: d.hata });
    try {
        const user = await User.findOne({ email }, 'email').lean();
        if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

        await new Flight({ userEmail: user.email, ...d.veri }).save();
        await logYaz(req.adminEmail, 'Uçuş eklendi', email, `${d.veri.tarih} ${d.veri.havaAraciTipi} ${d.veri.egitimTipi} ${d.veri.sure}`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Uçuş eklenemedi.' });
    }
});

app.put('/api/admin/ucus', adminApiGerekli, async (req, res) => {
    const id = req.body && req.body.id;
    if (!metinMi(id) || !mongoose.isValidObjectId(id)) return res.json({ success: false, message: 'Geçersiz kayıt.' });
    const d = ucusGovdesiniDogrula(req.body);
    if (d.hata) return res.json({ success: false, message: d.hata });
    try {
        const ucus = await Flight.findById(id);
        if (!ucus) return res.json({ success: false, message: 'Uçuş kaydı bulunamadı.' });

        const eski = `${ucus.tarih} ${ucus.havaAraciTipi} ${ucus.egitimTipi} ${ucus.sure}`;
        ucus.tarih = d.veri.tarih;
        ucus.havaAraciTipi = d.veri.havaAraciTipi;
        ucus.egitimTipi = d.veri.egitimTipi;
        ucus.sure = d.veri.sure;
        ucus.gorevAciklamasi = d.veri.gorevAciklamasi;
        await ucus.save();
        await logYaz(req.adminEmail, 'Uçuş düzenlendi', String(ucus.userEmail || '').toLowerCase(), `Önce: ${eski} → Sonra: ${d.veri.tarih} ${d.veri.havaAraciTipi} ${d.veri.egitimTipi} ${d.veri.sure}`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Uçuş güncellenemedi.' });
    }
});

app.delete('/api/admin/ucus', adminApiGerekli, async (req, res) => {
    const id = req.body && req.body.id;
    if (!metinMi(id) || !mongoose.isValidObjectId(id)) return res.json({ success: false, message: 'Geçersiz kayıt.' });
    try {
        const ucus = await Flight.findByIdAndDelete(id);
        if (!ucus) return res.json({ success: false, message: 'Uçuş kaydı bulunamadı.' });
        await logYaz(req.adminEmail, 'Uçuş silindi', String(ucus.userEmail || '').toLowerCase(), `${ucus.tarih} ${ucus.havaAraciTipi} ${ucus.egitimTipi} ${ucus.sure}`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Uçuş silinemedi.' });
    }
});

// Muayene, alet kart ve standardizasyon başlangıç tarihleri. Boş tarih gönderilirse kayıt temizlenir.
app.post('/api/admin/tarih', adminApiGerekli, async (req, res) => {
    const email = epostaTemizle(req.body && req.body.email);
    const { alan, tarih } = req.body || {};
    if (!IZINLI_TARIH_ALANLARI.includes(alan)) return res.json({ success: false, message: 'Geçersiz alan.' });
    try {
        const user = await User.findOne({ email }, 'email').lean();
        if (!user) return res.json({ success: false, message: 'Kullanıcı bulunamadı.' });

        if (tarih === '' || tarih === null || tarih === undefined) {
            await ReportDate.deleteMany({ userEmail: emailFiltresi(email), alan });
            await logYaz(req.adminEmail, 'Tarih temizlendi', email, alan);
            return res.json({ success: true });
        }
        if (!metinMi(tarih) || !/^\d{4}-\d{2}-\d{2}$/.test(tarih) || isNaN(new Date(tarih).getTime())) {
            return res.json({ success: false, message: 'Geçersiz tarih.' });
        }
        await ReportDate.findOneAndUpdate({ userEmail: email, alan }, { tarih }, { upsert: true, new: true });
        await logYaz(req.adminEmail, 'Tarih değiştirildi', email, `${alan} = ${tarih}`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Tarih kaydedilemedi.' });
    }
});

app.get('/api/admin/gunluk', adminApiGerekli, async (req, res) => {
    try {
        const kayitlar = await AdminLog.find({}).sort({ zaman: -1 }).limit(200).lean();
        res.json({
            success: true,
            kayitlar: kayitlar.map(k => ({ zaman: k.zaman, admin: k.admin, islem: k.islem, hedef: k.hedef, detay: k.detay }))
        });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Geçmiş alınamadı.' });
    }
});

// CSV: Excel'in Türkçe ayarlarında doğru açılması için ayırıcı ";" ve BOM kullanılır.
// "=", "+", "-", "@" ile başlayan hücreler formül sayılmasın diye başına ' eklenir.
function csvHucre(deger) {
    let s = String(deger === undefined || deger === null ? '' : deger);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function csvGonder(res, dosyaAdi, satirlar) {
    const govde = '﻿' + satirlar.map(s => s.map(csvHucre).join(';')).join('\r\n') + '\r\n';
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${dosyaAdi}"`);
    res.set('Cache-Control', 'no-store');
    res.send(govde);
}

app.get('/api/admin/csv', adminApiGerekli, async (req, res) => {
    const tur = req.query && req.query.tur;
    const bugun = new Date().toISOString().slice(0, 10);
    try {
        if (tur === 'kullanicilar') {
            const { liste } = await kullaniciOzetleriniHesapla();
            const satirlar = [['E-posta', 'Kayıt Tarihi', 'Uçuş Sayısı', 'Toplam Saat', 'Dönem Saati', 'Son Uçuş']];
            liste.forEach(u => satirlar.push([
                u.email,
                u.kayit ? u.kayit.slice(0, 10) : '',
                u.ucusSayisi,
                dakikayiSaatMetnine(u.toplamDakika),
                dakikayiSaatMetnine(u.donemDakika),
                u.sonUcus || ''
            ]));
            return csvGonder(res, `kullanicilar-${bugun}.csv`, satirlar);
        }
        if (tur === 'ucuslar') {
            const ucuslar = await Flight.find({}).sort({ userEmail: 1, tarih: -1 }).lean();
            const satirlar = [['E-posta', 'Tarih', 'Hava Aracı', 'Eğitim', 'Süre', 'Görev Açıklaması']];
            ucuslar.forEach(f => satirlar.push([f.userEmail, f.tarih, f.havaAraciTipi, f.egitimTipi, f.sure, f.gorevAciklamasi || '']));
            return csvGonder(res, `ucuslar-${bugun}.csv`, satirlar);
        }
        res.status(400).json({ success: false, message: 'Geçersiz tür.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, message: 'Dışa aktarılamadı.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sunucu aktif."));
