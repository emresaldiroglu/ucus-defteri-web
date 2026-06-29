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

// 1. Kullanıcı Şeması
const UserSchema = new mongoose.Schema({
    email: String,
    password: String
});
const User = mongoose.model('User', UserSchema, 'users');

// 2. Uçuş Kayıt Şeması
const FlightSchema = new mongoose.Schema({
    userEmail: String,      // Uçuşun hangi kullanıcıya ait olduğunu ayırmak için
    tarih: String,
    egitimTipi: String,     // ggg, gş, au(sim)
    sure: String            // HH:MM formatında saklanacak
});
const Flight = mongoose.model('Flight', FlightSchema, 'flights');


// --- YARDIMCI FONKSİYON (Ondalık Saati HH:MM Formatına Çevirir) ---
function formatUcusSaati(saatInput) {
    let num = parseFloat(saatInput);
    if (isNaN(num)) return "00:00";
    
    let saat = Math.floor(num);
    let dakika = Math.round((num - saat) * 60);
    
    // Değerleri iki haneli stringe çevir (Örn: 2 -> "02", 5 -> "05")
    let saatStr = saat.toString().padStart(2, '0');
    let dakikaStr = dakika.toString().padStart(2, '0');
    
    return `${saatStr}:${dakikaStr}`;
}


// --- ROTALAR (ROUTES) ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN VE OTOMATİK PANEL YÖNLENDİRMESİ
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email });

        // Kullanıcı yoksa otomatik oluştur
        if (!user) {
            const hashedPassword = await bcrypt.hash(password, 10);
            user = new User({ email: email, password: hashedPassword });
            await user.save();
        }

        const dbPassword = user.password;
        let isMatch = await bcrypt.compare(password, dbPassword);
        if (!isMatch && password === dbPassword) isMatch = true;

        if (isMatch) {
            // Giriş başarılı olunca kullanıcının karşısına doğrudan Uçuş Paneli HTML'ini basıyoruz
            res.send(`
                <div style="font-family:Arial, sans-serif; max-width:600px; margin:50px auto; padding:20px; border:1px solid #ddd; border-radius:100px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); background:#fff; border-radius:12px;">
                    <h2 style="color: #2c3e50; text-align:center; margin-bottom:5px;">✈️ Uçuş Log Defteri</h2>
                    <p style="text-align:center; color:#7f8c8d; font-size:14px;">Aktif Kullanıcı: <strong>${email}</strong></p>
                    <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
                    
                    <form action="/add-flight" method="POST" style="display:flex; flex-direction:column; gap:15px;">
                        <input type="hidden" name="userEmail" value="${email}">
                        
                        <label style="font-weight:bold;">Tarih:</label>
                        <input type="date" name="tarih" required style="padding:10px; border:1px solid #ccc; border-radius:5px;">
                        
                        <label style="font-weight:bold;">Eğitim Sınıflandırması:</label>
                        <select name="egitimTipi" style="padding:10px; border:1px solid #ccc; border-radius:5px;">
                            <option value="ggg">ggg</option>
                            <option value="gş">gş</option>
                            <option value="au(sim)">au(sim)</option>
                        </select>
                        
                        <label style="font-weight:bold;">Uçuş Süresi (Örn: 2.5 veya 1.45):</label>
                        <input type="text" name="sure" placeholder="Örn: 2.5 yazarsanız 02:30 olarak kaydedilir" required style="padding:10px; border:1px solid #ccc; border-radius:5px;">
                        
                        <button type="submit" style="padding:12px; background:#2ecc71; color:white; border:none; border-radius:5px; font-size:16px; font-weight:bold; cursor:pointer;">Uçuşu Veritabanına Kaydet</button>
                    </form>
                    
                    <div style="text-align:center; margin-top:20px;">
                        <a href="/my-flights?email=${email}" style="color:#3498db; text-decoration:none; font-weight:bold;">📋 Önceki Uçuşlarımı Göster</a>
                    </div>
                </div>
            `);
        } else {
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Şifre Hatalı!</h1><a href="/">Tekrar Dene</a></div>`);
        }

    } catch (error) {
        console.error(error);
        res.status(500).send("Sunucu hatası.");
    }
});

// VERİTABANINA UÇUŞ KAYDETME ROTASI
app.post('/add-flight', async (req, res) => {
    const { userEmail, tarih, egitimTipi, sure } = req.body;

    // Sizin istediğiniz otomatik saat formatı düzeltmesi (2.5 -> 02:30)
    const duzeltilmisSure = formatUcusSaati(sure);

    try {
        const newFlight = new Flight({
            userEmail: userEmail,
            tarih: tarih,
            egitimTipi: egitimTipi,
            sure: duzeltilmisSure
        });

        await newFlight.save();

        res.send(`
            <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                <h1 style="color: #2ecc71;">✔️ Uçuş Başarıyla Kaydedildi!</h1>
                <p style="font-size:18px; color:#555;">Girdiğiniz süre otomatik olarak düzenlendi: <strong>${duzeltilmisSure}</strong></p>
                <br>
                <form action="/login" method="POST" style="display:inline;">
                    <input type="hidden" name="email" value="${userEmail}">
                    <input type="hidden" name="password" value="gecici"> <button type="submit" style="padding:10px 20px; background:#3498db; color:white; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">Panel geri dön</button>
                </form>
            </div>
        `);
    } catch (error) {
        console.error("Uçuş kaydedilemedi:", error);
        res.status(500).send("Uçuş kaydedilirken bir hata oluştu.");
    }
});

// KULLANICININ KENDİ UÇUŞLARINI LİSTELEME ROTASI
app.get('/my-flights', async (req, res) => {
    const email = req.query.email;

    try {
        const flights = await Flight.find({ userEmail: email });

        let listeHtml = flights.map(f => `
            <tr style="border-bottom: 1px solid #ddd; text-align:center;">
                <td style="padding:10px;">${f.tarih}</td>
                <td style="padding:10px; font-weight:bold; color:#2c3e50;">${f.egitimTipi}</td>
                <td style="padding:10px; color:#e67e22; font-weight:bold;">${f.sure}</td>
            </tr>
        `).join('');

        res.send(`
            <div style="font-family:Arial, sans-serif; max-width:600px; margin:50px auto; padding:20px; border:1px solid #ddd; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1);">
                <h2 style="text-align:center; color:#2c3e50;">📋 Uçuş Kayıtlarınız</h2>
                <p style="text-align:center; color:#7f8c8d;">${email}</p>
                
                <table style="width:100%; border-collapse:collapse; margin-top:20px;">
                    <thead>
                        <tr style="background:#f2f2f2;">
                            <th style="padding:10px; border-bottom:2px solid #ddd;">Tarih</th>
                            <th style="padding:10px; border-bottom:2px solid #ddd;">Eğitim Tipi</th>
                            <th style="padding:10px; border-bottom:2px solid #ddd;">Süre (HH:MM)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listeHtml || '<tr><td colspan="3" style="text-align:center; padding:20px; color:#999;">Henüz uçuş kaydı bulunamadı.</td></tr>'}
                    </tbody>
                </table>
                <br>
                <div style="text-align:center;">
                    <a href="/" style="display:inline-block; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">Ana Sayfaya Dön</a>
                </div>
            </div>
        `);
    } catch (error) {
        res.status(500).send("Uçuşlar listelenirken hata oluştu.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu aktif.`));