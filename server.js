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
  .catch(err => console.error("❌ Connection Error: ", err));

// --- MONGODB ŞEMALARI ---

const UserSchema = new mongoose.Schema({
    email: String,
    password: String
});
const User = mongoose.model('User', UserSchema, 'users');

const FlightSchema = new mongoose.Schema({
    userEmail: String,
    tarih: String,
    havaAraciTipi: String, // s70, s70i, t70, atak, mi17, gökbey
    egitimTipi: String,    // ggg, gş, au(sim)
    sure: String,          // HH:MM formatı
    gorevAciklamasi: String // Opsiyonel not alanı
});
const Flight = mongoose.model('Flight', FlightSchema, 'flights');


// --- YARDIMCI FONKSİYONLAR ---

// Ondalık saati HH:MM formatına çevirir (Örn: 2.5 -> 02:30)
function formatUcusSaati(saatInput) {
    let num = parseFloat(saatInput);
    if (isNaN(num)) return "00:00";
    
    let saat = Math.floor(num);
    let dakika = Math.round((num - saat) * 60);
    
    let saatStr = saat.toString().padStart(2, '0');
    let dakikaStr = dakika.toString().padStart(2, '0');
    
    return `${saatStr}:${dakikaStr}`;
}

// HH:MM formatındaki süre dizisini toplayıp toplam HH:MM döndürür
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


