/* Uçuş Takip Paneli - istemci kodu
   Tüm kullanıcı verisi textContent / dataset ile işlenir (innerHTML ile veri basılmaz). */
(function () {
    'use strict';

    var SATIR_BASINA_VERI = 10;
    var mevcutSayfa = 1;
    var panelVeri = { aracBazli: { ggg: {}, sonUcus: {} }, donemUcuslari: [] };

    function $(id) { return document.getElementById(id); }

    function eleman(tag, sinif, metin) {
        var e = document.createElement(tag);
        if (sinif) e.className = sinif;
        if (metin !== undefined) e.textContent = metin;
        return e;
    }

    function veriyiOku() {
        try {
            panelVeri = JSON.parse($('panelVeri').textContent);
        } catch (e) { /* mevcut veri korunur */ }
    }

    function trTarih(s) {
        return s ? String(s).split('-').reverse().join('.') : '-';
    }

    function sureDakika(s) {
        if (!s || s.indexOf(':') === -1) return 0;
        var p = s.split(':').map(Number);
        return (p[0] || 0) * 60 + (p[1] || 0);
    }

    function guvenliRenk(renk, varsayilan) {
        return /^#[0-9a-f]{6}$/i.test(renk || '') ? renk : varsayilan;
    }

    /* ---------- BİLDİRİM VE ONAY ---------- */

    function bildir(mesaj, tur) {
        var alan = $('toastAlani');
        var t = eleman('div', 'toast ' + (tur || ''), mesaj);
        alan.appendChild(t);
        requestAnimationFrame(function () { t.classList.add('goster'); });
        setTimeout(function () {
            t.classList.remove('goster');
            setTimeout(function () { t.remove(); }, 300);
        }, 3500);
    }

    function onayIste(mesaj) {
        return new Promise(function (resolve) {
            var modal = $('onayModal');
            var evet = $('onayEvet');
            var hayir = $('onayHayir');
            $('onayMetin').textContent = mesaj;
            modal.classList.add('acik');
            function bitir(sonuc) {
                modal.classList.remove('acik');
                evet.onclick = null;
                hayir.onclick = null;
                resolve(sonuc);
            }
            evet.onclick = function () { bitir(true); };
            hayir.onclick = function () { bitir(false); };
        });
    }

    /* ---------- API ---------- */

    async function apiCagir(url, yontem, govde) {
        try {
            var r = await fetch(url, {
                method: yontem,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(govde)
            });
            if (r.status === 401) {
                bildir('Oturum süresi doldu, giriş sayfasına yönlendiriliyorsunuz...', 'hata');
                setTimeout(function () { location.href = '/'; }, 1500);
                return { success: false, oturumYok: true };
            }
            try {
                return await r.json();
            } catch (e) {
                return { success: false, message: 'Sunucudan geçersiz yanıt alındı.' };
            }
        } catch (e) {
            return { success: false, message: 'Ağ hatası oluştu, bağlantınızı kontrol edin.' };
        }
    }

    // Sayfayı yenilemeden paneli sunucudan tekrar çekip değiştirir
    async function paneliYenile() {
        try {
            var r = await fetch('/login', { credentials: 'same-origin', cache: 'no-store' });
            var html = await r.text();
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var yeni = doc.getElementById('uygulama');
            var yeniVeri = doc.getElementById('panelVeri');
            if (!yeni || !yeniVeri) { location.href = '/'; return; }
            $('uygulama').innerHTML = yeni.innerHTML;
            $('panelVeri').textContent = yeniVeri.textContent;
            veriyiOku();
            tekerlekleriKur();
            mevcutSayfa = 1;
            filtreleUcuslari();
        } catch (e) {
            bildir('Panel yenilenemedi, sayfayı elle yenileyin.', 'hata');
        }
    }

    /* ---------- MODALLAR ---------- */

    function modalAc(id) { $(id).classList.add('acik'); }
    function modalKapat(id) { $(id).classList.remove('acik'); }

    function donemModalAc() {
        var kap = $('donemUcuslariIcerik');
        kap.textContent = '';
        if (!panelVeri.donemUcuslari.length) {
            kap.appendChild(eleman('div', 'bos-mesaj', 'Bu dönemde uçuş kaydı bulunmamaktadır.'));
        } else {
            panelVeri.donemUcuslari.forEach(function (f) {
                var tema = f.egitimTipi === 'ggg' ? ' tema-ay' : (f.egitimTipi === 'gş' ? ' tema-gunes' : '');
                var ikon = f.egitimTipi === 'ggg' ? '🌙 ' : (f.egitimTipi === 'gş' ? '☀️ ' : '');
                var satir = eleman('div', 'liste-satir' + tema);
                var sol = document.createElement('div');
                sol.appendChild(eleman('strong', 'liste-tarih', trTarih(f.tarih)));
                sol.appendChild(eleman('span', 'liste-alt',
                    ikon + (f.havaAraciTipi || '').toUpperCase() + ' (' + (f.egitimTipi || '').toUpperCase() + ')'));
                satir.appendChild(sol);
                satir.appendChild(eleman('div', 'rozet', f.sure || ''));
                kap.appendChild(satir);
            });
        }
        modalAc('donemUcuslariModal');
    }

    function sayacModalAc(tip) {
        var kap = $('sayacModalIcerik');
        kap.textContent = '';
        var veriSeti = tip === 'ggg' ? panelVeri.aracBazli.ggg : panelVeri.aracBazli.sonUcus;
        $('sayacModalBaslik').textContent = tip === 'ggg'
            ? '🚁 Hava Araçları GGG Durumları'
            : '🚁 Hava Araçları Son Uçuş Durumları';

        Object.keys(veriSeti).forEach(function (arac) {
            var bilgi = veriSeti[arac];
            var satir = eleman('div', 'liste-satir');
            if (bilgi.yok) {
                satir.appendChild(eleman('strong', 'liste-tarih', arac.toUpperCase()));
                satir.appendChild(eleman('span', 'liste-yok', 'Uçuş yapılmamış'));
            } else {
                var sol = document.createElement('div');
                sol.appendChild(eleman('strong', 'liste-tarih', arac.toUpperCase()));
                if (bilgi.tip) sol.appendChild(document.createTextNode(' (' + bilgi.tip + ')'));
                sol.appendChild(document.createElement('br'));
                sol.appendChild(eleman('span', 'liste-ince', 'Son Tarih: ' + bilgi.tarih));
                satir.appendChild(sol);
                var rozet = eleman('div', 'rozet', bilgi.kalanGunStr);
                rozet.style.background = guvenliRenk(bilgi.renk, '#3498db');
                satir.appendChild(rozet);
            }
            kap.appendChild(satir);
        });
        modalAc('detayliSayacModal');
    }

    function sifreModalAc() {
        ['eskiSifre', 'yeniSifre1', 'yeniSifre2'].forEach(function (id) { $(id).value = ''; });
        modalAc('sifreModal');
    }

    function sureModalAc() {
        var alan = $('sureAlani');
        modalAc('sureModal');
        // Pencere görünür olduktan sonra tekerlekler mevcut değere kaydırılır
        tekerlekGit($('sureSaat'), parseInt(alan.dataset.saat || '0', 10), false);
        tekerlekGit($('sureDakika'), parseInt(alan.dataset.dakika || '0', 10), false);
    }

    function sureTamam() {
        var saat = String($('sureSaat').dataset.deger || '0').padStart(2, '0');
        var dakika = String($('sureDakika').dataset.deger || '0').padStart(2, '0');
        if (saat === '00' && dakika === '00') {
            return bildir('Lütfen uçuş süresini seçin.', 'hata');
        }
        var alan = $('sureAlani');
        alan.dataset.saat = saat;
        alan.dataset.dakika = dakika;
        var metin = $('sureAlaniMetin');
        metin.textContent = saat + ' saat ' + dakika + ' dk';
        metin.classList.remove('yer-tutucu');
        modalKapat('sureModal');
    }

    function tarihModalAc(etiket, alan, hamTarih) {
        $('modalBaslik').textContent = etiket + ' Başlangıç Tarihi';
        $('hedefAlan').value = alan;
        var dogru = /^\d{4}-\d{2}-\d{2}$/.test(hamTarih || '');
        $('modalMevcutTarihText').textContent = dogru ? trTarih(hamTarih) : 'Girilmedi';
        $('yeniKategoriTarih').value = dogru ? hamTarih : '';
        modalAc('tarihModal');
    }

    /* ---------- İŞLEMLER ---------- */

    async function sifreyiGuncelle(dugme) {
        var eski = $('eskiSifre').value;
        var yeni1 = $('yeniSifre1').value;
        var yeni2 = $('yeniSifre2').value;

        if (!eski || !yeni1 || !yeni2) return bildir('Lütfen tüm alanları doldurun.', 'hata');
        if (yeni1 !== yeni2) return bildir('Yeni şifreler birbiriyle uyuşmuyor!', 'hata');
        if (yeni1.length < 8) return bildir('Yeni şifre en az 8 karakter olmalıdır.', 'hata');
        if (!/[A-Z]/.test(yeni1)) return bildir('Yeni şifre en az 1 büyük harf içermelidir.', 'hata');
        if (!/[0-9]/.test(yeni1)) return bildir('Yeni şifre en az 1 rakam içermelidir.', 'hata');

        dugme.disabled = true;
        var sonuc = await apiCagir('/api/update-password', 'POST', { eskiSifre: eski, yeniSifre: yeni1 });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            modalKapat('sifreModal');
            bildir('Şifreniz başarıyla güncellendi.', 'basari');
        } else {
            bildir(sonuc.message || 'Mevcut şifre hatalı.', 'hata');
        }
    }

    async function kaydetKategoriTarihi(dugme) {
        var alan = $('hedefAlan').value;
        var tarih = $('yeniKategoriTarih').value;
        if (!tarih) return bildir('Lütfen tarih seçin.', 'hata');

        dugme.disabled = true;
        var sonuc = await apiCagir('/api/update-user-date', 'POST', { alan: alan, tarih: tarih });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            modalKapat('tarihModal');
            bildir('Tarih kaydedildi.', 'basari');
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Tarih kaydedilemedi.', 'hata');
        }
    }

    async function kaydetYeniUcus(dugme) {
        var tarih = $('tarih').value;
        var havaAraciTipi = $('havaAraciTipi').value;
        var egitimTipi = $('egitimTipi').value;
        var sureSaat = $('sureAlani').dataset.saat || '00';
        var sureDakika = $('sureAlani').dataset.dakika || '00';
        var sure = sureSaat + ':' + sureDakika;
        var gorevAciklamasi = $('gorevAciklamasi').value;

        if (!tarih || !egitimTipi) {
            return bildir('Lütfen Tarih ve Eğitim Sınıflandırması alanlarını doldurun.', 'hata');
        }
        if (sureSaat === '00' && sureDakika === '00') {
            return bildir('Lütfen uçuş süresini seçin.', 'hata');
        }
        if (!(await onayIste('Yeni uçuş kaydını eklemek istiyor musunuz?'))) return;

        dugme.disabled = true;
        var sonuc = await apiCagir('/api/add-flight', 'POST', {
            tarih: tarih,
            havaAraciTipi: havaAraciTipi,
            egitimTipi: egitimTipi,
            sure: sure,
            gorevAciklamasi: gorevAciklamasi
        });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            bildir('Uçuş kaydı eklendi.', 'basari');
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Uçuş kaydedilirken bir hata oluştu.', 'hata');
        }
    }

    async function silUcus(id) {
        if (!(await onayIste('Bu uçuş kaydını silmek istediğinize emin misiniz?'))) return;
        var sonuc = await apiCagir('/api/delete-flight', 'DELETE', { id: id });
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            bildir('Uçuş kaydı silindi.', 'basari');
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Kayıt silinemedi.', 'hata');
        }
    }

    /* ---------- KAYDIRMALI SÜRE SEÇİCİ ---------- */

    var OGE_YUKSEKLIK = 44;

    function tekerlekIsaretle(el, i) {
        if (el.dataset.deger === String(i) && el.querySelector('.secili')) return;
        var eski = el.querySelector('.secili');
        if (eski) eski.classList.remove('secili');
        var yeni = el.querySelectorAll('.tekerlek-oge')[i];
        if (yeni) yeni.classList.add('secili');
        el.dataset.deger = String(i);
    }

    function tekerlekGit(el, i, yumusak) {
        var max = parseInt(el.dataset.max, 10);
        i = Math.max(0, Math.min(max, i));
        el.scrollTo({ top: i * OGE_YUKSEKLIK, behavior: yumusak ? 'smooth' : 'auto' });
        tekerlekIsaretle(el, i);
    }

    function tekerlekKur(el) {
        var max = parseInt(el.dataset.max, 10);
        el.textContent = '';
        el.appendChild(eleman('div', 'tekerlek-bosluk'));
        for (var i = 0; i <= max; i++) {
            var oge = eleman('div', 'tekerlek-oge', String(i).padStart(2, '0'));
            oge.dataset.index = String(i);
            el.appendChild(oge);
        }
        el.appendChild(eleman('div', 'tekerlek-bosluk'));
        tekerlekIsaretle(el, 0);

        el.addEventListener('scroll', function () {
            var i = Math.round(el.scrollTop / OGE_YUKSEKLIK);
            tekerlekIsaretle(el, Math.max(0, Math.min(max, i)));
        }, { passive: true });

        el.addEventListener('click', function (e) {
            var oge = e.target.closest('.tekerlek-oge');
            if (oge) tekerlekGit(el, parseInt(oge.dataset.index, 10), true);
        });

        el.addEventListener('keydown', function (e) {
            var simdiki = parseInt(el.dataset.deger || '0', 10);
            if (e.key === 'ArrowUp') { e.preventDefault(); tekerlekGit(el, simdiki - 1, true); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); tekerlekGit(el, simdiki + 1, true); }
        });
    }

    function tekerlekleriKur() {
        document.querySelectorAll('.tekerlek').forEach(tekerlekKur);
    }

    /* ---------- LİSTE: AKORDEON, DETAY, FİLTRE, SAYFALAMA ---------- */

    function akordeonAcKapat(icerikId, okId, dugme) {
        var icerik = $(icerikId);
        var acildi = icerik.classList.toggle('acik');
        $(okId).textContent = acildi ? '▲' : '▼';
        if (dugme) dugme.setAttribute('aria-expanded', acildi ? 'true' : 'false');
    }

    function detayKapat(id) {
        var d = $('detay-' + id);
        if (d) d.classList.remove('acik');
    }

    function detayAcKapat(id) {
        var d = $('detay-' + id);
        if (d) d.classList.toggle('acik');
    }

    function filtreleUcuslari() {
        var yil = $('filtreYil').value;
        var ay = $('filtreAy').value;
        var hava = $('filtreHavaAraci').value;
        var egitim = $('filtreUcusTipi').value;
        var filtreAktif = !!(yil || ay || hava || egitim);

        // Dönem: (yıl-1)-09-01 dahil, yıl-09-01 hariç. YYYY-MM-DD metinleri doğrudan karşılaştırılabilir.
        var baslangic = null, bitis = null;
        if (yil) {
            var y = parseInt(yil, 10);
            baslangic = (y - 1) + '-09-01';
            bitis = y + '-09-01';
        }

        var toplamDakika = 0;
        var gorunur = [];

        document.querySelectorAll('.ucus-satiri').forEach(function (satir) {
            var t = satir.dataset.tarih || '';
            var uygun = true;
            if (yil && !(t >= baslangic && t < bitis)) uygun = false;
            if (ay && t.split('-')[1] !== ay) uygun = false;
            if (egitim && satir.dataset.egitim !== egitim) uygun = false;
            if (hava && satir.dataset.hava !== hava) uygun = false;

            if (uygun) {
                gorunur.push(satir);
                toplamDakika += sureDakika(satir.dataset.sure);
            } else {
                satir.style.display = 'none';
                detayKapat(satir.dataset.id);
            }
        });

        var kutu = $('filtreSaatKutusu');
        if (filtreAktif) {
            var s = String(Math.floor(toplamDakika / 60)).padStart(2, '0');
            var d = String(toplamDakika % 60).padStart(2, '0');
            $('filtreliSaatGosterge').textContent = s + ':' + d;
            kutu.hidden = false;
        } else {
            kutu.hidden = true;
        }

        sayfalamayiCiz(gorunur);
    }

    function sayfalamayiCiz(aktifSatirlar) {
        var toplamSayfa = Math.ceil(aktifSatirlar.length / SATIR_BASINA_VERI) || 1;
        if (mevcutSayfa > toplamSayfa) mevcutSayfa = toplamSayfa;

        aktifSatirlar.forEach(function (satir, index) {
            var bas = (mevcutSayfa - 1) * SATIR_BASINA_VERI;
            var son = mevcutSayfa * SATIR_BASINA_VERI;
            if (index >= bas && index < son) {
                satir.style.display = '';
            } else {
                satir.style.display = 'none';
                detayKapat(satir.dataset.id);
            }
        });

        $('bosMesaj').hidden = aktifSatirlar.length > 0;

        var kutu = $('sayfalamaAlani');
        kutu.textContent = '';
        if (toplamSayfa > 1) {
            for (var i = 1; i <= toplamSayfa; i++) {
                var btn = eleman('button', 'sayfa-btn' + (i === mevcutSayfa ? ' aktif' : ''), String(i));
                btn.type = 'button';
                btn.dataset.eylem = 'sayfa';
                btn.dataset.sayfa = String(i);
                kutu.appendChild(btn);
            }
        }
    }

    function filtreleriTemizle() {
        ['filtreYil', 'filtreAy', 'filtreHavaAraci', 'filtreUcusTipi'].forEach(function (id) { $(id).value = ''; });
        mevcutSayfa = 1;
        filtreleUcuslari();
    }

    /* ---------- OLAY YÖNETİMİ (sayfa yenilense de çalışır) ---------- */

    document.addEventListener('click', function (e) {
        // Karartılmış arka plana tıklayınca modal kapanır (onay penceresi hariç)
        if (e.target.classList && e.target.classList.contains('modal-arka') && e.target.id !== 'onayModal') {
            e.target.classList.remove('acik');
            return;
        }

        var hedef = e.target.closest('[data-eylem]');
        if (!hedef) return;
        var d = hedef.dataset;

        switch (d.eylem) {
            case 'akordeon': akordeonAcKapat(d.icerik, d.ok, hedef); break;
            case 'detay': detayAcKapat(d.id); break;
            case 'ucus-sil': silUcus(d.id); break;
            case 'ucus-ekle': kaydetYeniUcus(hedef); break;
            case 'donem-modal': donemModalAc(); break;
            case 'sayac-modal': sayacModalAc(d.tip); break;
            case 'sifre-modal': sifreModalAc(); break;
            case 'sure-modal': sureModalAc(); break;
            case 'sure-tamam': sureTamam(); break;
            case 'sifre-guncelle': sifreyiGuncelle(hedef); break;
            case 'tarih-modal': tarihModalAc(d.etiket, d.alan, d.tarih); break;
            case 'tarih-kaydet': kaydetKategoriTarihi(hedef); break;
            case 'modal-kapat': modalKapat(d.modal); break;
            case 'filtre-uygula': mevcutSayfa = 1; filtreleUcuslari(); break;
            case 'filtre-temizle': filtreleriTemizle(); break;
            case 'sayfa': mevcutSayfa = parseInt(d.sayfa, 10) || 1; filtreleUcuslari(); break;
        }
    });

    // Enter tuşu formu göndermesin; uçuş formunda kaydet düğmesi gibi davransın
    document.addEventListener('submit', function (e) {
        e.preventDefault();
        if (e.target.id === 'ucusFormu') {
            var btn = $('btnUcusEkle');
            if (btn) btn.click();
        }
    });

    // ESC: açık pencereyi kapat
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var onay = $('onayModal');
        if (onay.classList.contains('acik')) { $('onayHayir').click(); return; }
        document.querySelectorAll('.modal-arka.acik').forEach(function (m) { m.classList.remove('acik'); });
    });

    veriyiOku();
    tekerlekleriKur();
    filtreleUcuslari();
})();
