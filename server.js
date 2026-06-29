const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();

// Middleware ayarları (Form verilerini okumak için)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Render Environment Variables'dan gelen URI bağlantısı
const mongoURI = process.env.MONGO_URI;

// 🎯 KRİTİK AYAR: dbName: 'test' ekleyerek yanlış veritabanına bağlanma sorununu çözüyoruz
mongoose.connect(mongoURI, {
    dbName: 'test' 
})
  .then(() => console.log("✔️ [BAŞARILI] MongoDB 'test' veritabanına kesin bağlantı sağlandı!"))
  .catch(err => console.error("❌ MongoDB Bağlantı Hatası: ", err));

// Esnek Şema Tanımı
const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema, 'users');

// Ana Sayfa Rotaları
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN MEKANİZMASI (Bcrypt ve Çift Dil Uyumlu)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    console.log(`--- GİRİŞ DENEMESİ ---`);
    console.log(`Siteden Girilen E-posta: [${email}]`);

    try {
        // E-posta veya eposta alanına göre kullanıcıyı veritabanında ara
        const user = await User.findOne({
            $or: [
                { email: email },
                { eposta: email }
            ]
        });

        if (!user) {
            console.log("❌ Kullanıcı veritabanında bulunamadı!");
            return res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #e74c3c;">❌ Giriş Başarısız!</h1>
                    <p style="font-size:18px; color:#555;">Böyle bir kullanıcı bulunamadı.</p>
                    <a href="/" style="display:inline-block; margin-top:15px; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px;">Tekrar Dene</a>
                </div>
            `);
        }

        // Veritabanındaki şifre alanını bul (password veya sifre)
        const dbPassword = user.password || user.sifre;

        // 🔐 Bcrypt şifre karşılaştırması
        const isMatch = await bcrypt.compare(password, dbPassword);

        if (isMatch) {
            console.log("✔️ Şifre doğru, giriş başarılı!");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #2ecc71;">✔️ Giriş Başarılı!</h1>
                    <p style="font-size:18px; color:#555;">Sisteme başarıyla giriş yaptınız.</p>
                </div>
            `);
        } else {
            console.log("❌ Şifre yanlış!");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #e74c3c;">❌ Giriş Başarısız!</h1>
                    <p style="font-size:18px; color:#555;">E-posta veya şifre hatalı.</p>
                    <a href="/" style="display:inline-block; margin-top:15px; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px;">Tekrar Dene</a>
                </div>
            `);
        }

    } catch (error) {
        console.error("Sorgu hatası:", error);
        res.status(500).send("Sunucu hatası oluştu.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda aktif.`));