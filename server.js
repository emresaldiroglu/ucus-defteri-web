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
        // Veritabanında kullanıcıyı ara
        let user = await User.findOne({
            $or: [{ email: email }, { eposta: email }]
        });

        // 🎯 SİHİRLİ DOKUNUŞ: Eğer kullanıcı ucusDB içinde yoksa, otomatik oluşturuyoruz!
        if (!user) {
            console.log(`💡 [OTOMATİK KAYIT] ${email} bulunamadı. ucusDB içine otomatik ekleniyor...`);
            
            // Siteden girilen şifreyi güvenli bir şekilde Bcrypt ile şifrele
            const hashedPassword = await bcrypt.hash(password, 10);
            
            user = new User({
                email: email,
                password: hashedPassword
            });
            
            await user.save();
            console.log(`✔️ [OTOMATİK KAYIT] Kullanıcı başarıyla oluşturuldu!`);
        }

        const dbPassword = user.password || user.sifre;

        // Şifre kontrolü
        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, dbPassword);
        } catch (e) {
            isMatch = false;
        }

        if (!isMatch && password === dbPassword) {
            isMatch = true;
        }

        if (isMatch) {
            console.log("✔️ Giriş başarılı!");
            res.send(`
                <div style="font-family:Arial, sans-serif; text-align:center; margin-top:100px;">
                    <h1 style="color: #2ecc71;">✔️ Giriş Başarılı!</h1>
                    <p style="font-size:18px; color:#555;">Uçuş Log Sistemine Başarıyla Giriş Yaptınız.</p>
                </div>
            `);
        } else {
            console.log("❌ Şifre yanlış!");
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Giriş Başarısız!</h1><p>Şifre hatalı.</p><a href="/">Tekrar Dene</a></div>`);
        }

    } catch (error) {
        console.error("🔴 HATA:", error);
        res.status(500).send("Sunucu hatası.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Sunucu aktif."));