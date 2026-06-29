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

const FlightSchema = new mongoose.Schema({
    userEmail: String,
    tarih: String,          // YYYY-MM-DD
    havaAraciTipi: String,  // s70, s70i, t70, atak, mi17, gökbey
    egitimTipi: String,     // ggg, gş, au(sim)
    sure: String,           // HH:MM
    gorevAciklamasi: String
});
const Flight = mongoose.model('Flight', FlightSchema, 'flights');


// --- YARDIMCI FONKSİYONLAR ---

// Ondalık saati HH:MM yapar (Örn: 2.5 -> 02:30)
function formatUcusSaati(saatInput) {
    let num = parseFloat(saatInput);
    if (isNaN(num)) return "00:00";
    let saat = Math.floor(num);
    let dakika = Math.round((num - saat) * 60);
    return `${saat.toString().padStart(2, '0')}:${dakika.toString().padStart(2, '0')}`;
}

// Toplam uçuş süresini hesaplar
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

// Sayaçlar için gün hesabı yapan fonksiyon
function getGunFarki(hedefTarih) {
    const bugun = new Date();
    const hedef = new Date(hedefTarih);
    const zamanFarki = hedef.getTime() - bugun.getTime();
    return Math.ceil(zamanFarki / (1000 * 3600 * 24));
}


