const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Form verilerini eksiksiz okumak için gerekli middleware tanımları
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// HTML/CSS dosyalarının olduğu public klasörünü dışarıya açıyoruz
app.use(express.static(path.join(__dirname, 'public')));

// Render Environment Variables'dan gelen URI bağlantısı
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
  .then(() => console.log("✔️ [BAŞARILI] MongoDB bağlantısı başarıyla kuruldu!"))
  .catch(err => console.error("❌ [HATA] MongoDB Bağlantı Hatası: ", err));

// MongoDB Kullanıcı Şeması
// Hem İngilizce (email/password) hem Türkçe (eposta/sifre) olasılığına karşı esnek yapı
const UserSchema = new mongoose.Schema({
    eposta: String,
    sifre: String,
    email: String,
    password: String
}, { strict: false }); // strict: false sayesinde veritabanında ne isimle kayıtlıysa onu okuyabiliriz

const User = mongoose.model('User', UserSchema);

// ANA SAYFA: index.html dosyasını gösterir
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// LOGIN MEKANİZMASI
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // 🔍 LOG 1: Kullanıcının ekrandan ne yazdığını Render logunda görmek için
    console.log(`--- GİRİŞ DENEMESİ ---`);
    console.log(`Siteden Yazılan E-posta: [${email}]`);
    console.log(`Siteden Yazılan Şifre: [${password}]`);

    try {
        // 🔍 LOG 2: Veritabanında kayıtlı olan İLK kullanıcıyı çekip yapısına bakıyoruz
        const anyUser = await User.findOne({});
        console.log("Veritabanındaki İlk Verinin Gerçek Hali:", anyUser);

        // Hem eposta/sifre hem de email/password kombinasyonlarını aynı anda sorguluyoruz (Hata riskini sıfırlamak için)
        const user = await User.findOne({
            $or: [
                { eposta: email, sifre: password },
                { email: email, password: password },
                { eposta: email, password: password },
                { email: email, sifre: password }
            ]
        });

        if (user) {
            console.log("✔️ Eşleşme bulundu, giriş başarılı!");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #2ecc71;">✔️ Giriş Başarılı!</h1>
                    <p style="font-size:18px; color:#555;">Sisteme başarıyla giriş yaptınız.</p>
                </div>
            `);
        } else {
            console.log("❌ Eşleşen kullanıcı bulunamadı, giriş başarısız!");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #e74c3c;">❌ Giriş Başarısız!</h1>
                    <p style="font-size:18px; color:#555;">E-posta veya şifre hatalı.</p>
                    <a href="/" style="display:inline-block; margin-top:15px; padding:10px 20px; background:#3498db; color:white; text-decoration:none; border-radius:5px;">Tekrar Dene</a>
                </div>
            `);
        }
    } catch (error) {
        console.error("Sorgu sırasında hata meydana geldi:", error);
        res.status(500).send("Sunucu içi hata oluştu.");
    }
});

// Port Ayarı
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor.`);
});