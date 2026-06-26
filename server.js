// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Ana dizindeki index.html'i sun

// --- Veritabanı Bağlantısı ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB veritabanına başarıyla bağlandı.'))
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

// --- Veri Modelleri ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});
const User = mongoose.model('User', UserSchema);

const FlightSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ucusTarihi: { type: Date, required: true },
    havaAraciTipi: { type: String, required: true },
    ucusTipi: { type: String, required: true },
    ucusSaati: { type: String, required: true }
});

const Flight = mongoose.model('Flight', FlightSchema);

// Sanal bir 'id' alanı ekleyerek _id'yi id olarak da kullanılabilir hale getiriyoruz.
FlightSchema.virtual('id').get(function(){
    return this._id.toHexString();
});
FlightSchema.set('toJSON', { virtuals: true });

// --- Auth Middleware ---
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ message: 'Yetki reddedildi, token yok.' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(400).json({ message: 'Token geçersiz.' });
    }
};

// --- API Rotaları ---

// Kullanıcı Kaydı
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Lütfen tüm alanları doldurun.' });

    let user = await User.findOne({ username });
    if (user) return res.status(400).json({ message: 'Bu kullanıcı adı zaten mevcut.' });

    user = new User({ username, password });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(201).json({ token, user: { id: user.id, username: user.username } });
});

// Kullanıcı Girişi
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Lütfen tüm alanları doldurun.' });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: 'Geçersiz kullanıcı bilgileri.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Geçersiz kullanıcı bilgileri.' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username } });
});

// Kullanıcının uçuşlarını getir
app.get('/api/flights', auth, async (req, res) => {
    const flights = await Flight.find({ userId: req.user.id }).sort({ ucusTarihi: -1 });
    res.json(flights);
});

// Yeni uçuş ekle
app.post('/api/flights', auth, async (req, res) => {
    const { ucusTarihi, havaAraciTipi, ucusTipi, ucusSaati } = req.body;
    const newFlight = new Flight({
        userId: req.user.id,
        ucusTarihi, havaAraciTipi, ucusTipi, ucusSaati
    });
    const savedFlight = await newFlight.save();
    res.status(201).json(savedFlight);
});

// Uçuşu güncelle
app.put('/api/flights/:id', auth, async (req, res) => {
    const updatedFlight = await Flight.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedFlight);
});

// Uçuşu sil
app.delete('/api/flights/:id', auth, async (req, res) => {
    await Flight.findByIdAndDelete(req.params.id);
    res.json({ message: 'Uçuş başarıyla silindi.' });
});

// Sunucuyu başlat
app.listen(PORT, () => console.log(`Sunucu ${PORT} portunda çalışıyor...`));