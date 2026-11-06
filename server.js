const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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


// --- YARDIMCI FONKSİYONLAR ---

function formatUcusSaati(saatInput) {
    if (!saatInput) return "00:00";
    let inputStr = saatInput.toString().trim();

    if (inputStr.includes(':')) {
        let [saatPart, dakikaPart] = inputStr.split(':').map(Number);
        if (isNaN(saatPart)) saatPart = 0;
        if (isNaN(dakikaPart)) dakikaPart = 0;
        return `${saatPart.toString().padStart(2, '0')}:${dakikaPart.toString().padStart(2, '0')}`;
    } 
    
    let num = parseFloat(inputStr);
    if (isNaN(num)) return "00:00";
    let saat = Math.floor(num);
    let dakika = Math.round((num - saat) * 60);
    return `${saat.toString().padStart(2, '0')}:${dakika.toString().padStart(2, '0')}`;
}

function hesaplaToplamSaat(flights) {
    let toplamDakika = 0;
    flights.forEach(f => {
        if (f.sure && f.sure.includes(':')) {
            const [saat, dakika] = f.sure.split(':').map(Number);
            toplamDakika += (saat * 60) + dakika;
        }
    });
    let toplamSaat = Math.floor(toplamDakika / 60);
    let kalanDakika = toplamDakika % 60;
    return `${toplamSaat.toString().padStart(2, '0')}:${kalanDakika.toString().padStart(2, '0')}`;
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
    flights.forEach(f => {
        if (f.tarih) {
            const ucusTarihi = new Date(f.tarih);
            if (ucusTarihi >= baslangicTarihi && ucusTarihi < bitisTarihi) {
                if (f.sure && f.sure.includes(':')) {
                    const [saat, dakika] = f.sure.split(':').map(Number);
                    toplamDakika += (saat * 60) + dakika;
                }
            }
        }
    });

    let saat = Math.floor(toplamDakika / 60);
    let dakika = toplamDakika % 60;
    return {
        yil: aktifDonemYili,
        sure: `${saat.toString().padStart(2, '0')}:${dakika.toString().padStart(2, '0')}`
    };
}

function getGunFarki(hedefTarih) {
    if (!hedefTarih) return null;
    const bugun = new Date();
    const healer = new Date(hedefTarih);
    const zamanFarki = healer.getTime() - bugun.getTime();
    return Math.ceil(zamanFarki / (1000 * 3600 * 24));
}

function formatTRTarih(dateObj) {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return "";
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
}

function hesaplaGggVeSonUcusDurumu(flights) {
    const sonUcus = flights[0];
    const sonGggUcus = flights.find(f => f.egitimTipi === 'ggg');
    
    const sonUcusTarihStr = sonUcus ? sonUcus.tarih : new Date().toISOString().split('T')[0];
    const sonGggTarihStr = sonGggUcus ? sonGggUcus.tarih : new Date().toISOString().split('T')[0];

    const hedefGgg = new Date(sonGggTarihStr); hedefGgg.setDate(hedefGgg.getDate() + 60);
    const hedefSonUcus = new Date(sonUcusTarihStr); hedefSonUcus.setDate(hedefSonUcus.getDate() + 60);

    const kalanGgg = getGunFarki(hedefGgg);
    const kalanSonUcus = getGunFarki(hedefSonUcus);

    const renkGgg = kalanGgg <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';
    const renkSonUcus = kalanSonUcus <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';

    return {
        kalanGgg,
        hedefGggStr: formatTRTarih(hedefGgg),
        renkGgg,
        kalanSonUcus,
        hedefSonUcusStr: formatTRTarih(hedefSonUcus),
        renkSonUcus
    };
}


