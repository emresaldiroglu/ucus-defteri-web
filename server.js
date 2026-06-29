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

// --- MONGODB ŞEMALARI ---

const UserSchema = new mongoose.Schema({
    email: String,
    password: String,
    muayene1Tarih: String, 
    muayene4Tarih: String, 
    aletKartTarih: String, 
    standTarih: String     
});
const User = mongoose.model('User', UserSchema, 'users');

const FlightSchema = new mongoose.Schema({
    userEmail: String,
    tarih: String,
    havaAraciTipi: String,
    egitimTipi: String,
    sure: String,
    gorevAciklamasi: String
});
const Flight = mongoose.model('Flight', FlightSchema, 'flights');


// --- YARDIMCI FONKSİYONLAR ---

function formatUcusSaati(saatInput) {
    let num = parseFloat(saatInput);
    if (isNaN(num)) return "00:00";
    let saat = Math.floor(num);
    let dakika = Math.round((num - saat) * 60);
    return `${saat.toString().padStart(2, '0')}:${dakika.toString().padStart(2, '0')}`;
}

function hesaplaToplamSaat(flights) {
    let toplamDakika = 0;
    flights.forEach(f => {
        if (f.sure && f.sure.includes(':')) {
            const [saat, dakika] = f.sure.split(':').map(Number);
            toplamDakika += (saat * 60) + dakika;
        }
    });
    let toplamSaat = Math.floor(toplamDakika / 60);
    let kalanDakika = toplamDakika % 60;
    return `${toplamSaat.toString().padStart(2, '0')}:${kalanDakika.toString().padStart(2, '0')}`;
}

function getGunFarki(hedefTarih) {
    if (!hedefTarih) return null;
    const bugun = new Date();
    const hedef = new Date(hedefTarih);
    const zamanFarki = hedef.getTime() - bugun.getTime();
    return Math.ceil(zamanFarki / (1000 * 3600 * 24));
}


