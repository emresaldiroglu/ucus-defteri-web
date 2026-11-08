/* Yönetim paneli - istemci kodu
   Kullanıcıdan gelen hiçbir metin innerHTML ile basılmaz; hepsi textContent ile yazılır. */
(function () {
    'use strict';

    var SATIR_LIMITI = 30;
    var TARIH_ALANLARI = [
        { alan: 'muayene1Tarih', etiket: '1 Yıllık Muayene' },
        { alan: 'muayene4Tarih', etiket: '4 Yıllık Muayene' },
        { alan: 'aletKartTarih', etiket: 'Alet Kart' },
        { alan: 'standTarih', etiket: 'Standardizasyon' }
    ];

    var durum = {
        liste: [], ozet: null, donem: null,
        detay: null, listeEski: true, tumUcuslar: false,
        ucusDuzenle: null, tarihAlan: null, silEmail: null
    };

    /* ---------- YARDIMCILAR ---------- */

    function $(id) { return document.getElementById(id); }

    function eleman(tag, sinif, metin) {
        var e = document.createElement(tag);
        if (sinif) e.className = sinif;
        if (metin !== undefined && metin !== null) e.textContent = metin;
        return e;
    }

    function dk(m) {
        m = Math.max(0, Math.round(m || 0));
        return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    }

    function sureDk(s) {
        if (!s || s.indexOf(':') === -1) return 0;
        var p = s.split(':').map(Number);
        return (p[0] || 0) * 60 + (p[1] || 0);
    }

    function trTarih(s) { return s ? String(s).split('-').reverse().join('.') : '-'; }

    function trZaman(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function tarihOnce(gun) {
        return new Date(Date.now() - gun * 24 * 3600 * 1000).toISOString().slice(0, 10);
    }

    function dugme(metin, sinif, eylem, ekstra) {
        var b = eleman('button', sinif, metin);
        b.type = 'button';
        b.dataset.eylem = eylem;
        if (ekstra) Object.keys(ekstra).forEach(function (k) { b.dataset[k] = ekstra[k]; });
        return b;
    }

    function hucre(tr, sinif, etiket, metin, tam) {
        var td = eleman('td', sinif + (tam ? ' tam' : ''), metin);
        if (etiket) td.dataset.etiket = etiket;
        tr.appendChild(td);
        return td;
    }

    /* ---------- BİLDİRİM VE ONAY ---------- */

    function bildir(mesaj, tur) {
        var alan = $('toastAlani');
        while (alan.children.length >= 3) alan.firstChild.remove(); // ekranı kaplamasın
        var t = eleman('div', 'toast ' + (tur || ''), mesaj);
        alan.appendChild(t);
        requestAnimationFrame(function () { t.classList.add('goster'); });
        setTimeout(function () {
            t.classList.remove('goster');
            setTimeout(function () { t.remove(); }, 300);
        }, 4000);
    }

    function modalAc(id) { $(id).classList.add('acik'); }
    function modalKapat(id) { $(id).classList.remove('acik'); }

    function onayIste(baslik, mesaj, evetMetni) {
        return new Promise(function (resolve) {
            var evet = $('onayEvet');
            var hayir = $('onayHayir');
            $('onayBaslik').textContent = baslik;
            $('onayMetin').textContent = mesaj;
            evet.textContent = evetMetni || 'Evet';
            modalAc('onayModal');
            function bitir(sonuc) {
                modalKapat('onayModal');
                evet.onclick = null;
                hayir.onclick = null;
                resolve(sonuc);
            }
            evet.onclick = function () { bitir(true); };
            hayir.onclick = function () { bitir(false); };
        });
    }

    /* ---------- API ---------- */

    async function api(url, yontem, govde) {
        try {
            var r = await fetch(url, {
                method: yontem || 'GET',
                headers: { 'Content-Type': 'application/json', 'X-Yonetim': '1' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: govde ? JSON.stringify(govde) : undefined
            });
            if (r.status === 404 || r.status === 401) {
                bildir('Yönetici oturumu bulunamadı, giriş sayfasına yönlendiriliyorsunuz...', 'hata');
                setTimeout(function () { location.href = '/'; }, 1500);
                return { success: false, oturumYok: true };
            }
            try { return await r.json(); }
            catch (e) { return { success: false, message: 'Sunucudan geçersiz yanıt alındı.' }; }
        } catch (e) {
            return { success: false, message: 'Ağ hatası oluştu, bağlantınızı kontrol edin.' };
        }
    }

    /* ---------- GÖRÜNÜM YÖNETİMİ ---------- */

    function gorunumGoster(ad) {
        $('gorunumListe').hidden = ad !== 'liste';
        $('gorunumDetay').hidden = ad !== 'detay';
        $('gorunumGunluk').hidden = ad !== 'gunluk';
        $('menuKullanicilar').classList.toggle('aktif', ad !== 'gunluk');
        $('menuGunluk').classList.toggle('aktif', ad === 'gunluk');
        window.scrollTo(0, 0);
    }

    function yonlendir() {
        var h = location.hash.replace(/^#/, '');
        if (h.indexOf('kullanici=') === 0) {
            var email = '';
            try { email = decodeURIComponent(h.slice('kullanici='.length)); } catch (e) { email = ''; }
            if (email) return detayAc(email);
        }
        if (h === 'gunluk') return gunlukAc();
        return listeAc();
    }

    /* ---------- KULLANICI LİSTESİ ---------- */

    async function listeAc() {
        gorunumGoster('liste');
        if (durum.listeEski) await listeyiYukle();
    }

    async function listeyiYukle() {
        var r = await api('/api/admin/kullanicilar');
        if (!r.success) {
            if (!r.oturumYok) bildir(r.message || 'Liste alınamadı.', 'hata');
            return;
        }
        durum.liste = r.kullanicilar;
        durum.ozet = r.ozet;
        durum.donem = r.donem;
        durum.listeEski = false;
        ozetCiz();
        listeCiz();
    }

    function ozetKarti(etiket, deger, alt) {
        var k = eleman('div', 'ozet-kart');
        k.appendChild(eleman('div', 'etiket', etiket));
        k.appendChild(eleman('div', 'deger', deger));
        if (alt) k.appendChild(eleman('div', 'alt', alt));
        return k;
    }

    function ozetCiz() {
        var o = durum.ozet;
        var kap = $('ozet');
        kap.textContent = '';
        kap.appendChild(ozetKarti('Kullanıcı', String(o.kullaniciSayisi)));
        kap.appendChild(ozetKarti('Bu ay yeni kayıt', String(o.buAyKayit)));
        kap.appendChild(ozetKarti('Aktif (30 gün)', String(o.aktif30), 'uçuş girenler'));
        kap.appendChild(ozetKarti('Toplam uçuş', String(o.ucusSayisi)));
        kap.appendChild(ozetKarti('Toplam saat', dk(o.toplamDakika)));
        kap.appendChild(ozetKarti(durum.donem.yil + ' dönemi', dk(o.donemDakika), 'tüm kullanıcılar'));
    }

    function listeyiHazirla() {
        var q = $('ara').value.trim().toLowerCase();
        var f = $('filtre').value;
        var s = $('sirala').value;
        var hedef = durum.donem.hedefDakika;
        var otuz = tarihOnce(30);

        var l = durum.liste.filter(function (u) {
            if (q && u.email.toLowerCase().indexOf(q) === -1) return false;
            if (f === 'dolan') return u.donemDakika >= hedef;
            if (f === 'pasif') return u.ucusSayisi > 0 && u.sonUcus < otuz;
            if (f === 'hic') return u.ucusSayisi === 0;
            return true;
        });

        var siralayicilar = {
            'kayit-yeni': function (a, b) { return (b.kayit || '').localeCompare(a.kayit || ''); },
            'kayit-eski': function (a, b) { return (a.kayit || '').localeCompare(b.kayit || ''); },
            'saat-cok': function (a, b) { return b.toplamDakika - a.toplamDakika; },
            'donem-cok': function (a, b) { return b.donemDakika - a.donemDakika; },
            'ucus-cok': function (a, b) { return b.ucusSayisi - a.ucusSayisi; },
            'son-ucus': function (a, b) { return (b.sonUcus || '').localeCompare(a.sonUcus || ''); },
            'eposta': function (a, b) { return a.email.localeCompare(b.email); }
        };
        l.sort(siralayicilar[s] || siralayicilar['kayit-yeni']);
        return l;
    }

    function kullaniciSatiri(u) {
        var hedef = durum.donem.hedefDakika;
        var tr = eleman('tr', 'k-satir');
        tr.dataset.eylem = 'kullanici-ac';
        tr.dataset.email = u.email;

        var eposta = hucre(tr, 'c-eposta', '', u.email, true);
        if (u.ucusSayisi === 0) eposta.appendChild(eleman('span', 'rozet gri', 'Uçuş yok'));
        else if (u.sonUcus < tarihOnce(30)) eposta.appendChild(eleman('span', 'rozet turuncu', 'Pasif'));
        if (u.donemDakika >= hedef) eposta.appendChild(eleman('span', 'rozet yesil', 'Dönem doldu'));

        hucre(tr, '', 'Kayıt', u.kayit ? trTarih(u.kayit.slice(0, 10)) : '-');
        hucre(tr, '', 'Uçuş', String(u.ucusSayisi));
        hucre(tr, 'c-sure', 'Toplam saat', dk(u.toplamDakika));
        var donem = hucre(tr, '', 'Dönem (kalan)', dk(u.donemDakika));
        donem.appendChild(eleman('span', 'kalan', u.donemDakika >= hedef ? '✓' : '(' + dk(hedef - u.donemDakika) + ')'));
        hucre(tr, '', 'Son uçuş', u.sonUcus ? trTarih(u.sonUcus) : '-');
        return tr;
    }

    function listeCiz() {
        if (!durum.donem) return; // liste henüz yüklenmediyse arama/filtre bir şey yapmaz
        var l = listeyiHazirla();
        var g = $('kullaniciGovde');
        g.textContent = '';
        l.forEach(function (u) { g.appendChild(kullaniciSatiri(u)); });
        $('bosListe').hidden = l.length > 0;
        $('sayacMetin').textContent = l.length + ' / ' + durum.liste.length + ' kullanıcı';
    }

    /* ---------- KULLANICI DETAYI ---------- */

    async function detayAc(email) {
        gorunumGoster('detay');
        var kap = $('detayIcerik');
        kap.textContent = '';
        kap.appendChild(eleman('div', 'bos', 'Yükleniyor...'));
        durum.tumUcuslar = false;

        var r = await api('/api/admin/kullanici?email=' + encodeURIComponent(email));
        if (!r.success) {
            if (!r.oturumYok) bildir(r.message || 'Kullanıcı açılamadı.', 'hata');
            location.hash = '';
            return;
        }
        durum.detay = r;
        detayCiz();
    }

    async function detayYenile() {
        durum.listeEski = true;
        var r = await api('/api/admin/kullanici?email=' + encodeURIComponent(durum.detay.kullanici.email));
        if (r.success) { durum.detay = r; detayCiz(); }
    }

    function cubukListesi(baslik, ogeler, enCok) {
        var kart = eleman('div', 'kart');
        kart.appendChild(eleman('h3', null, baslik));
        if (!ogeler.length) {
            kart.appendChild(eleman('div', 'bos', 'Veri yok'));
            return kart;
        }
        ogeler.forEach(function (o) {
            var satir = eleman('div', 'cubuk-satir');
            satir.appendChild(eleman('span', 'ad', o.ad));
            var zemin = eleman('div', 'cubuk-zemin');
            var dolgu = eleman('div', 'cubuk-dolgu');
            dolgu.style.width = (enCok > 0 ? Math.round(o.dakika / enCok * 100) : 0) + '%';
            zemin.appendChild(dolgu);
            satir.appendChild(zemin);
            satir.appendChild(eleman('span', 'sayi', dk(o.dakika)));
            kart.appendChild(satir);
        });
        return kart;
    }

    function detayCiz() {
        var d = durum.detay;
        var u = d.kullanici;
        var kap = $('detayIcerik');
        kap.textContent = '';

        var toplam = 0, donem = 0, arac = {}, ay = {};
        d.ucuslar.forEach(function (f) {
            var m = sureDk(f.sure);
            toplam += m;
            if (f.tarih >= d.donem.bas && f.tarih < d.donem.bit) donem += m;
            arac[f.havaAraciTipi] = (arac[f.havaAraciTipi] || 0) + m;
            var k = (f.tarih || '').slice(0, 7);
            ay[k] = (ay[k] || 0) + m;
        });

        // Üst kutu
        var ust = eleman('div', 'detay-ust');
        var geri = eleman('a', 'geri', '← Kullanıcılar');
        geri.href = '#';
        ust.appendChild(geri);
        ust.appendChild(eleman('h2', null, u.email));
        ust.appendChild(eleman('div', 'kayit', 'Kayıt: ' + (u.kayit ? trZaman(u.kayit) : '-')));
        var bg = eleman('div', 'buton-grubu');
        bg.appendChild(dugme('✈️ Uçuş ekle', 'btn btn-tamam', 'ucus-ekle'));
        bg.appendChild(dugme('🔑 Şifre sıfırla', 'btn btn-mavi', 'sifre-sifirla'));
        bg.appendChild(dugme('🗑️ Hesabı sil', 'btn btn-tehlike', 'kullanici-sil'));
        ust.appendChild(bg);
        kap.appendChild(ust);

        // Özet kartları
        var ozet = eleman('div', 'ozet-grid dort');
        ozet.appendChild(ozetKarti('Toplam saat', dk(toplam)));
        ozet.appendChild(ozetKarti(d.donem.yil + ' dönemi', dk(donem), donem >= d.donem.hedefDakika ? 'hedef doldu' : 'kalan ' + dk(d.donem.hedefDakika - donem)));
        ozet.appendChild(ozetKarti('Uçuş sayısı', String(d.ucuslar.length)));
        ozet.appendChild(ozetKarti('Son uçuş', d.ucuslar.length ? trTarih(d.ucuslar[0].tarih) : '-'));
        kap.appendChild(ozet);

        // Kayıtlı tarihler
        var tarihKart = eleman('div', 'kart');
        tarihKart.appendChild(eleman('h3', null, 'Kayıtlı tarihler'));
        var tg = eleman('div', 'tarih-grid');
        TARIH_ALANLARI.forEach(function (t) {
            var kayit = d.tarihler.filter(function (x) { return x.alan === t.alan; })[0];
            var satir = eleman('div', 'tarih-satir');
            var sol = eleman('div');
            sol.appendChild(eleman('div', 'ad', t.etiket));
            sol.appendChild(eleman('div', 'deger' + (kayit ? ' dolu' : ''), kayit ? trTarih(kayit.tarih) : 'Girilmemiş'));
            satir.appendChild(sol);
            var sag = eleman('div');
            sag.appendChild(dugme('Düzenle', 'btn btn-ikincil btn-kucuk', 'tarih-duzenle', { alan: t.alan }));
            if (kayit) {
                sag.appendChild(document.createTextNode(' '));
                sag.appendChild(dugme('Temizle', 'btn btn-ikincil btn-kucuk', 'tarih-temizle', { alan: t.alan }));
            }
            satir.appendChild(sag);
            tg.appendChild(satir);
        });
        tarihKart.appendChild(tg);
        kap.appendChild(tarihKart);

        // Dağılımlar
        var aracOgeleri = Object.keys(arac).map(function (a) { return { ad: a, dakika: arac[a] }; })
            .sort(function (x, y) { return y.dakika - x.dakika; });
        var aylar = [];
        var simdi = new Date();
        for (var i = 11; i >= 0; i--) {
            var t = new Date(simdi.getFullYear(), simdi.getMonth() - i, 1);
            var anahtar = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
            aylar.push({ ad: String(t.getMonth() + 1).padStart(2, '0') + '.' + String(t.getFullYear()).slice(2), dakika: ay[anahtar] || 0 });
        }
        var enCokArac = aracOgeleri.length ? aracOgeleri[0].dakika : 0;
        var enCokAy = Math.max.apply(null, aylar.map(function (x) { return x.dakika; }));
        var iki = eleman('div', 'iki-sutun');
        iki.style.marginTop = '12px';
        iki.appendChild(cubukListesi('Hava aracına göre saat', aracOgeleri, enCokArac));
        iki.appendChild(cubukListesi('Son 12 ay (aylık saat)', aylar, enCokAy));
        kap.appendChild(iki);

        // Uçuş listesi
        var baslik = eleman('h2', 'bolum-baslik', 'Uçuşlar (' + d.ucuslar.length + ')');
        kap.appendChild(baslik);
        var sarmal = eleman('div', 'tablo-sarmal');
        var tablo = eleman('table', 'tablo');
        var thead = eleman('thead');
        var htr = eleman('tr');
        ['Tarih', 'Hava Aracı', 'Eğitim', 'Süre', 'Görev Açıklaması', 'İşlem'].forEach(function (h) { htr.appendChild(eleman('th', null, h)); });
        thead.appendChild(htr);
        tablo.appendChild(thead);
        var tbody = eleman('tbody');
        var gorunen = durum.tumUcuslar ? d.ucuslar : d.ucuslar.slice(0, SATIR_LIMITI);
        gorunen.forEach(function (f) {
            var tr = eleman('tr');
            hucre(tr, '', 'Tarih', trTarih(f.tarih));
            hucre(tr, '', 'Araç', f.havaAraciTipi);
            hucre(tr, '', 'Eğitim', f.egitimTipi);
            hucre(tr, 'c-sure', 'Süre', f.sure);
            var ac = hucre(tr, 'c-aciklama', 'Açıklama', f.gorevAciklamasi || '-', true);
            ac.title = f.gorevAciklamasi || '';
            var islem = hucre(tr, 'c-islem', '', '', true);
            islem.appendChild(dugme('Düzenle', 'btn btn-ikincil btn-kucuk', 'ucus-duzenle', { id: f.id }));
            islem.appendChild(dugme('Sil', 'btn btn-tehlike btn-kucuk', 'ucus-sil', { id: f.id }));
            tbody.appendChild(tr);
        });
        tablo.appendChild(tbody);
        sarmal.appendChild(tablo);
        kap.appendChild(sarmal);
        if (!d.ucuslar.length) kap.appendChild(eleman('div', 'bos', 'Bu kullanıcının uçuş kaydı yok.'));
        if (!durum.tumUcuslar && d.ucuslar.length > SATIR_LIMITI) {
            kap.appendChild(dugme('Tümünü göster (' + d.ucuslar.length + ')', 'btn btn-ikincil daha-fazla', 'daha-fazla'));
        }
    }

    /* ---------- UÇUŞ EKLE / DÜZENLE ---------- */

    function secenekDoldur(select, degerler) {
        select.textContent = '';
        degerler.forEach(function (v) {
            var o = eleman('option', null, v);
            o.value = v;
            select.appendChild(o);
        });
    }

    function ucusModalAc(ucus) {
        var d = durum.detay;
        secenekDoldur($('ucArac'), d.araclar);
        secenekDoldur($('ucEgitim'), d.egitimTipleri);
        durum.ucusDuzenle = ucus ? ucus.id : null;
        $('ucusModalBaslik').textContent = ucus ? 'Uçuşu düzenle' : 'Uçuş ekle';
        $('ucTarih').value = ucus ? ucus.tarih : new Date().toISOString().slice(0, 10);
        if (ucus) {
            $('ucArac').value = ucus.havaAraciTipi;
            $('ucEgitim').value = ucus.egitimTipi;
        }
        $('ucSure').value = ucus ? ucus.sure : '';
        $('ucAciklama').value = ucus ? ucus.gorevAciklamasi : '';
        modalAc('ucusModal');
    }

    async function ucusKaydet(btn) {
        var veri = {
            tarih: $('ucTarih').value,
            havaAraciTipi: $('ucArac').value,
            egitimTipi: $('ucEgitim').value,
            sure: $('ucSure').value.trim(),
            gorevAciklamasi: $('ucAciklama').value
        };
        if (!veri.tarih || !veri.sure) return bildir('Tarih ve süre alanlarını doldurun.', 'hata');

        btn.disabled = true;
        var r;
        if (durum.ucusDuzenle) {
            veri.id = durum.ucusDuzenle;
            r = await api('/api/admin/ucus', 'PUT', veri);
        } else {
            veri.email = durum.detay.kullanici.email;
            r = await api('/api/admin/ucus', 'POST', veri);
        }
        btn.disabled = false;
        if (r.oturumYok) return;
        if (r.success) {
            modalKapat('ucusModal');
            bildir(durum.ucusDuzenle ? 'Uçuş güncellendi.' : 'Uçuş eklendi.', 'basari');
            await detayYenile();
        } else {
            bildir(r.message || 'İşlem başarısız.', 'hata');
        }
    }

    async function ucusSil(id) {
        var f = durum.detay.ucuslar.filter(function (x) { return x.id === id; })[0];
        if (!f) return;
        var ok = await onayIste('Uçuşu sil', trTarih(f.tarih) + ' · ' + f.havaAraciTipi + ' · ' + f.egitimTipi + ' · ' + f.sure + ' kaydı silinecek.', 'Sil');
        if (!ok) return;
        var r = await api('/api/admin/ucus', 'DELETE', { id: id });
        if (r.oturumYok) return;
        if (r.success) { bildir('Uçuş silindi.', 'basari'); await detayYenile(); }
        else bildir(r.message || 'Uçuş silinemedi.', 'hata');
    }

    /* ---------- KAYITLI TARİHLER ---------- */

    function tarihBilgisi(alan) {
        return TARIH_ALANLARI.filter(function (t) { return t.alan === alan; })[0];
    }

    function tarihModalAc(alan) {
        var kayit = durum.detay.tarihler.filter(function (x) { return x.alan === alan; })[0];
        durum.tarihAlan = alan;
        $('tarihModalBaslik').textContent = tarihBilgisi(alan).etiket;
        $('tarihDeger').value = kayit ? kayit.tarih : '';
        modalAc('tarihModal');
    }

    async function tarihKaydet(btn) {
        var tarih = $('tarihDeger').value;
        if (!tarih) return bildir('Bir tarih seçin. Kaydı kaldırmak için "Temizle" düğmesini kullanın.', 'hata');
        btn.disabled = true;
        var r = await api('/api/admin/tarih', 'POST', { email: durum.detay.kullanici.email, alan: durum.tarihAlan, tarih: tarih });
        btn.disabled = false;
        if (r.oturumYok) return;
        if (r.success) { modalKapat('tarihModal'); bildir('Tarih kaydedildi.', 'basari'); await detayYenile(); }
        else bildir(r.message || 'Tarih kaydedilemedi.', 'hata');
    }

    async function tarihTemizle(alan) {
        var ok = await onayIste('Tarihi temizle', tarihBilgisi(alan).etiket + ' kaydı kaldırılacak.', 'Temizle');
        if (!ok) return;
        var r = await api('/api/admin/tarih', 'POST', { email: durum.detay.kullanici.email, alan: alan, tarih: '' });
        if (r.oturumYok) return;
        if (r.success) { bildir('Tarih temizlendi.', 'basari'); await detayYenile(); }
        else bildir(r.message || 'İşlem başarısız.', 'hata');
    }

    /* ---------- ŞİFRE SIFIRLAMA ve HESAP SİLME ---------- */

    async function sifreSifirla() {
        var email = durum.detay.kullanici.email;
        var ok = await onayIste('Şifre sıfırla', email + ' için yeni bir geçici şifre oluşturulacak. Mevcut şifresi geçersiz olacak.', 'Sıfırla');
        if (!ok) return;
        var r = await api('/api/admin/sifre-sifirla', 'POST', { email: email });
        if (r.oturumYok) return;
        if (r.success) {
            $('sifreMetin').textContent = email;
            $('sifreDeger').value = r.sifre;
            modalAc('sifreModal');
        } else {
            bildir(r.message || 'Şifre sıfırlanamadı.', 'hata');
        }
    }

    function sifreKopyala() {
        var kutu = $('sifreDeger');
        kutu.focus();
        kutu.select();
        kutu.setSelectionRange(0, 999);
        var basari = function () { bildir('Kopyalandı.', 'basari'); };
        var yedek = function () {
            try { document.execCommand('copy') ? basari() : bildir('Kopyalanamadı, şifreyi elle seçip kopyalayın.', 'hata'); }
            catch (e) { bildir('Kopyalanamadı, şifreyi elle seçip kopyalayın.', 'hata'); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(kutu.value).then(basari, yedek);
        } else {
            yedek();
        }
    }

    function kullaniciSilAc() {
        var d = durum.detay;
        durum.silEmail = d.kullanici.email;
        $('silMetin').textContent = d.kullanici.email + ' hesabı, ' + d.ucuslar.length + ' uçuş kaydı ve kayıtlı tarihleriyle birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.';
        $('silOnay').value = '';
        $('silEvet').disabled = true;
        modalAc('silModal');
    }

    async function kullaniciSilOnayla(btn) {
        btn.disabled = true;
        var r = await api('/api/admin/kullanici', 'DELETE', { email: durum.silEmail, onay: $('silOnay').value });
        if (r.oturumYok) return;
        if (r.success) {
            modalKapat('silModal');
            bildir('Hesap silindi (' + (r.silinenUcus || 0) + ' uçuş kaydı ile birlikte).', 'basari');
            durum.listeEski = true;
            durum.detay = null;
            location.hash = ''; // hashchange olayı listeyi yeniden yükler
        } else {
            btn.disabled = false;
            bildir(r.message || 'Hesap silinemedi.', 'hata');
        }
    }

    /* ---------- İŞLEM GEÇMİŞİ ---------- */

    async function gunlukAc() {
        gorunumGoster('gunluk');
        var r = await api('/api/admin/gunluk');
        if (!r.success) {
            if (!r.oturumYok) bildir(r.message || 'Geçmiş alınamadı.', 'hata');
            return;
        }
        var g = $('gunlukGovde');
        g.textContent = '';
        r.kayitlar.forEach(function (k) {
            var tr = eleman('tr');
            hucre(tr, '', 'Zaman', trZaman(k.zaman));
            hucre(tr, '', 'Yönetici', k.admin || '-');
            hucre(tr, '', 'İşlem', k.islem || '-').style.fontWeight = 'bold';
            hucre(tr, 'c-eposta', 'Kullanıcı', k.hedef || '-');
            hucre(tr, '', 'Ayrıntı', k.detay || '-', true);
            g.appendChild(tr);
        });
        $('bosGunluk').hidden = r.kayitlar.length > 0;
    }

    /* ---------- OLAYLAR ---------- */

    document.addEventListener('click', function (e) {
        var arka = e.target;
        if (arka.classList && arka.classList.contains('modal-arka')) {
            if (arka.id === 'onayModal') return;
            arka.classList.remove('acik');
            return;
        }

        var h = e.target.closest('[data-eylem]');
        if (!h) return;
        var d = h.dataset;

        switch (d.eylem) {
            case 'kullanici-ac': location.hash = '#kullanici=' + encodeURIComponent(d.email); break;
            case 'ucus-ekle': ucusModalAc(null); break;
            case 'ucus-duzenle':
                ucusModalAc(durum.detay.ucuslar.filter(function (x) { return x.id === d.id; })[0]);
                break;
            case 'ucus-kaydet': ucusKaydet(h); break;
            case 'ucus-sil': ucusSil(d.id); break;
            case 'tarih-duzenle': tarihModalAc(d.alan); break;
            case 'tarih-kaydet': tarihKaydet(h); break;
            case 'tarih-temizle': tarihTemizle(d.alan); break;
            case 'sifre-sifirla': sifreSifirla(); break;
            case 'sifre-kopyala': sifreKopyala(); break;
            case 'kullanici-sil': kullaniciSilAc(); break;
            case 'kullanici-sil-onayla': kullaniciSilOnayla(h); break;
            case 'daha-fazla': durum.tumUcuslar = true; detayCiz(); break;
            case 'modal-kapat': modalKapat(d.modal); break;
        }
    });

    $('ara').addEventListener('input', listeCiz);
    $('filtre').addEventListener('change', listeCiz);
    $('sirala').addEventListener('change', listeCiz);

    // Hesap silme: e-posta aynen yazılmadan düğme açılmaz
    $('silOnay').addEventListener('input', function () {
        $('silEvet').disabled = $('silOnay').value.trim().toLowerCase() !== String(durum.silEmail || '').toLowerCase();
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('onayModal').classList.contains('acik')) { $('onayHayir').click(); return; }
        document.querySelectorAll('.modal-arka.acik').forEach(function (m) { m.classList.remove('acik'); });
    });

    window.addEventListener('hashchange', yonlendir);
    yonlendir();
})();
