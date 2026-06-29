const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs'); // 🔐 Şifre karşılaştırma için eklendi

const app = express();

// Middleware ayarları
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Bağlantısı
const mongoURI = process.env.MONGO_URI;
mongoose.connect(mongoURI)
  .then(() => console.log("✔️ MongoDB bağlantısı kuruldu!"))
  .catch(err => console.error("❌ MongoDB Bağlantı Hatası: ", err));

// Şema Tanımı ( strict: false ile veritabanındaki her türlü alanı esnekçe okuyoruz )
const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema, 'users'); // 'users' tablosuna doğrudan bağlan dedik

// Ana Sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GİRİŞ KONTROLÜ (Bcrypt Uyumlu)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    console.log(`--- GİRİŞ DENEMESİ ---`);
    console.log(`Siteden Girilen E-posta: [${email}]`);

    try {
        // 1. Veritabanında e-posta veya eposta alanına göre kullanıcıyı ara
        const user = await User.findOne({
            $or: [
                { email: email },
                { eposta: email }
            ]
        });

        if (!user) {
            console.log("❌ Kullanıcı bulunamadı!");
            return res.send(`
                <div style="font-family:Arial; text-align:center; margin-top:100px;">
                    <h1 style="color: red;">❌ Giriş Başarısız!</h1>
                    <p>Böyle bir kullanıcı bulunamadı.</p>
                    <a href="/">Tekrar Dene</a>
                </div>
            `);
        }

        // 2. Kullanıcı bulunduysa, veritabanındaki şifre alanını tespit et (password veya sifre)
        const dbPassword = user.password || user.sifre;

        // 3. 🔐 Bcrypt ile girilen düz şifre ile veritabanındaki kriptolu şifreyi karşılaştır
        const isMatch = await bcrypt.compare(password, dbPassword);

        if (isMatch) {
            console.log("✔️ Şifreler eşleşti, giriş başarılı!");
            res.send(`
                <div style="font-family:Arial; text-align:center; margin-top:100px;">
                    <h1 style="color: green;">✔️ Giriş Başarılı!</h1>
                    <p>Sisteme başarıyla giriş yaptınız.</p>
                </div>
            `);
        } else {
            console.log("❌ Şifre yanlış!");
            res.send(`
                <div style="font-family:Arial; text-align:center; margin-top:100px;">
                    <h1 style="color: red;">❌ Giriş Başarısız!</h1>
                    <p>E-posta veya şifre hatalı.</p>
                    <a href="/">Tekrar Dene</a>
                </div>
            `);
        }

    } catch (error) {
        console.error("Hata oluştu:", error);
        res.status(500).send("Sunucu hatası.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu ${PORT} portunda aktif.`));