// --- ROTALAR ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let user = await User.findOne({ email: email });
        if (!user) {
            const hashedPassword = await bcrypt.hash(password, 10);
            user = new User({ email: email, password: hashedPassword });
            await user.save();
        }

        const dbPassword = user.password;
        let isMatch = await bcrypt.compare(password, dbPassword);
        if (!isMatch && password === dbPassword) isMatch = true;

        if (isMatch) {
            const flights = await Flight.find({ userEmail: email }).sort({ tarih: -1 });
            const toplamUcusSüresi = hesaplaToplamSaat(flights);

            // GGG ve Son Uçuş hesaplamaları
            const sonUcus = flights[0];
            const sonGggUcus = flights.find(f => f.egitimTipi === 'ggg');
            
            const sonUcusTarihStr = sonUcus ? sonUcus.tarih : new Date().toISOString().split('T')[0];
            const sonGggTarihStr = sonGggUcus ? sonGggUcus.tarih : new Date().toISOString().split('T')[0];

            const hedefGgg = new Date(sonGggTarihStr); hedefGgg.setDate(hedefGgg.getDate() + 60);
            const hedefSonUcus = new Date(sonUcusTarihStr); hedefSonUcus.setDate(hedefSonUcus.getDate() + 60);

            const kalanGgg = getGunFarki(hedefGgg);
            const kalanSonUcus = getGunFarki(hedefSonUcus);

            const renkGgg = kalanGgg <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';
            const renkSonUcus = kalanSonUcus <= 15 ? 'background:#e74c3c;' : 'background:#2ecc71;';

            // Dinamik etiketli sayaç hesaplama fonksiyonu
            const hesaplaTarihliSayaç = (baslangicTarihi, periyotYil, etiket) => {
                if (!baslangicTarihi) {
                    return { 
                        gun: null, 
                        html: `<div onclick="tarihSecimiAc('${etiket}', '${etiket.toLowerCase().replace(/ /g, '')}')" style="background:#bdc3c7; color:#2c3e50; padding:10px; border-radius:8px; text-align:center; font-size:11px; cursor:pointer; border:1px dashed #7f8c8d;"><strong>${etiket}</strong><br><span style="font-size:12px; font-weight:bold; color:#c0392b;">⚠️ TARİH GİRİLMEDİ</span></div>` 
                    };
                }
                const hedef = new Date(baslangicTarihi);
                hedef.setFullYear(hedef.getFullYear() + periyotYil);
                const kalanGün = getGunFarki(hedef);
                let renk = kalanGün <= 90 ? 'background:#e74c3c;' : 'background:#3498db;';
                return { gun: kalanGün, renk: renk };
            };

            const sMuayene1 = hesaplaTarihliSayaç(user.muayene1Tarih, 1, '1 Yıllık Muayene');
            const sMuayene4 = hesaplaTarihliSayaç(user.muayene4Tarih, 4, '4 Yıllık Muayene');
            const sAlet = hesaplaTarihliSayaç(user.aletKartTarih, 1, 'Alet Kart');
            const sStand = hesaplaTarihliSayaç(user.standTarih, 1, 'Standardizasyon');

            res.send(`
                <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width:900px; margin:20px auto; padding:25px; border:1px solid #e0e0e0; border-radius:12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); background:#fff;">
                    
                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px; margin-bottom: 25px;">
                        <div style="background: linear-gradient(135deg, #2c3e50, #3498db); color: white; padding: 20px; border-radius: 10px; text-align: center; display:flex; flex-direction:column; justify-content:center;">
                            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">TOPLAM UÇUŞ SAATİ</span>
                            <h1 id="toplamSaatGosterge" style="margin: 5px 0 0 0; font-size: 38px; font-weight: bold;">${toplamUcusSüresi}</h1>
                            <p style="margin:5px 0 0 0; font-size:12px; opacity:0.8;">${email}</p>
                        </div>

                        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
                            <div style="${renkGgg} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>GGG Sayaç (60 Gün)</strong><br><span style="font-size:20px; font-weight:bold;">${kalanGgg} Gün</span>
                            </div>
                            <div style="${renkSonUcus} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px;">
                                <strong>Son Uçuş (60 Gün)</strong><br><span style="font-size:20px; font-weight:bold;">${kalanSonUcus} Gün</span>
                            </div>
                            
                            ${sMuayene1.gun !== null ? `<div onclick="tarihSecimiAc('1 Yıllık Muayene', 'muayene1Tarih')" style="${sMuayene1.renk} color:white; padding:10px; border-radius:8px; text-align:center; font-size:11px; cursor:pointer;"><strong>1 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene1.gun} Gün</span>${sMuayene1.gun <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}</div>` : sMuayene1.html}
                            ${sMuayene4.gun !== null ? `<div onclick="tarihSecimiAc('4 Yıllık Muayene', 'muayene4Tarih')" style="${sMuayene4.renk} color:white; padding:10px; border-radius:8px; text-align:center; font-size:11px; cursor:pointer;"><strong>4 Yıllık Muayene</strong><br><span style="font-size:18px; font-weight:bold;">${sMuayene4.gun} Gün</span>${sMuayene4.gun <= 90 ? '<br><span style="font-size:10px; background:yellow; color:black; padding:1px 4px; border-radius:3px; font-weight:bold;">⚠️ RANDEVU AL!</span>' : ''}</div>` : sMuayene4.html}
                            ${sAlet.gun !== null ? `<div onclick="tarihSecimiAc('Alet Kart', 'aletKartTarih')" style="${sAlet.renk} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Alet Kart</strong><br><span style="font-size:18px; font-weight:bold;">${sAlet.gun} Gün</span></div>` : sAlet.html}
                            ${sStand.gun !== null ? `<div onclick="tarihSecimiAc('Standardizasyon', 'standTarih')" style="${sStand.renk || 'background:#f1c40f; color:#000;'} color:white; padding:10px; border-radius:8px; text-align:center; font-size:12px; cursor:pointer;"><strong>Standardizasyon</strong><br><span style="font-size:18px; font-weight:bold;">${sStand.gun} Gün</span></div>` : sStand.html}
                        </div>
                    </div>

                    <div style="background:#f1f2f6; padding:15px; border-radius:10px; margin-bottom:20px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
                        <strong style="color:#2c3e50;">📋 Gelişmiş Filtrele:</strong>
                        <input type="number" id="filtreYil" placeholder="Yıl" style="padding:6px; border:1px solid #ccc; border-radius:4px; width:100px;">
                        <select id="filtreAy" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Ay Seçin</option>
                            <option value="01">Ocak</option><option value="02">Şubat</option><option value="03">Mart</option>
                            <option value="04">Nisan</option><option value="05">Mayıs</option><option value="06">Haziran</option>
                            <option value="07">Temmuz</option><option value="08">Ağustos</option><option value="09">Eylül</option>
                            <option value="10">Ekim</option><option value="11">Kasım</option><option value="12">Aralık</option>
                        </select>
                        <select id="filtreHavaAraci" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Hava Aracı Seçin</option>
                            <option value="sikorsky">Sikorsky (s70, s70i, t70)</option>
                            <option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option>
                            <option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option>
                        </select>
                        <select id="filtreUcusTipi" style="padding:6px; border:1px solid #ccc; border-radius:4px;">
                            <option value="">Uçuş Tipi Seçin</option>
                            <option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option>
                        </select>
                        <button onclick="filtreleUcuslari()" style="padding:6px 12px; background:#34495e; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Uygula</button>
                        <button onclick="filtreleriTemizle()" style="padding:6px 12px; background:#7f8c8d; color:white; border:none; border-radius:4px; cursor:pointer;">Temizle</button>
                        
                        <div id="filtreSaatKutusu" style="margin-left:auto; background:#2c3e50; color:#fff; padding:6px 12px; border-radius:4px; font-weight:bold; font-size:13px; display:none;">
                            ⏱️ Filtrelenen Toplam Süre: <span id="filtreliSaatGosterge">00:00</span>
                        </div>
                    </div>

                    <form id="ucusFormu" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; background:#f9f9f9; padding:20px; border-radius:10px; margin-bottom:25px;">
                        <input type="hidden" id="userEmail" value="${email}">
                        <div><label style="font-weight:bold;">Tarih:</label><input type="date" id="tarih" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;"></div>
                        <div><label style="font-weight:bold;">Hava Aracı Tipi:</label><select id="havaAraciTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;"><option value="s70">s70</option><option value="s70i">s70i</option><option value="t70">t70</option><option value="atak">atak</option><option value="mi17">mi17</option><option value="gökbey">gökbey</option></select></div>
                        <div><label style="font-weight:bold;">Eğitim Sınıflandırması:</label><select id="egitimTipi" style="width:95%; padding:10px; border:1px solid #ccc; border-radius:5px;"><option value="ggg">ggg</option><option value="gş">gş</option><option value="au(sim)">au(sim)</option></select></div>
                        <div><label style="font-weight:bold;">Uçuş Süresi (Örn: 2.5):</label><input type="text" id="sure" required style="width:90%; padding:10px; border:1px solid #ccc; border-radius:5px;"></div>
                        <div style="grid-column: span 2;"><label style="font-weight:bold;">Görev Açıklaması:</label><textarea id="gorevAciklamasi" style="width:97%; padding:10px; border:1px solid #ccc; border-radius:5px; height:40px; resize:none;"></textarea></div>
                        <button type="submit" style="grid-column: span 2; padding:12px; background:#2ecc71; color:white; border:none; border-radius:5px; font-size:16px; font-weight:bold; cursor:pointer;">Uçuşu Ekle</button>
                    </form>

                    <table style="width:100%; border-collapse:collapse;">
                        <thead><tr style="background:#2c3e50; color:white;"><th style="padding:10px;">Tarih</th><th>Hava Aracı</th><th>Eğitim Tipi</th><th>Süre</th><th>Görev Açıklaması</th><th>İşlem</th></tr></thead>
                        <tbody id="ucusTabloGövde">
                            ${flights.map(f => `
                                <tr id="row-${f._id}" class="ucus-satiri" data-tarih="${f.tarih}" data-hava="${f.havaAraciTipi}" data-egitim="${f.egitimTipi}" data-sure="${f.sure}" style="border-bottom: 1px solid #eee; text-align:center;">
                                    <td style="padding:10px;">${f.tarih}</td><td style="padding:10px; font-weight:bold;">${f.havaAraciTipi}</td><td>${f.egitimTipi}</td><td style="color:#e67e22; font-weight:bold;">${f.sure}</td><td style="padding:10px; text-align:left; font-size:13px;">${f.gorevAciklamasi || ''}</td><td><button onclick="silUcus('${f._id}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:3px; cursor:pointer;">Sil</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>

                <div id="tarihModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); justify-content:center; align-items:center; z-index:9999;">
                    <div style="background:white; padding:25px; border-radius:10px; text-align:center; box-shadow:0 4px 20px rgba(0,0,0,0.3); max-width:320px; width:100%;">
                        <h3 id="modalBaslik" style="color:#2c3e50; margin-top:0;">Tarih Girin</h3>
                        <input type="hidden" id="hedefAlan">
                        <input type="date" id="yeniKategoriTarih" style="padding:10px; width:80%; margin-bottom:15px; border:1px solid #ccc; border-radius:5px;">
                        <br>
                        <button onclick="kaydetKategoriTarihi()" style="padding:8px 15px; background:#2ecc71; color:white; border:none; border-radius:4px; font-weight:bold; cursor:pointer; margin-right:10px;">Tarihi Kaydet</button>
                        <button onclick="document.getElementById('tarihModal').style.display='none'" style="padding:8px 15px; background:#95a5a6; color:white; border:none; border-radius:4px; cursor:pointer;">İptal</button>
                    </div>
                </div>

                <script>
                    function tarihSecimiAc(etiketIsmi, alanAdi) {
                        document.getElementById('modalBaslik').innerText = etiketIsmi + " Başlangıç Tarihi";
                        document.getElementById('hedefAlan').value = alanAdi;
                        document.getElementById('tarihModal').style.display = 'flex';
                    }

                    // 🎯 KAYDET BUTONU DÜZELTİLDİ
                    async function kaydetKategoriTarihi() {
                        const alan = document.getElementById('hedefAlan').value;
                        const tarihDegeri = document.getElementById('yeniKategoriTarih').value;
                        if(!tarihDegeri) { alert('Lütfen geçerli bir tarih seçin.'); return; }

                        const response = await fetch('/api/update-user-date', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userEmail: document.getElementById('userEmail').value,
                                alan: alan,
                                tarih: tarihDegeri
                            })
                        });
                        const sonuc = await response.json();
                        if(sonuc.success) {
                            alert('Tarih başarıyla güncellendi!');
                            window.location.reload();
                        }
                    }

                    document.getElementById('ucusFormu').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        if(!confirm("Yeni uçuş kaydını eklemek istiyor musunuz?")) return;
                        const veri = {
                            userEmail: document.getElementById('userEmail').value,
                            tarih: document.getElementById('tarih').value,
                            havaAraciTipi: document.getElementById('havaAraciTipi').value,
                            egitimTipi: document.getElementById('egitimTipi').value,
                            sure: document.getElementById('sure').value,
                            gorevAciklamasi: document.getElementById('gorevAciklamasi').value
                        };
                        const response = await fetch('/api/add-flight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(veri) });
                        if((await response.json()).success) window.location.reload();
                    });

                    // 🎯 SİLME ESNASINDA SAAT GÜNCELLEMESİ AKTİF EDİLDİ
                    async function silUcus(id) {
                        if(!confirm("Bu uçuş kaydını silmek istediğinize emin misiniz?")) return;
                        const response = await fetch('/api/delete-flight', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, userEmail: document.getElementById('userEmail').value }) });
                        const sonuc = await response.json();
                        if(sonuc.success) { 
                            document.getElementById('row-'+id).remove(); 
                            document.getElementById('toplamSaatGosterge').innerText = sonuc.yeniToplamSaat;
                            // Eğer filtreleme aktifse filtreli saati de anlık düşür
                            filtreleUcuslari();
                        }
                    }

                    // 🎯 DİNAMİK FİLTRELİ SAAT HESAPLAYAN YENİ ÖN YÜZ MANTIĞI
                    function filtreleUcuslari() {
                        const yil = document.getElementById('filtreYil').value;
                        const ay = document.getElementById('filtreAy').value;
                        const hava = document.getElementById('filtreHavaAraci').value;
                        const egitim = document.getElementById('filtreUcusTipi').value;
                        
                        let toplamFiltreDakika = 0;
                        let filtreAktifMi = (yil || ay || hava || egitim);

                        document.querySelectorAll('.ucus-satiri').forEach(satir => {
                            const t = satir.getAttribute('data-tarih');
                            const h = satir.getAttribute('data-hava');
                            const e = satir.getAttribute('data-egitim');
                            const s = satir.getAttribute('data-sure');

                            let u = true;
                            if(yil && t.split('-')[0] !== yil) u = false;
                            if(ay && t.split('-')[1] !== ay) u = false;
                            if(egitim && e !== egitim) u = false;
                            if(hava) {
                                if(hava === 'sikorsky') { if(h !== 's70' && h !== 's70i' && h !== 't70') u = false; }
                                else if(h !== hava) u = false;
                            }
                            
                            satir.style.display = u ? '' : 'none';

                            // Sadece filtreye uyan ve ekranda kalan satırların saatlerini topluyoruz
                            if (u && s && s.includes(':')) {
                                const [saat, dakika] = s.split(':').map(Number);
                                toplamFiltreDakika += (saat * 60) + dakika;
                            }
                        });

                        if(filtreAktifMi) {
                            let fSaat = Math.floor(toplamFiltreDakika / 60).toString().padStart(2, '0');
                            let fDakika = (toplamFiltreDakika % 60).toString().padStart(2, '0');
                            document.getElementById('filtreliSaatGosterge').innerText = fSaat + ":" + fDakika;
                            document.getElementById('filtreSaatKutusu').style.display = 'block';
                        } else {
                            document.getElementById('filtreSaatKutusu').style.display = 'none';
                        }
                    }

                    function filtreleriTemizle() {
                        document.getElementById('filtreYil').value = '';
                        document.getElementById('filtreAy').value = '';
                        document.getElementById('filtreHavaAraci').value = '';
                        document.getElementById('filtreUcusTipi').value = '';
                        document.querySelectorAll('.ucus-satiri').forEach(s => s.style.display = '');
                        document.getElementById('filtreSaatKutusu').style.display = 'none';
                    }
                </script>
            `);
        } else {
            res.send(`<div style="font-family:Arial; text-align:center; margin-top:100px;"><h1 style="color: red;">❌ Şifre Hatalı!</h1><a href="/">Tekrar Dene</a></div>`);
        }
    } catch (error) {
        res.status(500).send("Sunucu hatası.");
    }
});

app.post('/api/update-user-date', async (req, res) => {
    const { userEmail, alan, tarih } = req.body;
    try {
        const updateData = {};
        updateData[alan] = tarih;
        await User.findOneAndUpdate({ email: userEmail }, updateData);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

app.delete('/api/delete-flight', async (req, res) => {
    const { id, userEmail } = req.body;
    try { 
        await Flight.findByIdAndDelete(id); 
        const kalanlar = await Flight.find({ userEmail });
        res.json({ success: true, yeniToplamSaat: hesaplaToplamSaat(kalanlar) }); 
    } catch (e) { 
        res.json({ success: false }); 
    }
});

app.post('/api/add-flight', async (req, res) => {
    try {
        const nf = new Flight({ ...req.body, sure: formatUcusSaati(req.body.sure) });
        await nf.save(); res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Sunucu aktif.`));