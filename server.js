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
const OTURUM_SURESI_MS = 1000 * 60 * 60 * 24 * 30; // 30 gün

function oturumImzala(deger) {
    return crypto.createHmac('sha256', OTURUM_SECRET).update(deger).digest('hex');
}

function oturumCerezOlustur(email) {
    const payload = Buffer.from(JSON.stringify({ e: email, t: Date.now() })).toString('base64url');
    return `${payload}.${oturumImzala(payload)}`;
}

function oturumEmailOku(req) {
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
        if (Date.now() - veri.t > OTURUM_SURESI_MS) return null;
        return veri.e;
    } catch (e) {
        return null;
    }
}

function oturumCerezYaz(req, res, email) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `oturum=${encodeURIComponent(oturumCerezOlustur(email))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OTURUM_SURESI_MS / 1000}${secure}`);
}

function oturumCerezSil(req, res) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `oturum=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

// API için oturum doğrulama: e-posta istemciden değil, imzalı çerezden alınır
function oturumGerekli(req, res, next) {
    const email = oturumEmailOku(req);
    if (!email) {
        return res.status(401).json({ success: false, message: "Oturum süresi doldu, lütfen tekrar giriş yapın." });
    }
    req.oturumEmail = email;
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
    password: String
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


// --- SABİTLER ---

const DONEM_HEDEF_SAAT = 140;
const IZINLI_TARIH_ALANLARI = ['muayene1Tarih', 'muayene4Tarih', 'aletKartTarih', 'standTarih'];
const HAVA_ARACLARI_LISTESI = ['s70', 's70i', 't70', 'atak', 'mi17', 'gökbey', 'cayrokopter', 'ab-205'];
const EGITIM_TIPLERI = ['ggg', 'gş', 'au(sim)'];
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

    return {
        yil: aktifDonemYili,
        sure: dakikayiSaatMetnine(toplamDakika),
        kalan: dakikayiSaatMetnine(kalanDakika),
        donemUcuslari: donemUcuslari
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
    return `<div class="sayac" data-eylem="tarih-modal" data-alan="${esc(alan)}" data-etiket="${esc(etiket)}" data-tarih="${esc(baslangicTarihi)}" style="background:${renk};"><strong>${esc(etiket)}</strong><br><span class="sayac-deger">${esc(kalanGun)} Gün</span><span class="tarih-etiket">Son Tarih: ${esc(formatTRTarih(hedef))}</span></div>`;
}

function ucusSatiriHtml(f) {
    const id = esc(f._id);
    const aciklama = f.gorevAciklamasi || '';
    const kisa = aciklama.length > 40 ? aciklama.substring(0, 40) + '...' : aciklama;
    return `
        <tr id="row-${id}" class="ucus-satiri" data-eylem="detay" data-id="${id}" data-tarih="${esc(f.tarih)}" data-hava="${esc(f.havaAraciTipi)}" data-egitim="${esc(f.egitimTipi)}" data-sure="${esc(f.sure)}">
            <td class="c-tarih">${esc(f.tarih)}</td>
            <td class="c-arac">${esc(f.havaAraciTipi)}</td>
            <td class="c-egitim">${esc(f.egitimTipi)}</td>
            <td class="c-sure">${esc(f.sure)}</td>
            <td class="c-aciklama" title="${esc(aciklama)}">${esc(kisa)}</td>
            <td class="c-islem"><button type="button" class="sil-btn" data-eylem="ucus-sil" data-id="${id}">Sil</button></td>
        </tr>
        <tr id="detay-${id}" class="detay-satiri">
            <td colspan="6">
                <div class="detay-baslik">📋 Tam Görev Açıklaması:</div>
                <div class="detay-kutu">${aciklama ? esc(aciklama) : 'Görev açıklaması girilmemiş.'}</div>
            </td>
        </tr>`;
}

function panelHtmlOlustur(email, flights, kayitliTarihler) {
    const toplamUcusSuresi = hesaplaToplamSaat(flights);
    const aktifDonem = hesaplaAktifDonemSaati(flights);
    const gggDurum = hesaplaGggVeSonUcusDurumu(flights);
    const aracBazliDurum = hesaplaAracaGoreDetayliDurum(flights);

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
                        <span class="user-email-link" data-eylem="sifre-modal" title="Şifreyi Değiştirmek İçin Tıkla">${esc(email)}</span>
                        <a class="cikis-link" href="/logout">Çıkış</a>
                    </div>
                </div>

                <div class="sayac-grid">
                    <div class="sayac" data-eylem="sayac-modal" data-tip="ggg" style="background:${gggDurum.renkGgg};" title="Tüm Araçların GGG Durumunu Gör">
                        <strong>GGG Sayaç (60G)</strong><br><span class="sayac-deger">${esc(gggDurum.kalanGgg)}</span>
                        <span class="tarih-etiket">Son Tarih: ${esc(gggDurum.hedefGggStr)}</span>
                    </div>
                    <div class="sayac" data-eylem="sayac-modal" data-tip="sonUcus" style="background:${gggDurum.renkSonUcus};" title="Tüm Araçların Son Uçuş Durumunu Gör">
                        <strong>Son Uçuş (60G)</strong><br><span class="sayac-deger">${esc(gggDurum.kalanSonUcus)}</span>
                        <span class="tarih-etiket">Son Tarih: ${esc(gggDurum.hedefSonUcusStr)}</span>
                    </div>
                    ${tarihSayaciHtml(tarihBul('muayene1Tarih'), 1, '1 Yıllık Muayene', 'muayene1Tarih')}
                    ${tarihSayaciHtml(tarihBul('muayene4Tarih'), 4, '4 Yıllık Muayene', 'muayene4Tarih')}
                    ${tarihSayaciHtml(tarihBul('aletKartTarih'), 1, 'Alet Kart', 'aletKartTarih')}
                    ${tarihSayaciHtml(tarihBul('standTarih'), 1, 'Standardizasyon', 'standTarih')}
                </div>
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

        <!-- ŞİFRE GÜNCELLEME MODALI -->
        <div id="sifreModal" class="modal-arka" role="dialog" aria-modal="true">
            <div class="modal-kutu dar">
                <h3 class="modal-baslik">🔐 Şifre Güncelleme</h3>
                <label for="eskiSifre">Mevcut Şifre:</label>
                <input type="password" id="eskiSifre" placeholder="Mevcut şifreniz" autocomplete="current-password">
                <label for="yeniSifre1">Yeni Şifre:</label>
                <input type="password" id="yeniSifre1" placeholder="En az 8 karakter, 1 büyük, 1 rakam" autocomplete="new-password">
                <label for="yeniSifre2">Yeni Şifre (Tekrar):</label>
                <input type="password" id="yeniSifre2" placeholder="Yeni şifreyi tekrar girin" autocomplete="new-password">
                <div class="modal-butonlar">
                    <button type="button" class="btn-tamam" data-eylem="sifre-guncelle">Güncelle</button>
                    <button type="button" class="btn-iptal" data-eylem="modal-kapat" data-modal="sifreModal">İptal</button>
                </div>
            </div>
        </div>

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
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Uçuş Takip Paneli</title>
    <link rel="stylesheet" href="/panel.css">
</head>
<body>
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
    const email = oturumEmailOku(req);
    if (!email) return res.redirect('/');
    req.oturumEmail = email;
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

        oturumCerezYaz(req, res, email);

        const flights = await Flight.find({ userEmail: email }).sort({ tarih: -1 });
        const kayitliTarihler = await ReportDate.find({ userEmail: email });

        res.set('Cache-Control', 'no-store');
        res.send(panelHtmlOlustur(email, flights, kayitliTarihler));
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


// --- API (hepsi oturum çerezi gerektirir) ---

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

app.post('/api/add-flight', oturumGerekli, async (req, res) => {
    const { tarih, havaAraciTipi, egitimTipi, sure, gorevAciklamasi } = req.body || {};

    if (!metinMi(tarih) || !/^\d{4}-\d{2}-\d{2}$/.test(tarih) || isNaN(new Date(tarih).getTime())) {
        return res.json({ success: false, message: "Geçersiz tarih." });
    }
    if (!HAVA_ARACLARI_LISTESI.includes(havaAraciTipi)) {
        return res.json({ success: false, message: "Geçersiz hava aracı." });
    }
    if (!EGITIM_TIPLERI.includes(egitimTipi)) {
        return res.json({ success: false, message: "Geçersiz eğitim sınıflandırması." });
    }

    const dakika = sureyiDakikayaCevir(sure);
    if (dakika === null || dakika <= 0) {
        return res.json({ success: false, message: "Geçersiz uçuş süresi. Örnek: 2:10 veya 2.5" });
    }
    if (dakika > 24 * 60) {
        return res.json({ success: false, message: "Uçuş süresi 24 saatten uzun olamaz." });
    }

    try {
        const nf = new Flight({
            userEmail: req.oturumEmail,
            tarih,
            havaAraciTipi,
            egitimTipi,
            sure: dakikayiSaatMetnine(dakika),
            gorevAciklamasi: metinMi(gorevAciklamasi) ? gorevAciklamasi.trim().substring(0, 1000) : ''
        });
        await nf.save();
        res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sunucu aktif."));
