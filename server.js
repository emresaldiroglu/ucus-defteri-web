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

// 🎯 KRİTİK AYAR: dbName kısmını 'ucusDB' olarak değiştirerek doğru veritabanını hedefliyoruz
mongoose.connect(mongoURI, {
    dbName: 'ucusDB' 
})
  .then(() => console.log("✔️ [BAŞARILI] MongoDB 'ucusDB' veritabanına kesin bağlantı sağlandı!"))
  .catch(err => console.error("❌ MongoDB Bağlantı Hatası: ", err));

// Kullanıcı Şeması
const UserSchema = new mongoose.Schema({
    email: { type: String },
    eposta: { type: String },
    password: { type: String },
    sifre: { type: String }
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
            $or: [
                { email: email },
                { eposta: email }
            ]
        });

        if (!user) {
            console.log("❌ Kullanıcı bulunamadı!");
            return res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Giriş Başarısız!</h1><p>Böyle bir kullanıcı bulunamadı.</p><a href="/">Tekrar Dene</a></div>`);
        }

        const dbPassword = user.password || user.sifre;
        const isMatch = await bcrypt.compare(password, dbPassword);

        if (isMatch) {
            console.log("✔️ Giriş başarılı!");
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: green;">✔️ Giriş Başarılı!</h1><p>Uçuş Log Sistemine Başarıyla Giriş Yaptınız.</p></div>`);
        } else {
            console.log("❌ Şifre yanlış!");
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Giriş Başarısız!</h1><p>E-posta veya şifre hatalı.</p><a href="/">Tekrar Dene</a></div>`);
        }

    } catch (error) {
        console.error("🔴 VERİTABANI SORGULAMA HATASI:", error);
        res.status(500).send("Sunucu hatası oluştu.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda aktif.`));