// --- ROTALAR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN VE GELİŞMİŞ LOGBOOK PANELİ
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

            // --- SAYAÇ HESAPLAMALARI ---
            // Son uçuş ve son ggg uçuş tarihlerini bulalım
            const sonUcus = flights[0]; // sort({tarih: -1}) yaptığımız için en baştaki sondur
            const sonGggUcus = flights.find(f => f.egitimTipi === 'ggg');

            // Varsayılan periyot günleri
            const gun60 = 60;
            const gun365 = 365;
            const gun1460 = 1460; // 4 Yıl

            // Eğer kayıt yoksa bugünün tarihinden başlatıyoruz (Simüle etmek için)
            const sonUcusTarihStr = sonUcus ? sonUcus.tarih : new Date().toISOString().split('T')[0];
            const sonGggTarihStr = sonGggUcus ? sonGggUcus.tarih : new Date().toISOString().split('T')[0];

            // Hedef Geçerlilik Tarihleri
            const hedefGgg = new Date(sonGggTarihStr); hedefGgg.setDate(hedefGgg.getDate() + gun60);
            const hedefSonUcus = new Date(sonUcusTarihStr); hedefSonUcus.setDate(hedefSonUcus.getDate() + gun60);
            
            // Muayeneler, Alet Kart ve Stand. (Son uçuştan baz alınarak simüle edildi, gerçek tarihler istenirse profile eklenebilir)
            const hedefMuayene1 = new Date(sonUcusTarihStr); hedefMuayene1.setDate(hedefMuayene1.getDate() + gun365);
            const hedefMuayene4 = new Date(sonUcusTarihStr); hedefMuayene4.setDate(hedefMuayene4.getDate() + gun1460);
            const hedefAlet = new Date(sonUcusTarihStr); hedefAlet.setDate(hedefAlet.getDate() + gun365);
            const hedefStand = new Date(sonUcusTarihStr); hedefStand.setDate(hedefStand.getDate() + gun365);

            // Kalan Gün Sayıları
            const kalanGgg = getGunFarki(hedefGgg);
            const kalanSonUcus = getGunFarki(hedefSonUcus);
            const kalanMuayene1 = getGunFarki(hedefMuayene1);
            const kalanMuayene4 = getGunFarki(hedefMuayene4);
            const kalanAlet = getGunFarki(hedefAlet);
            const kalanStand = getGunFarki(hedefStand);

            // Renk Belirleme Fonksiyonları (Ön yüzde de kullanılacak)
            const renkGgg = kalanGgg <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';
            const renkSonUcus = kalanSonUcus <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';
            const renkMuayene1 = kalanMuayene1 <= 90 ? 'background:#e74c3c;' : 'background:#3498db;';
            const renkMuayene4 = kalanMuayene4 <= 90 ? 'background:#e74c3c;' : 'background:#3498db;';
            const renkAlet = kalanAlet <= 90 ? 'background:#e74c3c;' : 'background:#9b59b6;';
            const renkStand = kalanStand <= 90 ? 'background:#e74c3c;' : 'background:#f1c40f; color:#000;';

            res.send(`
                <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width:900px; margin:20px auto; padding:25px; border:1px solid #e0e0e0; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); background:#fff;">
                    
                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 25px;">
                        <div style="background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px; border-radius: 10px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">TOPLAM UÇUŞ SAATİ</span>
                            <h1 id="toplamSaatGosterge" style="margin: 5px 0 0 0; font-size: 38px; font-weight: bold;">${toplamUcusSüresi}</h1>
                            <p style="margin:5px 0 0 0; font-size:12px; opacity:0.8;">${email}</p>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
                            <div style="${renkGgg} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>GGG Sayaç (60 Gün)</strong><br><span style="font-size:20px; font-weight:bold;">${kalanGgg} Gün</span>
                            </div>
                            <div style="${renkSonUcus} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Son Uçuş (60 Gün)</strong><br><span style="font-size:20px; font-weight:bold;">${kalanSonUcus} Gün</span>
                            </div>
                            <div style="${renkMuayene1} color:white; padding:10px; border-radius:8px; text-align:center; font-size:11px; position:relative;">
                                <strong>Sağlık Muayenesi (1 Yıl)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanMuayene1} Gün</span>
                                ${kalanMuayene1 <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}
                            </div>
                            <div style="${renkMuayene4} color:white; padding:10px; border-radius:8px; text-align:center; font-size:11px;">
                                <strong>Sağlık Muayenesi (4 Yıl)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanMuayene4} Gün</span>
                                ${kalanMuayene4 <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}
                            </div>
                            <div style="${renkAlet} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Alet Kart (1 Yıl)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanAlet} Gün</span>
                            </div>
                            <div style="${renkStand} padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Standardizasyon (1 Yıl)</strong><br><span style="font-size:18px; font-weight:bold;">${kalanStand} Gün</span>
                            </div>
                        </div>
                    </div>

                    <div style="background:#f1f2f6; padding:15px; border-radius:10px; margin-bottom:20px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                        <strong style="color:#2c3e50;">📋 Gelişmiş Filtrele:</strong>
                        <input type="number" id="filtreYil" placeholder="Yıl (Örn: 2026)" style="padding:6px; border:1px solid #ccc; border-radius:4px; width:100px;">
                        <select id="filtreAy" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Ay Seçin</option>
                            <option value="01">Ocak</option><option value="02">Şubat</option><option value="03">Mart</option>
                            <option value="04">Nisan</option><option value="05">Mayıs</option><option value="06">Haziran</option>
                            <option value="07">Temmuz</option><option value="08">Ağustos</option><option value="09">Eylül</option>
                            <option value="10">Ekim</option><option value="11">Kasım</option><option value="12">Aralık</option>
                        </select>
                        <select id="filtreHavaAraci" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Hava Aracı Seçin</option>
                            <option value="sikorsky">Sikorsky (s70, s70i, t70)</option>
                            <option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option>
                            <option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option>
                        </select>
                        <select id="filtreUcusTipi" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Uçuş Tipi Seçin</option>
                            <option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option>
                        </select>
                        <button onclick="filtreleUcuslari()" style="padding:6px 12px; background:#34495e; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Uygula</button>
                        <button onclick="filtreleriTemizle()" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:4px; cursor:pointer;">Temizle</button>
                    </div>

                    <form id="ucusFormu" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f9f9f9; padding:20px; border-radius:10px; margin-bottom:25px;">
                        <input type="hidden" id="userEmail" value="${email}">
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Tarih:</label>
                            <input type="date" id="tarih" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                        </div>
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Hava Aracı Tipi:</label>
                            <select id="havaAraciTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                                <option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option>
                                <option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Eğitim Sınıflandırması:</label>
                            <select id="egitimTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                                <option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Uçuş Süresi (Örn: 2.5):</label>
                            <input type="text" id="sure" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                        </div>
                        <div style="grid-column: span 2;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Görev Açıklaması (İsteğe Bağlı Not):</label>
                            <textarea id="gorevAciklamasi" style="width:97%; padding:10px; border:1px solid #ccc; border-radius:5px; height:50px; resize:none;"></textarea>
                        </div>
                        <button type="submit" style="grid-column: span 2; padding:12px; background:#2ecc71; color:white; border:none; border-radius:5px; font-size:16px; font-weight:bold; cursor:pointer;">Uçuşu Ekle</button>
                    </form>
                    
                    <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                        <thead>
                            <tr style="background:#2c3e50; color:white; text-align:center;">
                                <th style="padding:10px;">Tarih</th>
                                <th style="padding:10px;">Hava Aracı</th>
                                <th style="padding:10px;">Eğitim Tipi</th>
                                <th style="padding:10px;">Süre</th>
                                <th style="padding:10px;">Görev Açıklaması</th>
                                <th style="padding:10px;">İşlem</th>
                            </tr>
                        </thead>
                        <tbody id="ucusTabloGövde">
                            ${flights.map(f => `
                                <tr id="row-${f._id}" class="ucus-satiri" data-tarih="${f.tarih}" data-hava="${f.havaAraciTipi}" data-egitim="${f.egitimTipi}" style="border-bottom: 1px solid #eee; text-align:center;">
                                    <td style="padding:10px;">${f.tarih}</td>
                                    <td style="padding:10px; font-weight:bold;">${f.havaAraciTipi}</td>
                                    <td style="padding:10px;">${f.egitimTipi}</td>
                                    <td style="padding:10px; color:#e67e22; font-weight:bold;">${f.sure}</td>
                                    <td style="padding:10px; font-size:13px; text-align:left;">${f.gorevAciklamasi || ''}</td>
                                    <td style="padding:10px;"><button onclick="silUcus('${f._id}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:pointer; font-weight:bold;">Sil</button></td>
                                </tr>
                            `).join('') || '<tr><td colspan="6" id="bosUyarisi" style="text-align:center; padding:20px; color:#999;">Henüz uçuş kaydı bulunamadı.</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <script>
                    // EKLEME ONAYI VE AJAX POST
                    document.getElementById('ucusFormu').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        // Ekleme Öncesi Onay Kutusu
                        const onay = confirm("Yeni uçuş kaydını veritabanına eklemek istediğinize emin misiniz?");
                        if(!onay) return;

                        const veri = {
                            userEmail: document.getElementById('userEmail').value,
                            tarih: document.getElementById('tarih').value,
                            havaAraciTipi: document.getElementById('havaAraciTipi').value,
                            egitimTipi: document.getElementById('egitimTipi').value,
                            sure: document.getElementById('sure').value,
                            gorevAciklamasi: document.getElementById('gorevAciklamasi').value
                        };

                        const response = await fetch('/api/add-flight', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(veri)
                        });
                        const sonuc = await response.json();

                        if(sonuc.success) {
                            alert('Uçuş kaydı başarıyla eklendi! Bilgiler yenileniyor...');
                            window.location.reload(); // Sayaçların da yeniden hesaplanması için sayfayı en temiz şekilde tazeliyoruz
                        }
                    });

                    // SİLME ONAYI VE AJAX DELETE
                    async function silUcus(id) {
                        const onay = confirm("Bu uçuş kaydını kalıcı olarak silmek istediğinize emin misiniz?");
                        if(!onay) return;

                        const response = await fetch('/api/delete-flight', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: id, userEmail: document.getElementById('userEmail').value })
                        });
                        const sonuc = await response.json();

                        if(sonuc.success) {
                            document.getElementById('row-' + id).remove();
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;
                            alert('Uçuş kaydı başarıyla silindi.');
                        }
                    }

                    // GELİŞMİŞ ÖN YÜZ FİLTRELEME MANTIĞI (SİKORSKY KAPSAYICI DAHİL)
                    function filtreleUcuslari() {
                        const yil = document.getElementById('filtreYil').value;
                        const ay = document.getElementById('filtreAy').value;
                        const hava = document.getElementById('filtreHavaAraci').value;
                        const egitim = document.getElementById('filtreUcusTipi').value;

                        const satirlar = document.querySelectorAll('.ucus-satiri');

                        satirlar.forEach(satir => {
                            const t = satir.getAttribute('data-tarih'); // YYYY-MM-DD
                            const h = satir.getAttribute('data-hava');
                            const e = satir.getAttribute('data-egitim');

                            const sYil = t.split('-')[0];
                            const sAy = t.split('-')[1];

                            let uyuyor mu = true;

                            if(yil && sYil !== yil) uyuyor mu = false;
                            if(ay && sAy !== ay) uyuyor mu = false;
                            if(egitim && e !== egitim) uyuyor mu = false;
                            
                            // Sikorsky Özel Koşulu
                            if(hava) {
                                if(hava === 'sikorsky') {
                                    if(h !== 's70' && h !== 's70i' && h !== 't70') uyuyor mu = false;
                                } else if(h !== hava) {
                                    uyuyor mu = false;
                                }
                            }

                            if(uyuyor mu) {
                                satir.style.display = '';
                            } else {
                                satir.style.display = 'none';
                            }
                        });
                    }

                    function filtreleriTemizle() {
                        document.getElementById('filtreYil').value = '';
                        document.getElementById('filtreAy').value = '';
                        document.getElementById('filtreHavaAraci').value = '';
                        document.getElementById('filtreUcusTipi').value = '';
                        document.querySelectorAll('.ucus-satiri').forEach(s => s.style.display = '');
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

// SİLME API'Sİ
app.delete('/api/delete-flight', async (req, res) => {
    const { id, userEmail } = req.body;
    try {
        await Flight.findByIdAndDelete(id);
        const kalanUcuslar = await Flight.find({ userEmail });
        const yeniToplam = hesaplaToplamSaat(kalanUcuslar);
        res.json({ success: true, yeniToplamSaat: yeniToplam });
    } catch (error) {
        res.json({ success: false });
    }
});

// EKLEME API'Sİ
app.post('/api/add-flight', async (req, res) => {
    const { userEmail, tarih, havaAraciTipi, egitimTipi, sure, gorevAciklamasi } = req.body;
    const duzeltilmisSure = formatUcusSaati(sure);

    try {
        const newFlight = new Flight({ userEmail, tarih, havaAraciTipi, egitimTipi, sure: duzeltilmisSure, gorevAciklamasi });
        await newFlight.save();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu aktif.`));