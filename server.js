const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Dünyadan gelecek isteklere ve JSON verilerine izin veriyoruz
app.use(cors());
app.use(express.json());

// 1. MONGODB BAĞLANTISI
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Atlas bağlantısı başarıyla kuruldu.'))
    .catch(err => console.error('Veri tabanı bağlantı hatası:', err));

// 2. MONGODB MODELİ (Database'deki tablonun yapısı)
// Veri tabanında "users" adında bir koleksiyon (tablo) arayacak
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);


// 3. GİRİŞ API UÇ NOKTASI (Login Route)
// HTML'deki fetch('http://localhost:5000/api/login') burayı tetikler
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // MongoDB'de bu kullanıcı adı ve şifreye sahip biri var mı diye bakıyoruz
        const user = await User.findOne({ username: username, password: password });

        if (user) {
            // Eşleşme bulunduysa HTML'e olumlu yanıt dönüyoruz
            return res.status(200).json({ success: true, message: 'Giriş başarılı!' });
        } else {
            // Kullanıcı yoksa veya şifre yanlışsa olumsuz yanıt dönüyoruz
            return res.status(401).json({ success: false, message: 'Kullanıcı ID veya şifre hatalı!' });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: 'Sunucu hatası meydana geldi.' });
    }
});

// Sunucuyu başlatıyoruz
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});