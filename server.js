const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Bağlantısı (Render üzerindeki Çevre Değişkeninden MONGO_URI'yi okuyacak)
const dbURI = process.env.MONGO_URI; 

mongoose.connect(dbURI)
  .then(() => {
      console.log('MongoDB Atlas bağlantısı başarılı!');
      createInitialUser(); // İlk açılışta test kullanıcısı ekler
  })
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Kullanıcı Veritabanı Şeması
const User = mongoose.model('User', new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
}));

// Otomatik Test Kullanıcısı Oluşturma (Veritabanı boşsa çalışır)
async function createInitialUser() {
    const userExist = await User.findOne({ email: 'test@mail.com' });
    if (!userExist) {
        const hashedPassword = await bcrypt.hash('123456', 10);
        await new User({ email: 'test@mail.com', password: hashedPassword }).save();
        console.log('Test kullanıcısı oluşturuldu: test@mail.com / 123456');
    }
}

// Giriş Kontrol Rotası
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).send('Kullanıcı bulunamadı!');

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            res.send(`<h1>Giriş Başarılı! Hoş geldiniz, ${user.email}</h1>`);
        } else {
            res.status(400).send('Şifre yanlış!');
        }
    } catch (error) {
        res.status(500).send('Sistemsel bir hata oluştu.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda aktif.`));