// --- ROTALAR (ROUTES) ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN VE LOG DEFTERİ PANELİNİN YÜKLENMESİ
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
            // Kullanıcının mevcut uçuşlarını çekip toplam saati hesaplayalım
            const flights = await Flight.find({ userEmail: email }).sort({ tarih: -1 });
            const toplamUcusSüresi = hesaplaToplamSaat(flights);

            // Gelişmiş Tek Sayfa (SPA) Arayüzü HTML olarak basılıyor
            res.send(`
                <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width:800px; margin:30px auto; padding:25px; border:1px solid #e0e0e0; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); background:#fff;">
                    
                    <div style="background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 25px;">
                        <span style="font-size: 14px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">TOPLAM UÇUŞ SAATİ</span>
                        <h1 id="toplamSaatGosterge" style="margin: 5px 0 0 0; font-size: 42px; font-weight: bold;">${toplamUcusSüresi}</h1>
                        <p style="margin:5px 0 0 0; font-size:13px; opacity:0.8;">Pilot: ${email}</p>
                    </div>

                    <h2 style="color: #2c3e50; text-align:center; margin-bottom:20px;">✈️ Yeni Uçuş Kaydı Ekle</h2>
                    
                    <form id="ucusFormu" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f9f9f9; padding:20px; border-radius:10px; margin-bottom:30px;">
                        <input type="hidden" id="userEmail" value="${email}">
                        
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Tarih:</label>
                            <input type="date" id="tarih" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                        </div>
                        
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Hava Aracı Tipi:</label>
                            <select id="havaAraciTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                                <option value="s70">s70</option>
                                <option value="s70i">s70i</option>
                                <option value="t70">t70</option>
                                <option value="atak">atak</option>
                                <option value="mi17">mi17</option>
                                <option value="gökbey">gökbey</option>
                            </select>
                        </div>
                        
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Eğitim Sınıflandırması:</label>
                            <select id="egitimTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                                <option value="ggg">ggg</option>
                                <option value="gş">gş</option>
                                <option value="au(sim)">au(sim)</option>
                            </select>
                        </div>
                        
                        <div>
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Uçuş Süresi (Örn: 2.5):</label>
                            <input type="text" id="sure" placeholder="Ondalık veya HH:MM" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;">
                        </div>

                        <div style="grid-column: span 2;">
                            <label style="font-weight:bold; display:block; margin-bottom:5px;">Görev Açıklaması (İsteğe Bağlı Not):</label>
                            <textarea id="gorevAciklamasi" placeholder="Görev detayları, hava durumu veya eklemek istediğiniz notlar..." style="width:97%; padding:10px; border:1px solid #ccc; border-radius:5px; height:60px; resize:none;"></textarea>
                        </div>
                        
                        <button type="submit" style="grid-column: span 2; padding:12px; background:#2ecc71; color:white; border:none; border-radius:5px; font-size:16px; font-weight:bold; cursor:pointer; transition:background 0.2s;">Uçuşu Listeye ve Veritabanına Ekle</button>
                    </form>
                    
                    <h3 style="color:#2c3e50; border-bottom:2px solid #eee; padding-bottom:8px;">📋 Uçuş Kayıt Geçmişi</h3>
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                            <thead>
                                <tr style="background:#f2f2f2; text-align:center;">
                                    <th style="padding:10px; border-bottom:2px solid #ddd;">Tarih</th>
                                    <th style="padding:10px; border-bottom:2px solid #ddd;">Hava Aracı</th>
                                    <th style="padding:10px; border-bottom:2px solid #ddd;">Eğitim Tipi</th>
                                    <th style="padding:10px; border-bottom:2px solid #ddd;">Süre</th>
                                    <th style="padding:10px; border-bottom:2px solid #ddd;">Görev Açıklaması</th>
                                </tr>
                            </thead>
                            <tbody id="ucusTabloGövde">
                                ${flights.map(f => `
                                    <tr style="border-bottom: 1px solid #eee; text-align:center;">
                                        <td style="padding:10px;">${f.tarih}</td>
                                        <td style="padding:10px; font-weight:bold; color:#34495e;">${f.havaAraciTipi || '-'}</td>
                                        <td style="padding:10px; font-weight:bold; color:#7f8c8d;">${f.egitimTipi}</td>
                                        <td style="padding:10px; color:#e67e22; font-weight:bold;">${f.sure}</td>
                                        <td style="padding:10px; font-size:13px; color:#555; text-align:left;">${f.gorevAciklamasi || ''}</td>
                                    </tr>
                                `).join('') || '<tr><td colspan="5" id="bosUyarisi" style="text-align:center; padding:20px; color:#999;">Henüz uçuş kaydı bulunamadı.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <script>
                    document.getElementById('ucusFormu').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        const veri = {
                            userEmail: document.getElementById('userEmail').value,
                            tarih: document.getElementById('tarih').value,
                            havaAraciTipi: document.getElementById('havaAraciTipi').value,
                            egitimTipi: document.getElementById('egitimTipi').value,
                            sure: document.getElementById('sure').value,
                            gorevAciklamasi: document.getElementById('gorevAciklamasi').value
                        };

                        // Verileri sayfayı terk etmeden arka plana (API) postalıyoruz
                        const response = await fetch('/api/add-flight', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(veri)
                        });

                        const sonuc = await response.json();

                        if(sonuc.success) {
                            // 1. Üstteki Toplam Saat Bilgisini Yenile
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;

                            // 2. Tablo Boş Uyarısını Kaldır (Eğer Varsa)
                            const bosUyarisi = document.getElementById('bosUyarisi');
                            if(bosUyarisi) bosUyarisi.parentElement.remove();

                            // 3. Tablonun En Başına Yeni Satırı Şak Diye Ekle
                            const yeniSatir = \`
                                <tr style="border-bottom: 1px solid #eee; text-align:center; background:#e8f8f5;">
                                    <td style="padding:10px;">\${veri.tarih}</td>
                                    <td style="padding:10px; font-weight:bold; color:#34495e;">\${veri.havaAraciTipi}</td>
                                    <td style="padding:10px; font-weight:bold; color:#7f8c8d;">\${veri.egitimTipi}</td>
                                    <td style="padding:10px; color:#e67e22; font-weight:bold;">\${sonuc.eklenenSure}</td>
                                    <td style="padding:10px; font-size:13px; color:#555; text-align:left;">\${veri.gorevAciklamasi}</td>
                                </tr>
                            \`;
                            document.getElementById('ucusTabloGövde').insertAdjacentHTML('afterbegin', yeniSatir);

                            // 4. Formu temizle (Tarih ve Hava Aracı kalsın, süre ve not sıfırlansın)
                            document.getElementById('sure').value = '';
                            document.getElementById('gorevAciklamasi').value = '';
                        } else {
                            alert('Uçuş kaydedilirken teknik bir hata oluştu!');
                        }
                    });
                </script>
            `);
        } else {
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Şifre Hatalı!</h1><a href="/">Tekrar Dene</a></div>`);
        }

    } catch (error) {
        console.error(error);
        res.status(500).send("Sunucu hatası.");
    }
});

// ⚡ SAYFAYI DEĞİŞTİRMEDEN ARKA PLANDA ÇALIŞAN UÇUŞ EKLEME API'Sİ
app.post('/api/add-flight', async (req, res) => {
    const { userEmail, tarih, havaAraciTipi, egitimTipi, sure, gorevAciklamasi } = req.body;
    
    // Otomatik saat formatı çevrimi devreye giriyor (2.5 -> 02:30)
    const duzeltilmisSure = formatUcusSaati(sure);

    try {
        const newFlight = new Flight({
            userEmail,
            tarih,
            havaAraciTipi,
            egitimTipi,
            sure: duzeltilmisSure,
            gorevAciklamasi
        });
        await newFlight.save();

        // Kullanıcının güncel tüm uçuşlarını çekip yeni toplam saati hesaplayalım
        const tümUcuslar = await Flight.find({ userEmail });
        const yeniToplam = hesaplaToplamSaat(tümUcuslar);

        // Ön yüze sayfa değişmeden güncellenecek verileri json olarak paslıyoruz
        res.json({
            success: true,
            yeniToplamSaat: yeniToplam,
            eklenenSure: duzeltilmisSure
        });

    } catch (error) {
        console.error(error);
        res.json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Logbook sunucusu aktif.`));