const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// FORM VERİLERİNİ OKUMAK İÇİN (Kritik Ayar: Not Found hatasını önler)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Klasördeki statik dosyaları (HTML/CSS) dışarıya açıyoruz
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Bağlantısı (Render panelindeki Environment Variables'dan MONGO_URI'yi çeker)
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
    console.error("HATA: Render panelinde MONGO_URI çevre değişkeni tanımlanmamış!");
}

mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB bağlantısı başarıyla kuruldu!"))
  .catch(err => console.error("MongoDB Bağlantı Hatası: ", err));

// Veritabanı Kullanıcı Şeması (Koleksiyon adı otomatik 'users' olur)
const UserSchema = new mongoose.Schema({
    eposta: { type: String, required: true },
    sifre: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

// 1. ROTA (GET): Kullanıcı siteye ilk girdiğinde index.html'i gösterir
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. ROTA (POST): Giriş Yap butonuna basıldığında çalışan ana mekanizma
app.post('/login', async (req, res) => {
    // HTML'deki name="email" ve name="password" alanlarından verileri alıyoruz
    const { email, password } = req.body;

    try {
        // MongoDB'de bu eposta ve şifreye ait bir kayıt var mı kontrol et
        const user = await User.findOne({ eposta: email, sifre: password });

        if (user) {
            // Kullanıcı bulunduysa
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #2ecc71;">✔️ Giriş Başarılı!</h1>
                    <p style="font-size:18px; color:#555;">Hoş geldiniz, <b>${email}</b>.</p>
                </div>
            `);
        } else {
            // Kullanıcı bulunamadıysa veya şifre yanlışsa
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #e74c3c;">❌ Giriş Başarısız!</h1>
                    <p style="font-size:18px; color:#555;">E-posta veya şifre hatalı.</p>
                    <a href="/" style="display:inline-block; margin-top:15px; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px;">Tekrar Dene</a>
                </div>
            `);
        }
    } catch (error) {
        console.error("Giriş esnasında hata oluştu:", error);
        res.status(500).send("Sunucu tarafında bir hata oluştu.");
    }
});

// Render'ın vereceği dinamik portu veya localde 3000 portunu dinle
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda başarıyla ayağa kalktı.`);
});