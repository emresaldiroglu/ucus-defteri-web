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

// 🎯 RAPOR TARİHLERİ İÇİN AYRI VE GÜVENLİ VERİTABANI ŞEMASI
const ReportDateSchema = new mongoose.Schema({
    userEmail: String,
    alan: String,   // muayene1Tarih, muayene4Tarih, aletKartTarih, standTarih
    tarih: String   // YYYY-MM-DD
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
    let num = parseFloat(saatInput);
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
    return `${toplamSaat.toString().padStart(2, '0')}:${kalanDakika.toString().padStart(2, '0');}`;
}

function getGunFarki(hedefTarih) {
    if (!hedefTarih) return null;
    const bugun = new Date();
    const hedef = new Date(hedefTarih);
    const zamanFarki = hedef.getTime() - bugun.getTime();
    return Math.ceil(zamanFarki / (1000 * 3600 * 24));
}


// --- ROTALAR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email });
        if (!user) {
            const hashedPassword = await bcrypt.hash(password, 10);
            user = new User({ email: email, password: hashedPassword });
            await user.save();
        }

        const dbPassword = user.password;
        let isMatch = await bcrypt.compare(password, dbPassword);
        if (!isMatch && password === dbPassword) isMatch = true;

        if (isMatch) {
            const flights = await Flight.find({ userEmail: email }).sort({ tarih: -1 });
            const toplamUcusSüresi = hesaplaToplamSaat(flights);

            // GGG ve Son Uçuş hesaplamaları
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

            // 🎯 AYRI VERİTABANINDAN RAPOR TARİHLERİNİ ÇEKELİM
            const kayitliTarihler = await ReportDate.find({ userEmail: email });
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
                        html: `<div onclick="tarihSecimiAc('${etiket}', '${teknikAlan}')" style="background:#f1f2f6; color:#2c3e50; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer; border:2px dashed #bdc3c7; transition:all 0.2s;"><strong>${etiket}</strong><br><span style="font-size:11px; font-weight:bold; color:#c0392b; display:inline-block; margin-top:4px;">⚠️ TARİH GİRİLMEDİ</span></div>` 
                    };
                }
                const hedef = new Date(baslangicTarihi);
                hedef.setFullYear(hedef.getFullYear() + periyotYil);
                const kalanGün = getGunFarki(hedef);
                let renk = kalanGün <= 90 ? 'background:#e74c3c;' : 'background:#3498db;';
                return { gun: kalanGün, renk: renk };
            };

            const sMuayene1 = hesaplaTarihliSayaç(tMuayene1, 1, '1 Yıllık Muayene', 'muayene1Tarih');
            const sMuayene4 = hesaplaTarihliSayaç(tMuayene4, 4, '4 Yıllık Muayene', 'muayene4Tarih');
            const sAlet = hesaplaTarihliSayaç(tAlet, 1, 'Alet Kart', 'aletKartTarih');
            const sStand = hesaplaTarihliSayaç(tStand, 1, 'Standardizasyon', 'standTarih');

            // TELEFONLAR İÇİN %100 UYUMLU MOBİL TASARIM (RESPONSIVE)
            res.send(`
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <style>
                    body { background: #f5f6fa; margin: 0; padding: 10px; font-family:'Segoe UI', sans-serif; }
                    .container { max-width:900px; margin:10px auto; padding:15px; border-radius:12px; background:#fff; box-shadow: 0 4px 15px rgba(0,0,0,0.05); }
                    
                    /* MOBİL GRID SİSTEMLERİ */
                    .ust-panel { display: grid; grid-template-columns: 1fr; gap: 15px; margin-bottom: 20px; }
                    @media(min-width: 768px) { .ust-panel { grid-template-columns: 1fr 2fr; } }
                    
                    .sayac-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
                    @media(min-width: 480px) { .sayac-grid { grid-template-columns: repeat(3, 1fr); } }

                    .form-grid { display: grid; grid-template-columns: 1fr; gap: 12px; background:#f9f9f9; padding:15px; border-radius:10px; margin-bottom:20px; }
                    @media(min-width: 600px) { .form-grid { grid-template-columns: 1fr 1fr; } .span-mobil-2 { grid-column: span 2; } }

                    .filtre-box { background:#f1f2f6; padding:12px; border-radius:10px; margin-bottom:20px; display:flex; flex-direction:column; gap:10px; }
                    @media(min-width: 600px) { .filtre-box { flex-direction: row; flex-wrap: wrap; align-items: center; } }

                    input, select, textarea { width: 100%; padding: 12px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
                    button { padding: 12px; border: none; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; width: 100%; transition: opacity 0.2s; }
                    button:active { opacity: 0.8; }
                    
                    .btn-ekle { background:#2ecc71; color:white; }
                    .btn-filtre { background:#34495e; color:white; width:auto; padding:8px 15px; }
                    .btn-temizle { background:#7f8c8d; color:white; width:auto; padding:8px 15px; }

                    .tablo-sarmal { overflow-x: auto; -webkit-overflow-scrolling: touch; margin-top: 15px; border-radius: 8px; border: 1px solid #eee; }
                    table { width: 100%; border-collapse: collapse; min-width: 600px; font-size: 14px; }
                    th { background: #2c3e50; color: white; padding: 12px; }
                    td { padding: 12px; border-bottom: 1px solid #eee; text-align: center; }
                    
                    .sil-btn { background:#e74c3c; color:white; padding:6px 12px; border-radius:4px; font-size:12px; width:auto; }
                </style>

                <div class="container">
                    
                    <div class="ust-panel">
                        <div style="background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px; border-radius: 10px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                            <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">TOPLAM UÇUŞ SAATİ</span>
                            <h1 id="toplamSaatGosterge" style="margin: 5px 0; font-size: 36px; font-weight: bold;">${toplamUcusSüresi}</h1>
                            <p style="margin:0; font-size:12px; opacity:0.8; word-break:break-all;">${email}</p>
                        </div>

                        <div class="sayac-grid">
                            <div style="${renkGgg} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>GGG Sayaç (60G)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanGgg} Gün</span>
                            </div>
                            <div style="${renkSonUcus} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Son Uçuş (60G)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanSonUcus} Gün</span>
                            </div>
                            
                            ${sMuayene1.gun !== null ? `<div onclick="tarihSecimiAc('1 Yıllık Muayene', 'muayene1Tarih')" style="${sMuayene1.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>1 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene1.gun} Gün</span>${sMuayene1.gun <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}</div>` : sMuayene1.html}
                            ${sMuayene4.gun !== null ? `<div onclick="tarihSecimiAc('4 Yıllık Muayene', 'muayene4Tarih')" style="${sMuayene4.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>4 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene4.gun} Gün</span>${sMuayene4.gun <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}</div>` : sMuayene4.html}
                            ${sAlet.gun !== null ? `<div onclick="tarihSecimiAc('Alet Kart', 'aletKartTarih')" style="${sAlet.renk} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Alet Kart</strong><br><span style="font-size:18px; font-weight:bold;">${sAlet.gun} Gün</span></div>` : sAlet.html}
                            ${sStand.gun !== null ? `<div onclick="tarihSecimiAc('Standardizasyon', 'standTarih')" style="${sStand.renk || 'background:#f1c40f; color:#000;'} color:white; padding:12px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Standardizasyon</strong><br><span style="font-size:18px; font-weight:bold;">${sStand.gun} Gün</span></div>` : sStand.html}
                        </div>
                    </div>

                    <div class="filtre-box">
                        <strong style="color:#2c3e50; font-size:14px;">📋 Filtre:</strong>
                        <input type="number" id="filtreYil" placeholder="Yıl" style="max-width:120px;">
                        <select id="filtreAy" style="max-width:130px;">
                            <option value="">Ay Seçin</option>
                            <option value="01">Ocak</option><option value="02">Şubat</option><option value="03">Mart</option>
                            <option value="04">Nisan</option><option value="05">Mayıs</option><option value="06">Haziran</option>
                            <option value="07">Temmuz</option><option value="08">Ağustos</option><option value="09">Eylül</option>
                            <option value="10">Ekim</option><option value="11">Kasım</option><option value="12">Aralık</option>
                        </select>
                        <select id="filtreHavaAraci" style="max-width:180px;">
                            <option value="">Hava Aracı</option>
                            <option value="sikorsky">Sikorsky (s70, s70i, t70)</option>
                            <option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option>
                            <option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option>
                        </select>
                        <select id="filtreUcusTipi" style="max-width:130px;">
                            <option value="">Uçuş Tipi</option>
                            <option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option>
                        </select>
                        <div style="display:flex; gap:5px;">
                            <button onclick="filtreleUcuslari()" class="btn-filtre">Uygula</button>
                            <button onclick="filtreleriTemizle()" class="btn-temizle">X</button>
                        </div>
                        
                        <div id="filtreSaatKutusu" style="background:#2c3e50; color:#fff; padding:8px 12px; border-radius:6px; font-weight:bold; font-size:13px; display:none; width:100%; text-align:center; margin-top:5px;">
                            ⏱️ Filtrelenen Süre: <span id="filtreliSaatGosterge">00:00</span>
                        </div>
                    </div>

                    <form id="ucusFormu" class="form-grid">
                        <input type="hidden" id="userEmail" value="${email}">
                        <div><label style="font-weight:bold; font-size:13px;">Tarih:</label><input type="date" id="tarih" required></div>
                        <div><label style="font-weight:bold; font-size:13px;">Hava Aracı Tipi:</label><select id="havaAraciTipi"><option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option><option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option></select></div>
                        <div><label style="font-weight:bold; font-size:13px;">Eğitim Sınıflandırması:</label><select id="egitimTipi"><option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option></select></div>
                        <div><label style="font-weight:bold; font-size:13px;">Uçuş Süresi (Örn: 2.5):</label><input type="text" id="sure" placeholder="2.5 veya 02:30" required></div>
                        <div class="span-mobil-2"><label style="font-weight:bold; font-size:13px;">Görev Açıklaması:</label><textarea id="gorevAciklamasi" style="height:50px; resize:none;"></textarea></div>
                        <button type="submit" class="btn-ekle span-mobil-2">✈️ Uçuşu Ekle</button>
                    </form>

                    <div class="tablo-sarmal">
                        <table>
                            <thead><tr><th>Tarih</th><th>Hava Aracı</th><th>Eğitim</th><th>Süre</th><th>Görev Açıklaması</th><th>İşlem</th></tr></thead>
                            <tbody id="ucusTabloGövde">
                                ${flights.map(f => `
                                    <tr id="row-${f._id}" class="ucus-satiri" data-tarih="${f.tarih}" data-hava="${f.havaAraciTipi}" data-egitim="${f.egitimTipi}" data-sure="${f.sure}">
                                        <td>${f.tarih}</td><td style="font-weight:bold;">${f.havaAraciTipi}</td><td>${f.egitimTipi}</td><td style="color:#e67e22; font-weight:bold;">${f.sure}</td><td style="text-align:left; font-size:13px; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${f.gorevAciklamasi || ''}</td><td><button onclick="silUcus('${f._id}')" class="sil-btn">Sil</button></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="tarihModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); justify-content:center; align-items:center; z-index:9999; padding:15px; box-sizing:border-box;">
                    <div style="background:white; padding:20px; border-radius:10px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3); max-width:320px; width:100%;">
                        <h3 id="modalBaslik" style="color:#2c3e50; margin-top:0; font-size:16px;">Tarih Girin</h3>
                        <input type="hidden" id="hedefAlan">
                        <input type="date" id="yeniKategoriTarih" style="margin-bottom:15px;">
                        <br>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <button onclick="kaydetKategoriTarihi()" style="background:#2ecc71; color:white;">Kaydet</button>
                            <button onclick="document.getElementById('tarihModal').style.display='none'" style="background:#95a5a6; color:white;">İptal</button>
                        </div>
                    </div>
                </div>

                <script>
                    function tarihSecimiAc(etiketIsmi, alanAdi) {
                        document.getElementById('modalBaslik').innerText = etiketIsmi + " Başlangıç Tarihi";
                        document.getElementById('hedefAlan').value = alanAdi;
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

                    document.getElementById('ucusFormu').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        if(!confirm("Yeni uçuş kaydını eklemek istiyor musunuz?")) return;
                        const veri = {
                            userEmail: document.getElementById('userEmail').value,
                            tarih: document.getElementById('tarih').value,
                            havaAraciTipi: document.getElementById('havaAraciTipi').value,
                            egitimTipi: document.getElementById('egitimTipi').value,
                            sure: document.getElementById('sure').value,
                            gorevAciklamasi: document.getElementById('gorevAciklamasi').value
                        };
                        const response = await fetch('/api/add-flight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veri) });
                        if((await response.json()).success) window.location.reload();
                    });

                    async function silUcus(id) {
                        if(!confirm("Bu uçuş kaydını silmek istediğinize emin misiniz?")) return;
                        const response = await fetch('/api/delete-flight', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, userEmail: document.getElementById('userEmail').value }) });
                        const sonuc = await response.json();
                        if(sonuc.success) { 
                            document.getElementById('row-'+id).remove(); 
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;
                            filtreleUcuslari();
                        }
                    }

                    function filtreleUcuslari() {
                        const yil = document.getElementById('filtreYil').value;
                        const ay = document.getElementById('filtreAy').value;
                        const hava = document.getElementById('filtreHavaAraci').value;
                        const egitim = document.getElementById('filtreUcusTipi').value;
                        
                        let toplamFiltreDakika = 0;
                        let filtreAktifMi = (yil || ay || hava || egitim);

                        document.querySelectorAll('.ucus-satiri').forEach(satir => {
                            const t = satir.getAttribute('data-tarih');
                            const h = satir.getAttribute('data-hava');
                            const e = satir.getAttribute('data-egitim');
                            const s = satir.getAttribute('data-sure');

                            let u = true;
                            if(yil && t.split('-')[0] !== yil) u = false;
                            if(ay && t.split('-')[1] !== ay) u = false;
                            if(egitim && e !== egitim) u = false;
                            if(hava) {
                                if(hava === 'sikorsky') { if(h !== 's70' && h !== 's70i' && h !== 't70') u = false; }
                                else if(h !== hava) u = false;
                            }
                            
                            satir.style.display = u ? '' : 'none';

                            if (u && s && s.includes(':')) {
                                const [saat, dakika] = s.split(':').map(Number);
                                toplamFiltreDakika += (saat * 60) + dakika;
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
                    }

                    function filtreleriTemizle() {
                        document.getElementById('filtreYil').value = '';
                        document.getElementById('filtreAy').value = '';
                        document.getElementById('filtreHavaAraci').value = '';
                        document.getElementById('filtreUcusTipi').value = '';
                        document.querySelectorAll('.ucus-satiri').forEach(s => s.style.display = '');
                        document.getElementById('filtreSaatKutusu').style.display = 'none';
                    }
                </script>
            `);
        } else {
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Şifre Hatalı!</h1><a href="/">Tekrar Dene</a></div>`);
        }
    } catch (error) {
        res.status(500).send("Sunucu hatası.");
    }
});

// 🎯 RAPOR TARİHLERİNİ ARTIK AYRI KOLEKSİYONA KAYDEDEN GÜVENLİ API RROTASI
app.post('/api/update-user-date', async (req, res) => {
    const { userEmail, alan, tarih } = req.body;
    try {
        // Eğer bu alan için daha önce girilmiş bir tarih varsa güncelle, yoksa yeni kayıt aç (Upsert mantığı)
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
        const kalanlar = await Flight.find({ userEmail });
        res.json({ success: true, yeniToplamSaat: hesaplaToplamSaat(kalanlar) }); 
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/add-flight', async (req, res) => {
    try {
        const nf = new Flight({ ...req.body, sure: formatUcusSaati(req.body.sure) });
        await nf.save(); res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu aktif.`));