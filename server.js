const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Formdan gelen verileri okumak için ayar
app.use(bodyParser.urlencoded({ extended: true }));

// Klasördeki HTML dosyasını dışarıya açıyoruz
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Bağlantısı (Render Environment Variables'dan çekecek)
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB bağlantısı başarıyla kuruldu!"))
  .catch(err => console.log("MongoDB Bağlantı Hatası: ", err));

// Veritabanı Kullanıcı Şeması (Koleksiyon adı otomatik 'users' olur)
const UserSchema = new mongoose.Schema({
    eposta: { type: String, required: true },
    sifre: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// ANA SAYFA: Kullanıcı siteye girdiğinde index.html'i göster
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN POST ROTASI: Form gönderildiğinde burası çalışır
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Veritabanında eşleşen kullanıcıyı ara
        const user = await User.findOne({ eposta: email, sifre: password });

        if (user) {
            res.send(`
                <div style="font-family:Arial; text-align:center; margin-top:50px;">
                    <h1 style="color: green;">Giriş Başarılı!</h1>
                    <p>Hoş geldiniz, ${email}!</p>
                </div>
            `);
        } else {
            res.send(`
                <div style="font-family:Arial; text-align:center; margin-top:50px;">
                    <h1 style="color: red;">Giriş Başarısız!</h1>
                    <p>E-posta veya şifre hatalı.</p>
                    <a href="/">Tekrar Dene</a>
                </div>
            `);
        }
    } catch (error) {
        res.status(500).send("Sunucu içi bir hata oluştu.");
    }
});

// Render'ın vereceği dinamik portu veya localde 3000 portunu dinle
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});