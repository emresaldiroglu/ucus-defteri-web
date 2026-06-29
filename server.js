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

mongoose.connect(mongoURI, {
    dbName: 'ucusDB' 
})
  .then(() => console.log("✔️ [BAŞARILI] ucusDB bağlantısı aktif."))
  .catch(err => console.error("❌ Bağlantı Hatası: ", err));

const UserSchema = new mongoose.Schema({
    email: String,
    eposta: String,
    password: String,
    sifre: String
});

const User = mongoose.model('User', UserSchema, 'users');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    console.log(`--- GİRİŞ DENEMESİ --- Siteden Girilen: [${email}]`);

    try {
        const user = await User.findOne({
            $or: [{ email: email }, { eposta: email }]
        });

        if (!user) {
            console.log("❌ Kullanıcı bulunamadı!");
            return res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Giriş Başarısız!</h1><p>Kullanıcı bulunamadı.</p><a href="/">Tekrar Dene</a></div>`);
        }

        const dbPassword = user.password || user.sifre;

        // 🔐 1. KONTROL: Bcrypt şifreleme uyumu (Kriptolu şifre için)
        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, dbPassword);
        } catch (bcryptErr) {
            // Eğer veritabanındaki şifre kriptolu değilse bcrypt hata verebilir, düz metin kontrolüne geçeceğiz
            isMatch = false;
        }

        // 📝 2. KONTROL: Düz metin uyumu (Veritabanında direkt "sifre123" veya "123456" yazıyorsa)
        if (!isMatch && (password === dbPassword)) {
            isMatch = true;
        }

        if (isMatch) {
            console.log("✔️ Giriş başarılı! Eşleşme sağlandı.");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #2ecc71;">✔️ Giriş Başarılı!</h1>
                    <p style="font-size:18px; color:#555;">Uçuş Log Sistemine Başarıyla Giriş Yaptınız.</p>
                </div>
            `);
        } else {
            console.log("❌ Şifre yanlış! Girilen şifre veritabanındaki veriyle uyuşmuyor.");
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Giriş Başarısız!</h1><p>Şifre hatalı.</p><a href="/">Tekrar Dene</a></div>`);
        }

    } catch (error) {
        console.error("🔴 HATA:", error);
        res.status(500).send("Sunucu hatası.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda aktif.`));