// --- ROTALAR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.redirect('/');
});
app.get('/register', (req, res) => {
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email.trim().toLowerCase() });
        if (!user) {
            return res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Kullanıcı Bulunamadı!</h1><p>Bu e-posta adresi sistemde kayıtlı değil.</p><a href="/">Geri Dön</a></div>`);
        }

        const dbPassword = user.password;
        let isMatch = await bcrypt.compare(password, dbPassword);
        if (!isMatch && password === dbPassword) isMatch = true;

        if (isMatch) {
            const flights = await Flight.find({ userEmail: email.trim().toLowerCase() }).sort({ tarih: -1 });
            const toplamUcusSüresi = hesaplaToplamSaat(flights);
            const aktifDonem = hesaplaAktifDonemSaati(flights);
            const gggDurum = hesaplaGggVeSonUcusDurumu(flights);

            const kayitliTarihler = await ReportDate.find({ userEmail: email.trim().toLowerCase() });
            const staticYears = Array.from({length: 10}, (_, i) => 2024 + i);
            const bugunTarihStr = new Date().toISOString().split('T')[0];

            const tarihBul = (alanAdi) => {
                const bulma = kayitliTarihler.find(t => t.alan === alanAdi);
                return bulma ? bulma.tarih : null;
            };

            const tMuayene1 = tarihBul('muayene1Tarih');
            const tMuayene4 = tarihBul('muayene4Tarih');
            const tAlet = tarihBul('aletKartTarih');
            const tStand = tarihBul('standTarih');

            const hesaplaTarihliSayaç = (baslangicTarihi, periyotYil, etiket, teknikAlan) => {
                if (!baslangicTarihi) {
                    return { 
                        gun: null, 
                        hamTarih: "",
                        sonTarihStr: "",
                        html: `<div onclick="tarihSecimiAc('${etiket}', '${teknikAlan}', '')" style="background:#f1f2f6; color:#2c3e50; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer; border:2px dashed #bdc3c7;"><strong>${etiket}</strong><br><span style="font-size:11px; font-weight:bold; color:#c0392b; display:inline-block; margin-top:4px;">⚠️ TARİH GİRİLMEDİ</span></div>` 
                    };
                }
                const hedef = new Date(baslangicTarihi);
                hedef.setFullYear(hedef.getFullYear() + periyotYil);
                const kalanGün = getGunFarki(hedef);
                let renk = kalanGün <= 90 ? 'background:#e74c3c;' : 'background:#3498db;';
                return { gun: kalanGün, renk: renk, hamTarih: baslangicTarihi, sonTarihStr: formatTRTarih(hedef) };
            };

            const sMuayene1 = hesaplaTarihliSayaç(tMuayene1, 1, '1 Yıllık Muayene', 'muayene1Tarih');
            const sMuayene4 = hesaplaTarihliSayaç(tMuayene4, 4, '4 Yıllık Muayene', 'muayene4Tarih');
            const sAlet = hesaplaTarihliSayaç(tAlet, 1, 'Alet Kart', 'aletKartTarih');
            const sStand = hesaplaTarihliSayaç(tStand, 1, 'Standardizasyon', 'standTarih');

            res.send(`
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                    body { background: #f5f6fa; margin: 0; padding: 8px; font-family:'Segoe UI', sans-serif; }
                    .container { max-width:900px; margin:5px auto; padding:12px; border-radius:12px; background:#fff; box-shadow: 0 4px 15px rgba(0,0,0,0.05); box-sizing: border-box; }
                    .ust-panel { display: flex; flex-direction: column; gap: 12px; margin-bottom: 15px; }
                    .saatler-wrapper { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 5px; }
                    .sayac-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
                    .form-grid { display: flex; flex-direction: column; gap: 10px; background:#f9f9f9; padding:12px; border-radius:10px; margin-bottom:15px; box-sizing: border-box; }
                    
                    /* 🎯 AÇILIR KAPANIR FİLTRE KUTUSU STİLLERİ */
                    .filtre-container { background: #eef1f4; border-radius: 10px; margin-bottom: 15px; overflow: hidden; border: 1px solid #dcdde1; }
                    .filtre-toggle-btn { width: 100%; padding: 14px; background: #dfe4ea; border: none; font-weight: bold; font-size: 14px; color: #2f3640; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
                    .filtre-icerik { max-height: 0; overflow: hidden; transition: max-height 0.35s ease-out; padding: 0 12px; background: #eef1f4; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
                    .filtre-icerik.acik { max-height: 450px; padding: 12px; transition: max-height 0.35s ease-in; }

                    .tarih-etiket { font-size: 10px; display: block; margin-top: 4px; opacity: 0.85; font-weight: bold; }
                    
                    @media(min-width: 768px) { 
                        .ust-panel { display: grid; grid-template-columns: 2fr 3fr; } 
                        .sayac-grid { grid-template-columns: repeat(3, 1fr); }
                        .form-grid { display: grid; grid-template-columns: 1fr 1fr; }
                        .span-mobil-2 { grid-column: span 2; }
                        .filtre-icerik { flex-direction: row; flex-wrap: wrap; align-items: center; }
                    }

                    label { font-weight: bold; font-size: 13px; color: #34495e; display: block; margin-bottom: 4px; }
                    
                    input, select, textarea { 
                        width: 100%; 
                        height: 46px; 
                        padding: 0 12px; 
                        border: 1px solid #ccc; 
                        border-radius: 6px; 
                        box-sizing: border-box; 
                        font-size: 15px; 
                        background: #fff; 
                        line-height: normal;
                    }
                    textarea { height: 60px; padding: 10px 12px; resize: none; }
                    input[type="date"] { appearance: none; -webkit-appearance: none; }

                    button { padding: 12px; border: none; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; width: 100%; box-sizing: border-box; }
                    .btn-ekle { background:#2ecc71; color:white; }
                    .btn-filtre { background:#34495e; color:white; }
                    .btn-temizle { background:#7f8c8d; color:white; }
                    @media(min-width: 768px) { .btn-filtre, .btn-temizle { width: auto; padding: 10px 20px; height: 46px; } }
                    
                    .tablo-sarmal { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-top: 15px; border-radius: 8px; border: 1px solid #eee; }
                    table { width: 100%; border-collapse: collapse; min-width: 600px; font-size: 14px; }
                    th { background: #2c3e50; color: white; padding: 12px; }
                    td { padding: 12px; border-bottom: 1px solid #eee; text-align: center; }
                    .sil-btn { background:#e74c3c; color:white; padding:6px 12px; border-radius:4px; font-size:12px; width:auto; }
                    .sayfalama-alani { display: flex; justify-content: center; align-items: center; gap: 5px; margin-top: 15px; padding: 10px 0; }
                    .sayfa-btn { width: auto; padding: 8px 14px; background: #fff; border: 1px solid #ddd; color: #333; font-size: 14px; border-radius: 4px; }
                    .sayfa-btn.aktif { background: #2c3e50; color: white; border-color: #2c3e50; }
                </style>

                <div class="container">
                    
                    <div class="ust-panel">
                        <div style="background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 15px; border-radius: 10px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                            <div class="saatler-wrapper">
                                <div>
                                    <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9;">TOPLAM SAAT</span>
                                    <h2 id="toplamSaatGosterge" style="margin: 3px 0; font-size: 26px; font-weight: bold;">${toplamUcusSüresi}</h2>
                                </div>
                                <div>
                                    <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.9;">${aktifDonem.yil} DÖNEMİ</span>
                                    <h2 id="donemSaatGosterge" style="margin: 3px 0; font-size: 26px; font-weight: bold; color: #f1c40f;">${aktifDonem.sure}</h2>
                                </div>
                            </div>
                            <p style="margin:5px 0 0 0; font-size:11px; opacity:0.8; word-break:break-all;">${email}</p>
                        </div>

                        <div class="sayac-grid">
                            <div id="boxGgg" style="${gggDurum.renkGgg} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>GGG Sayaç (60G)</strong><br><span id="valGgg" style="font-size:18px; font-weight:bold;">${gggDurum.kalanGgg} Gün</span>
                                <span id="tarihGgg" class="tarih-etiket">Son Tarih: ${gggDurum.hedefGggStr}</span>
                            </div>
                            <div id="boxSonUcus" style="${gggDurum.renkSonUcus} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Son Uçuş (60G)</strong><br><span id="valSonUcus" style="font-size:18px; font-weight:bold;">${gggDurum.kalanSonUcus} Gün</span>
                                <span id="tarihSonUcus" class="tarih-etiket">Son Tarih: ${gggDurum.hedefSonUcusStr}</span>
                            </div>
                            
                            ${sMuayene1.gun !== null ? `<div onclick="tarihSecimiAc('1 Yıllık Muayene', 'muayene1Tarih', '${sMuayene1.hamTarih}')" style="${sMuayene1.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>1 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene1.gun} Gün</span><span class="tarih-etiket">Son Tarih: ${sMuayene1.sonTarihStr}</span></div>` : sMuayene1.html}
                            ${sMuayene4.gun !== null ? `<div onclick="tarihSecimiAc('4 Yıllık Muayene', 'muayene4Tarih', '${sMuayene4.hamTarih}')" style="${sMuayene4.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>4 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene4.gun} Gün</span><span class="tarih-etiket">Son Tarih: ${sMuayene4.sonTarihStr}</span></div>` : sMuayene4.html}
                            ${sAlet.gun !== null ? `<div onclick="tarihSecimiAc('Alet Kart', 'aletKartTarih', '${sAlet.hamTarih}')" style="${sAlet.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Alet Kart</strong><br><span style="font-size:18px; font-weight:bold;">${sAlet.gun} Gün</span><span class="tarih-etiket">Son Tarih: ${sAlet.sonTarihStr}</span></div>` : sAlet.html}
                            ${sStand.gun !== null ? `<div onclick="tarihSecimiAc('Standardizasyon', 'standTarih', '${sStand.hamTarih}')" style="${sStand.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Standardizasyon</strong><br><span style="font-size:18px; font-weight:bold;">${sStand.gun} Gün</span><span class="tarih-etiket">Son Tarih: ${sStand.sonTarihStr}</span></div>` : sStand.html}
                        </div>
                    </div>

                    <!-- 🎯 AÇILIR KAPANIR FİLTRE KUTUSU -->
                    <div class="filtre-container">
                        <button type="button" class="filtre-toggle-btn" onclick="filtreyiAcKapat()">
                            <span>🔍 Geçmiş Uçuş Aramak İçin Tıkla</span>
                            <span id="filtreOkIkon">▼</span>
                        </button>
                        <div id="filtreIcerikKutusu" class="filtre-icerik">
                            <div style="flex:1; width:100%;"><label>📋 Yıl Seçimi (1 Eylül Dönemi):</label><select id="filtreYil"><option value="">Yıl Seçin</option>${staticYears.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
                            <div style="flex:1; width:100%;"><label>Ay:</label><select id="filtreAy"><option value="">Ay Seçin</option><option value="01">Ocak</option><option value="02">Şubat</option><option value="03">Mart</option><option value="04">Nisan</option><option value="05">Mayıs</option><option value="06">Haziran</option><option value="07">Temmuz</option><option value="08">Ağustos</option><option value="09">Eylül</option><option value="10">Ekim</option><option value="11">Kasım</option><option value="12">Aralık</option></select></div>
                            <div style="flex:1; width:100%;"><label>Hava Aracı:</label><select id="filtreHavaAraci"><option value="">Hava Aracı</option><option value="sikorsky">Sikorsky (s70, s70i, t70)</option><option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option><option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option></select></div>
                            <div style="flex:1; width:100%;"><label>Uçuş Tipi:</label><select id="filtreUcusTipi"><option value="">Uçuş Tipi</option><option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option></select></div>
                            <div style="display:flex; gap:8px; width:100%; margin-top:5px;"><button type="button" onclick="filtreleUcuslari()" class="btn-filtre">Uygula</button><button type="button" onclick="filtreleriTemizle()" class="btn-temizle">Temizle</button></div>
                            <div id="filtreSaatKutusu" style="background:#2c3e50; color:#fff; padding:10px; border-radius:6px; font-weight:bold; font-size:14px; display:none; width:100%; text-align:center;">⏱️ Filtrelenen Süre: <span id="filtreliSaatGosterge">00:00</span></div>
                        </div>
                    </div>

                    <div class="form-grid">
                        <input type="hidden" id="userEmail" value="${email}">
                        <div><label>Tarih:</label><input type="date" id="tarih" value="${bugunTarihStr}"></div>
                        <div><label>Hava Aracı Tipi:</label><select id="havaAraciTipi"><option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option><option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option></select></div>
                        <div><label>Eğitim Sınıflandırması:</label><select id="egitimTipi"><option value="" disabled selected>Lütfen Seçiniz</option><option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option></select></div>
                        <div><label>Uçuş Süresi (Örn: 2:10 veya 2.5):</label><input type="text" id="sure" placeholder="Süreyi girin"></div>
                        <div class="span-mobil-2"><label>Görev Açıklaması:</label><textarea id="gorevAciklamasi"></textarea></div>
                        <button type="button" onclick="kaydetYeniUcus()" class="btn-ekle span-mobil-2">✈️ Uçuşu Ekle</button>
                    </div>

                    <div class="tablo-sarmal">
                        <table>
                            <thead><tr><th>Tarih</th><th>Hava Aracı</th><th>Eğitim</th><th>Süre</th><th>Görev Açıklaması</th><th>İşlem</th></tr></thead>
                            <tbody id="ucusTabloGövde">
                                ${flights.map(f => `
                                    <tr id="row-${f._id}" class="ucus-satiri" data-tarih="${f.tarih}" data-hava="${f.havaAraciTipi}" data-egitim="${f.egitimTipi}" data-sure="${f.sure}">
                                        <td>${f.tarih}</td><td style="font-weight:bold;">${f.havaAraciTipi}</td><td>${f.egitimTipi}</td><td style="color:#e67e22; font-weight:bold;">${f.sure}</td><td style="text-align:left; font-size:13px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f.gorevAciklamasi || ''}</td><td><button type="button" onclick="silUcus('${f._id}')" class="sil-btn">Sil</button></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div id="sayfalamaAlani" class="sayfalama-alani"></div>

                </div>

                <div id="tarihModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); justify-content:center; align-items:center; z-index:9999; padding:15px; box-sizing:border-box;">
                    <div style="background:white; padding:20px; border-radius:10px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3); max-width:320px; width:100%;">
                        <h3 id="modalBaslik" style="color:#2c3e50; margin-top:0; font-size:16px; margin-bottom:5px;">Tarih Girin</h3>
                        <div id="modalMevcutTarihKutusu" style="font-size:12px; color:#7f8c8d; font-weight:bold; margin-bottom:15px; background:#f8f9fa; padding:6px; border-radius:4px;">Mevcut Kayıtlı Tarih: <span id="modalMevcutTarihText">-</span></div>
                        <input type="hidden" id="hedefAlan">
                        <input type="date" id="yeniKategoriTarih" style="margin-bottom:15px;">
                        <br>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <button type="button" onclick="kaydetKategoriTarihi()" style="background:#2ecc71; color:white;">Kaydet</button>
                            <button type="button" onclick="document.getElementById('tarihModal').style.display='none'" style="background:#95a5a6; color:white;">İptal</button>
                        </div>
                    </div>
                </div>

                <script>
                    let mevcutSayfa = 1;
                    const satirBasinaVeri = 10;

                    // 🎯 FİLTRE KUTUSUNU AÇIP KAPATAN FONKSİYON
                    function filtreyiAcKapat() {
                        const icerik = document.getElementById('filtreIcerikKutusu');
                        const ok = document.getElementById('filtreOkIkon');
                        if (icerik.classList.contains('acik')) {
                            icerik.classList.remove('acik');
                            ok.innerText = '▼';
                        } else {
                            icerik.classList.add('acik');
                            ok.innerText = '▲';
                        }
                    }

                    function tarihSecimiAc(etiketIsmi, alanAdi, hamTarih) {
                        document.getElementById('modalBaslik').innerText = etiketIsmi + " Başlangıç Tarihi";
                        document.getElementById('hedefAlan').value = alanAdi;
                        
                        const tTextAlan = document.getElementById('modalMevcutTarihText');
                        const inputTarih = document.getElementById('yeniKategoriTarih');

                        if(hamTarih && hamTarih !== 'null' && hamTarih !== '') {
                            const d = new Date(hamTarih);
                            const trFormati = \`\${d.getDate().toString().padStart(2, '0')}.\${(d.getMonth() + 1).toString().padStart(2, '0')}.\${d.getFullYear()}\`;
                            tTextAlan.innerText = trFormati;
                            inputTarih.value = hamTarih;
                        } else {
                            tTextAlan.innerText = "Girilmedi";
                            inputTarih.value = "";
                        }

                        document.getElementById('tarihModal').style.display = 'flex';
                    }

                    async function kaydetKategoriTarihi() {
                        const alan = document.getElementById('hedefAlan').value;
                        const tarihDegeri = document.getElementById('yeniKategoriTarih').value;
                        if(!tarihDegeri) { alert('Lütfen tarih seçin.'); return; }

                        const response = await fetch('/api/update-user-date', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userEmail: document.getElementById('userEmail').value,
                                alan: alan,
                                tarih: tarihDegeri
                            })
                        });
                        const sonuc = await response.json();
                        if(sonuc.success) {
                            alert('Tarih veritabanına işlendi!');
                            window.location.reload();
                        }
                    }

                    async function kaydetYeniUcus() {
                        const tarih = document.getElementById('tarih').value;
                        const havaAraciTipi = document.getElementById('havaAraciTipi').value;
                        const egitimTipi = document.getElementById('egitimTipi').value;
                        const sure = document.getElementById('sure').value;
                        const gorevAciklamasi = document.getElementById('gorevAciklamasi').value;

                        if(!tarih || !egitimTipi || !sure) {
                            alert("Lütfen Tarih, Eğitim Sınıflandırması ve Süre alanlarını eksiksiz doldurun.");
                            return;
                        }

                        if(!confirm("Yeni uçuş kaydını eklemek istiyor musunuz?")) return;

                        const veri = {
                            userEmail: document.getElementById('userEmail').value,
                            tarih: tarih,
                            havaAraciTipi: havaAraciTipi,
                            egitimTipi: egitimTipi,
                            sure: sure,
                            gorevAciklamasi: gorevAciklamasi
                        };

                        const response = await fetch('/api/add-flight', { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify(veri) 
                        });
                        
                        const sonuc = await response.json();
                        if(sonuc.success) {
                            const tbody = document.getElementById('ucusTabloGövde');
                            
                            const tr = document.createElement('tr');
                            tr.id = 'row-' + sonuc.data._id;
                            tr.className = 'ucus-satiri';
                            tr.setAttribute('data-tarih', sonuc.data.tarih);
                            tr.setAttribute('data-hava', sonuc.data.havaAraciTipi);
                            tr.setAttribute('data-egitim', sonuc.data.egitimTipi);
                            tr.setAttribute('data-sure', sonuc.data.sure);

                            tr.innerHTML = \`
                                <td>\${sonuc.data.tarih}</td>
                                <td style="font-weight:bold;">\${sonuc.data.havaAraciTipi}</td>
                                <td>\${sonuc.data.egitimTipi}</td>
                                <td style="color:#e67e22; font-weight:bold;">\${sonuc.data.sure}</td>
                                <td style="text-align:left; font-size:13px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${sonuc.data.gorevAciklamasi || ''}</td>
                                <td><button type="button" onclick="silUcus('\${sonuc.data._id}')" class="sil-btn">Sil</button></td>
                            \`;

                            tbody.insertBefore(tr, tbody.firstChild);
                            
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;
                            document.getElementById('donemSaatGosterge').innerText = sonuc.yeniDonemSaat;
                            
                            document.getElementById('valGgg').innerText = sonuc.gggDurum.kalanGgg + " Gün";
                            document.getElementById('tarihGgg').innerText = "Son Tarih: " + sonuc.gggDurum.hedefGggStr;
                            document.getElementById('boxGgg').style = sonuc.gggDurum.renkGgg + " color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;";

                            document.getElementById('valSonUcus').innerText = sonuc.gggDurum.kalanSonUcus + " Gün";
                            document.getElementById('tarihSonUcus').innerText = "Son Tarih: " + sonuc.gggDurum.hedefSonUcusStr;
                            document.getElementById('boxSonUcus').style = sonuc.gggDurum.renkSonUcus + " color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;";

                            const bugunStr = new Date().toISOString().split('T')[0];
                            document.getElementById('tarih').value = bugunStr;
                            document.getElementById('egitimTipi').value = '';
                            document.getElementById('sure').value = '';
                            document.getElementById('gorevAciklamasi').value = '';

                            mevcutSayfa = 1;
                            filtreleUcuslari();
                            alert("Uçuş kaydı başarıyla eklendi!");
                        } else {
                            alert("Uçuş kaydedilirken bir hata oluştu.");
                        }
                    }

                    async function silUcus(id) {
                        if(!confirm("Bu uçuş kaydını silmek istediğinize emin misiniz?")) return;
                        const response = await fetch('/api/delete-flight', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, userEmail: document.getElementById('userEmail').value }) });
                        const sonuc = await response.json();
                        if(sonuc.success) { 
                            document.getElementById('row-'+id).remove(); 
                            
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;
                            document.getElementById('donemSaatGosterge').innerText = sonuc.yeniDonemSaat;

                            document.getElementById('valGgg').innerText = sonuc.gggDurum.kalanGgg + " Gün";
                            document.getElementById('tarihGgg').innerText = "Son Tarih: " + sonuc.gggDurum.hedefGggStr;
                            document.getElementById('boxGgg').style = sonuc.gggDurum.renkGgg + " color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;";

                            document.getElementById('valSonUcus').innerText = sonuc.gggDurum.kalanSonUcus + " Gün";
                            document.getElementById('tarihSonUcus').innerText = "Son Tarih: " + sonuc.gggDurum.hedefSonUcusStr;
                            document.getElementById('boxSonUcus').style = sonuc.gggDurum.renkSonUcus + " color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;";

                            filtreleUcuslari(); 
                        }
                    }

                    function filtreleUcuslari() {
                        const secilenYil = document.getElementById('filtreYil').value;
                        const ay = document.getElementById('filtreAy').value;
                        const hava = document.getElementById('filtreHavaAraci').value;
                        const egitim = document.getElementById('filtreUcusTipi').value;
                        
                        let toplamFiltreDakika = 0;
                        let filtreAktifMi = (secilenYil || ay || hava || egitim);

                        let baslangicTarihi = null;
                        let bitisTarihi = null;
                        if(secilenYil) {
                            let y = parseInt(secilenYil);
                            baslangicTarihi = new Date((y - 1) + '-09-01'); 
                            bitisTarihi = new Date(y + '-09-01');           
                        }

                        let gorunurSatirlar = [];

                        document.querySelectorAll('.ucus-satiri').forEach(satir => {
                            const tStr = satir.getAttribute('data-tarih'); 
                            const h = satir.getAttribute('data-hava');
                            const e = satir.getAttribute('data-egitim');
                            const s = satir.getAttribute('data-sure');

                            let u = true;

                            if(secilenYil) {
                                const mevcutUcusTarihi = new Date(tStr);
                                if(mevcutUcusTarihi < baslangicTarihi || mevcutUcusTarihi > bitisTarihi) u = false;
                            }

                            if(ay && tStr.split('-')[1] !== ay) u = false;
                            if(egitim && e !== egitim) u = false;
                            if(hava) {
                                if(hava === 'sikorsky') { if(h !== 's70' && h !== 's70i' && h !== 't70') u = false; }
                                else if(h !== hava) u = false;
                            }
                            
                            if(u) {
                                gorunurSatirlar.push(satir);
                                if (s && s.includes(':')) {
                                    const [saat, dakika] = s.split(':').map(Number);
                                    toplamFiltreDakika += (saat * 60) + dakika;
                                }
                            } else {
                                satir.style.display = 'none';
                            }
                        });

                        if(filtreAktifMi) {
                            let fSaat = Math.floor(toplamFiltreDakika / 60).toString().padStart(2, '0');
                            let fDakika = (toplamFiltreDakika % 60).toString().padStart(2, '0');
                            document.getElementById('filtreliSaatGosterge').innerText = fSaat + ":" + fDakika;
                            document.getElementById('filtreSaatKutusu').style.display = 'block';
                        } else {
                            document.getElementById('filtreSaatKutusu').style.display = 'none';
                        }

                        sayfalamayiCiz(gorunurSatirlar);
                    }

                    function sayfalamayiCiz(aktifSatirlar) {
                        const toplamSatirSayisi = aktifSatirlar.length;
                        const toplamSayfaSayisi = Math.ceil(toplamSatirSayisi / satirBasinaVeri) || 1;

                        if (mevcutSayfa > toplamSayfaSayisi) mevcutSayfa = toplamSayfaSayisi;

                        aktifSatirlar.forEach((satir, index) => {
                            const baslangicSınırı = (mevcutSayfa - 1) * satirBasinaVeri;
                            const bitisSınırı = mevcutSayfa * satirBasinaVeri;

                            if (index >= baslangicSınırı && index < bitisSınırı) {
                                satir.style.display = '';
                            } else {
                                satir.style.display = 'none';
                            }
                        });

                        const sayfalamaKutusu = document.getElementById('sayfalamaAlani');
                        sayfalamaKutusu.innerHTML = '';

                        if (toplamSayfaSayisi > 1) {
                            for (let i = 1; i <= toplamSayfaSayisi; i++) {
                                const btn = document.createElement('button');
                                btn.type = 'button';
                                btn.innerText = i;
                                btn.className = 'sayfa-btn' + (i === mevcutSayfa ? ' aktif' : '');
                                btn.onclick = function() {
                                    mevcutSayfa = i;
                                    filtreleUcuslari();
                                };
                                sayfalamaKutusu.appendChild(btn);
                            }
                        }
                    }

                    function filtreleriTemizle() {
                        document.getElementById('filtreYil').value = '';
                        document.getElementById('filtreAy').value = '';
                        document.getElementById('filtreHavaAraci').value = '';
                        document.getElementById('filtreUcusTipi').value = '';
                        mevcutSayfa = 1;
                        filtreleUcuslari();
                    }

                    window.onload = function() {
                        filtreleUcuslari();
                    };
                </script>
            `);
        } else {
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Şifre Hatalı!</h1><a href="/">Tekrar Dene</a></div>`);
        }
    } catch (error) {
        res.status(500).send("Sunucu hatası.");
    }
});

app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    
    if(!email || !password) {
        return res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Eksik Bilgi!</h1><p>E-posta ve şifre alanları boş bırakılamaz.</p><a href="/">Geri Dön</a></div>`);
    }

    try {
        const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
        if (existingUser) {
            return res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: #e67e22;">⚠️ Hesap Zaten Mevcut!</h1><p>Bu e-posta adresi ile daha önce kayıt yapılmış.</p><a href="/">Geri Dön ve Giriş Yap</a></div>`);
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            email: email.trim().toLowerCase(),
            password: hashedPassword
        });
        await newUser.save();

        res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: #2ecc71;">✔️ Kayıt Başarılı!</h1><p>Hesabınız oluşturuldu. Şimdi giriş yapabilirsiniz.</p><a href="/">Giriş Ekranına Git</a></div>`);

    } catch (error) {
        console.error(error);
        res.status(500).send("Kayıt esnasında sunucu hatası oluştu.");
    }
});

app.post('/api/update-user-date', async (req, res) => {
    const { userEmail, alan, tarih } = req.body;
    try {
        await ReportDate.findOneAndUpdate(
            { userEmail: userEmail, alan: alan },
            { tarih: tarih },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.delete('/api/delete-flight', async (req, res) => {
    const { id, userEmail } = req.body;
    try { 
        await Flight.findByIdAndDelete(id); 
        const kalanlar = await Flight.find({ userEmail }).sort({ tarih: -1 });
        const gggDurum = hesaplaGggVeSonUcusDurumu(kalanlar);

        res.json({ 
            success: true, 
            yeniToplamSaat: hesaplaToplamSaat(kalanlar),
            yeniDonemSaat: hesaplaAktifDonemSaati(kalanlar).sure,
            gggDurum: gggDurum
        }); 
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/add-flight', async (req, res) => {
    try {
        const formatliSure = formatUcusSaati(req.body.sure);
        const nf = new Flight({ ...req.body, sure: formatliSure });
        const savedFlight = await nf.save();
        
        const tumUcuslar = await Flight.find({ userEmail: req.body.userEmail }).sort({ tarih: -1 });
        const yeniToplam = hesaplaToplamSaat(tumUcuslar);
        const yeniDonem = hesaplaAktifDonemSaati(tumUcuslar);
        const gggDurum = hesaplaGggVeSonUcusDurumu(tumUcuslar);

        res.json({ 
            success: true, 
            data: savedFlight, 
            yeniToplamSaat: yeniToplam,
            yeniDonemSaat: yeniDonem.sure,
            gggDurum: gggDurum
        });
    } catch (e) { res.json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sunucu aktif."));