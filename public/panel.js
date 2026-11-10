/* Uçuş Takip Paneli - istemci kodu
   Tüm kullanıcı verisi textContent / dataset ile işlenir (innerHTML ile veri basılmaz). */
(function () {
    'use strict';

    var SATIR_BASINA_VERI = 10;
    var mevcutSayfa = 1;
    var panelVeri = { aracBazli: { ggg: {}, sonUcus: {} }, donemUcuslari: [] };
    var sureHedef = { alan: 'sureAlani', metin: 'sureAlaniMetin' };
    var sonFiltreli = [];
    var sonFiltreOzet = '';

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

    // eylem: { etiket, islem } verilirse bildirimde bir düğme (ör. "Geri al") görünür
    function bildir(mesaj, tur, eylem) {
        var alan = $('toastAlani');
        var t = eleman('div', 'toast ' + (tur || '') + (eylem ? ' eylemli' : ''));
        t.appendChild(eleman('span', '', mesaj));
        var kapat = function () {
            t.classList.remove('goster');
            setTimeout(function () { t.remove(); }, 300);
        };
        if (eylem) {
            var d = eleman('button', 'toast-eylem', eylem.etiket);
            d.type = 'button';
            d.onclick = function () { kapat(); eylem.islem(); };
            t.appendChild(d);
        }
        alan.appendChild(t);
        requestAnimationFrame(function () { t.classList.add('goster'); });
        setTimeout(kapat, eylem ? 7000 : 3500);
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
            var secenek = { method: yontem, credentials: 'same-origin', cache: 'no-store' };
            if (govde !== undefined) {
                secenek.headers = { 'Content-Type': 'application/json' };
                secenek.body = JSON.stringify(govde);
            }
            var r = await fetch(url, secenek);
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
            sonKopyaGuncelle();
            sablonlariCiz();
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

    /* ---------- PROFİL ve ŞİFRE ---------- */

    function profilSekme(sekme) {
        var sifre = sekme === 'sifre';
        $('profilBilgi').hidden = sifre;
        $('profilSifre').hidden = !sifre;
        document.querySelectorAll('#profilModal .sekme').forEach(function (b) {
            b.classList.toggle('aktif', b.dataset.sekme === (sifre ? 'sifre' : 'bilgi'));
        });
    }

    function profilHesapla() {
        var kutu = $('profilHesap');
        if (!kutu) return;
        var parcalar = [];
        var boy = parseFloat($('profilBoy').value);
        var kilo = parseFloat(String($('profilKilo').value).replace(',', '.'));
        if (boy >= 100 && boy <= 250 && kilo >= 30 && kilo <= 300) {
            var vki = kilo / Math.pow(boy / 100, 2);
            parcalar.push('VKİ: ' + (Math.round(vki * 10) / 10).toString().replace('.', ','));
        }
        var dogum = $('profilDogum').value;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dogum)) {
            var d = new Date(dogum), t = new Date();
            var yas = t.getFullYear() - d.getFullYear();
            if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) yas--;
            if (yas >= 0 && yas < 120) parcalar.push('Yaş: ' + yas);
        }
        kutu.textContent = parcalar.join('  ·  ');
        kutu.hidden = !parcalar.length;
    }

    function profilModalAc(sekme) {
        ['eskiSifre', 'yeniSifre1', 'yeniSifre2'].forEach(function (id) { $(id).value = ''; });
        profilSekme(sekme || 'bilgi');
        profilHesapla();
        modalAc('profilModal');
    }

    async function profilKaydet(dugme) {
        dugme.disabled = true;
        var sonuc = await apiCagir('/api/update-profile', 'POST', {
            adSoyad: $('profilAd').value,
            boy: $('profilBoy').value,
            kilo: $('profilKilo').value,
            dogumTarihi: $('profilDogum').value,
            kanGrubu: $('profilKan').value,
            donemHedefSaat: $('profilHedef').value
        });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            modalKapat('profilModal');
            bildir('Profil bilgileri kaydedildi.', 'basari');
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Profil kaydedilemedi.', 'hata');
        }
    }

    function sureModalAc(hedefId, metinId) {
        sureHedef = { alan: hedefId || 'sureAlani', metin: metinId || 'sureAlaniMetin' };
        var alan = $(sureHedef.alan);
        modalAc('sureModal');
        // Pencere görünür olduktan sonra tekerlekler mevcut değere kaydırılır
        tekerlekGit($('sureSaat'), parseInt(alan.dataset.saat || '0', 10), false);
        tekerlekGit($('sureDakika'), parseInt(alan.dataset.dakika || '0', 10), false);
    }

    function sureyiYaz(alan, metin, saat, dakika) {
        alan.dataset.saat = saat;
        alan.dataset.dakika = dakika;
        metin.textContent = saat + ' saat ' + dakika + ' dk';
        metin.classList.remove('yer-tutucu');
    }

    function sureTamam() {
        var saat = String($('sureSaat').dataset.deger || '0').padStart(2, '0');
        var dakika = String($('sureDakika').dataset.deger || '0').padStart(2, '0');
        if (saat === '00' && dakika === '00') {
            return bildir('Lütfen uçuş süresini seçin.', 'hata');
        }
        sureyiYaz($(sureHedef.alan), $(sureHedef.metin), saat, dakika);
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
            modalKapat('profilModal');
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

    /* ---------- 24 SAATİ AŞAN TOPLU SÜRE ---------- */

    function topluAlanlar(onek) {
        var duz = onek === 'duz';
        return {
            kutu: $(duz ? 'duzTopluKutu' : 'topluKutu'),
            giris: $(duz ? 'duzTopluGiris' : 'topluGiris'),
            saat: $(duz ? 'duzTopluSaat' : 'topluSaat'),
            dakika: $(duz ? 'duzTopluDakika' : 'topluDakika'),
            alan: $(duz ? 'duzSureAlani' : 'sureAlani')
        };
    }

    function topluDegis(onek) {
        var a = topluAlanlar(onek || '');
        if (!a.kutu) return;
        var ac = a.kutu.checked;
        a.giris.hidden = !ac;
        a.alan.hidden = ac;
        if (ac) a.saat.focus();
    }

    function topluUygula(onek, saat, dakika) {
        var a = topluAlanlar(onek || '');
        if (!a.kutu) return;
        a.kutu.checked = true;
        a.saat.value = String(parseInt(saat, 10) || 0);
        a.dakika.value = String(parseInt(dakika, 10) || 0);
        topluDegis(onek);
    }

    function topluKapat(onek) {
        var a = topluAlanlar(onek || '');
        if (!a.kutu) return;
        a.kutu.checked = false;
        a.saat.value = '';
        a.dakika.value = '';
        topluDegis(onek);
    }

    // Formdaki süreyi okur: tekerlek ya da (kutucuk işaretliyse) saat/dakika kutuları
    function sureyiOku(onek) {
        var a = topluAlanlar(onek || '');
        if (a.kutu && a.kutu.checked) {
            var s = parseInt(a.saat.value || '0', 10);
            var dk = parseInt(a.dakika.value || '0', 10);
            if (isNaN(s) || isNaN(dk) || s < 0 || dk < 0 || dk > 59) {
                return { hata: 'Dakika 0-59 arasında olmalı; saat ve dakika sayı olmalı.' };
            }
            if (s > 1000 || (s === 1000 && dk > 0)) return { hata: 'Toplu süre 1000 saatten uzun olamaz.' };
            if (s === 0 && dk === 0) return { hata: 'Lütfen toplu süreyi girin.' };
            return { sure: String(s).padStart(2, '0') + ':' + String(dk).padStart(2, '0'), toplu: true };
        }
        var saat = a.alan.dataset.saat || '00';
        var dakika = a.alan.dataset.dakika || '00';
        if (saat === '00' && dakika === '00') return { hata: 'Lütfen uçuş süresini seçin.' };
        return { sure: saat + ':' + dakika, toplu: false };
    }

    // Kayıtlı süreyi forma yazar; 23 saati aşıyorsa toplu kutularını kullanır
    function sureyiFormaYaz(onek, sureMetni, toplu) {
        var p = String(sureMetni || '00:00').split(':');
        var saat = parseInt(p[0], 10) || 0;
        var dakika = parseInt(p[1], 10) || 0;
        var a = topluAlanlar(onek || '');
        if (toplu || saat > 23) {
            topluUygula(onek, saat, dakika);
        } else {
            topluKapat(onek);
            var metinId = onek === 'duz' ? 'duzSureMetin' : 'sureAlaniMetin';
            sureyiYaz(a.alan, $(metinId), String(saat).padStart(2, '0'), String(dakika).padStart(2, '0'));
        }
    }

    async function kaydetYeniUcus(dugme) {
        var tarih = $('tarih').value;
        var havaAraciTipi = $('havaAraciTipi').value;
        var egitimTipi = $('egitimTipi').value;
        var gorevAciklamasi = $('gorevAciklamasi').value;

        if (!tarih || !egitimTipi) {
            return bildir('Lütfen Tarih ve Eğitim Sınıflandırması alanlarını doldurun.', 'hata');
        }
        var su = sureyiOku('');
        if (su.hata) return bildir(su.hata, 'hata');
        var sure = su.sure;
        if (!(await onayIste('Yeni uçuş kaydını eklemek istiyor musunuz?'))) return;

        dugme.disabled = true;
        var sonuc = await apiCagir('/api/add-flight', 'POST', {
            tarih: tarih,
            havaAraciTipi: havaAraciTipi,
            egitimTipi: egitimTipi,
            sure: sure,
            toplu: su.toplu,
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
            if (sonuc.cop) {
                bildir('Uçuş silindi.', 'basari', { etiket: 'Geri al', islem: function () { copGeriAl(sonuc.cop); } });
            } else {
                bildir('Uçuş kaydı silindi.', 'basari');
            }
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Kayıt silinemedi.', 'hata');
        }
    }


    /* ---------- UÇUŞ DÜZENLEME ---------- */

    function duzenleModalAc(id) {
        var satir = $('row-' + id);
        if (!satir) return;
        var d = satir.dataset;
        $('duzId').value = id;
        $('duzTarih').value = d.tarih || '';
        $('duzArac').value = d.hava || '';
        $('duzEgitim').value = d.egitim || '';
        $('duzAciklama').value = d.aciklama || '';
        sureyiFormaYaz('duz', d.sure, d.toplu === '1');
        modalAc('duzenleModal');
    }

    async function duzenleKaydet(dugme) {
        if (!$('duzTarih').value) return bildir('Lütfen tarih seçin.', 'hata');
        var su = sureyiOku('duz');
        if (su.hata) return bildir(su.hata, 'hata');

        dugme.disabled = true;
        var sonuc = await apiCagir('/api/update-flight', 'POST', {
            id: $('duzId').value,
            tarih: $('duzTarih').value,
            havaAraciTipi: $('duzArac').value,
            egitimTipi: $('duzEgitim').value,
            sure: su.sure,
            toplu: su.toplu,
            gorevAciklamasi: $('duzAciklama').value
        });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            modalKapat('duzenleModal');
            bildir('Uçuş güncellendi.', 'basari');
            await paneliYenile();
        } else {
            bildir(sonuc.message || 'Uçuş güncellenemedi.', 'hata');
        }
    }

    /* ---------- SON UÇUŞU KOPYALA ---------- */

    function sonUcusSatiri() {
        return document.querySelector('.ucus-satiri');
    }

    function sonKopyaGuncelle() {
        var btn = $('sonKopyaBtn');
        if (!btn) return;
        var satir = sonUcusSatiri();
        if (!satir) { btn.hidden = true; return; }
        var d = satir.dataset;
        $('sonKopyaOzet').textContent = (d.hava || '').toUpperCase() + ' · ' + (d.egitim || '').toUpperCase() + ' · ' + (d.sure || '');
        btn.hidden = false;
    }

    function sonUcusuKopyala() {
        var satir = sonUcusSatiri();
        if (!satir) return;
        var d = satir.dataset;
        $('havaAraciTipi').value = d.hava || $('havaAraciTipi').value;
        $('egitimTipi').value = d.egitim || '';
        $('gorevAciklamasi').value = d.aciklama || '';
        sureyiFormaYaz('', d.sure, d.toplu === '1');
        bildir('Son uçuş bilgileri forma kopyalandı. Tarihi ve süreyi kontrol edin.', 'basari');
    }

    /* ---------- DIŞA AKTARMA: CSV ve PDF ---------- */

    function bugunDamga() {
        var t = new Date();
        return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }

    // Excel'de formül olarak çalışmasın diye tehlikeli başlangıçlar etkisizleştirilir
    function csvHucre(v) {
        v = String(v === undefined || v === null ? '' : v);
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return '"' + v.replace(/"/g, '""') + '"';
    }

    function satirVerisi(satir) {
        var d = satir.dataset;
        return [trTarih(d.tarih), (d.hava || '').toUpperCase(), (d.egitim || '').toUpperCase(), d.sure || '', d.aciklama || ''];
    }

    function csvIndir() {
        if (!sonFiltreli.length) return bildir('İndirilecek uçuş kaydı yok.', 'hata');
        var satirlar = [['Tarih', 'Hava Aracı', 'Eğitim', 'Süre', 'Görev Açıklaması']];
        sonFiltreli.forEach(function (s) { satirlar.push(satirVerisi(s)); });
        var metin = '﻿' + satirlar.map(function (r) { return r.map(csvHucre).join(';'); }).join('\r\n');
        var blob = new Blob([metin], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ucus-logbook-' + bugunDamga() + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        bildir(sonFiltreli.length + ' uçuş indirildi.', 'basari');
    }

    function pdfIndir() {
        if (!sonFiltreli.length) return bildir('Yazdırılacak uçuş kaydı yok.', 'hata');
        var kap = $('yazdirAlani');
        kap.textContent = '';
        var mail = document.querySelector('.profil-mail');
        var toplam = 0;
        sonFiltreli.forEach(function (s) { toplam += sureDakika(s.dataset.sure); });

        kap.appendChild(eleman('h1', '', '✈ Uçuş Logbook'));
        kap.appendChild(eleman('p', 'yz-alt',
            (mail ? mail.textContent + ' · ' : '') + trTarih(bugunDamga()) + (sonFiltreOzet ? ' · Filtre: ' + sonFiltreOzet : '')));
        kap.appendChild(eleman('p', 'yz-toplam',
            'Toplam: ' + String(Math.floor(toplam / 60)).padStart(2, '0') + ':' + String(toplam % 60).padStart(2, '0') +
            ' saat · ' + sonFiltreli.length + ' uçuş'));

        var tablo = document.createElement('table');
        var ust = document.createElement('tr');
        ['Tarih', 'Hava Aracı', 'Eğitim', 'Süre', 'Görev Açıklaması'].forEach(function (b) { ust.appendChild(eleman('th', '', b)); });
        var thead = document.createElement('thead'); thead.appendChild(ust); tablo.appendChild(thead);
        var tbody = document.createElement('tbody');
        sonFiltreli.forEach(function (s) {
            var tr = document.createElement('tr');
            satirVerisi(s).forEach(function (h) { tr.appendChild(eleman('td', '', h)); });
            tbody.appendChild(tr);
        });
        tablo.appendChild(tbody);
        kap.appendChild(tablo);

        document.body.classList.add('yazdiriliyor');
        setTimeout(function () { window.print(); }, 60);
    }

    window.addEventListener('afterprint', function () { document.body.classList.remove('yazdiriliyor'); });

    /* ---------- İSTATİSTİK ---------- */

    var AY_KISA = { '09': 'Eyl', '10': 'Eki', '11': 'Kas', '12': 'Ara', '01': 'Oca', '02': 'Şub', '03': 'Mar', '04': 'Nis', '05': 'May', '06': 'Haz', '07': 'Tem', '08': 'Ağu' };
    var AY_SIRASI = ['09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08'];

    function dkSaat(dk) {
        return String(Math.floor(dk / 60)).padStart(2, '0') + ':' + String(dk % 60).padStart(2, '0');
    }
    function saatKisa(dk) {
        return String(Math.round(dk / 6) / 10).replace('.', ',');
    }

    function istatistikAc() {
        var kap = $('istatistikIcerik');
        kap.textContent = '';
        var liste = panelVeri.donemUcuslari || [];
        if (!liste.length) {
            kap.appendChild(eleman('div', 'bos-mesaj', 'Bu dönemde uçuş kaydı bulunmamaktadır.'));
            return modalAc('istatistikModal');
        }

        var toplam = 0, aylar = {}, tipler = { ggg: 0, 'gş': 0, 'au(sim)': 0 }, araclar = {};
        liste.forEach(function (f) {
            var dk = sureDakika(f.sure);
            toplam += dk;
            var ay = String(f.tarih || '').split('-')[1];
            aylar[ay] = (aylar[ay] || 0) + dk;
            if (tipler[f.egitimTipi] !== undefined) tipler[f.egitimTipi] += dk;
            araclar[f.havaAraciTipi] = (araclar[f.havaAraciTipi] || 0) + dk;
        });

        // Özet kutuları
        var ozet = eleman('div', 'ist-ozet');
        [['Toplam', dkSaat(toplam)], ['Uçuş', String(liste.length)], ['Ortalama', dkSaat(Math.round(toplam / liste.length))]].forEach(function (x) {
            var k = eleman('div', 'ist-kutu');
            k.appendChild(eleman('b', '', x[1]));
            k.appendChild(eleman('span', '', x[0]));
            ozet.appendChild(k);
        });
        kap.appendChild(ozet);

        // Aylık grafik
        kap.appendChild(eleman('div', 'ist-baslik', 'Aylık uçuş saati'));
        var enCok = 0;
        AY_SIRASI.forEach(function (a) { if ((aylar[a] || 0) > enCok) enCok = aylar[a]; });
        var grafik = eleman('div', 'ist-grafik');
        AY_SIRASI.forEach(function (a) {
            var dk = aylar[a] || 0;
            var sutun = eleman('div', 'ist-sutun');
            var cubuk = eleman('div', 'ist-cubuk');
            cubuk.style.height = (enCok ? Math.max(dk ? 4 : 0, Math.round((dk / enCok) * 100)) : 0) + '%';
            cubuk.title = AY_KISA[a] + ': ' + dkSaat(dk);
            if (dk) cubuk.appendChild(eleman('em', '', saatKisa(dk)));
            sutun.appendChild(cubuk);
            sutun.appendChild(eleman('span', '', AY_KISA[a]));
            grafik.appendChild(sutun);
        });
        kap.appendChild(grafik);

        // Tür dağılımı
        kap.appendChild(eleman('div', 'ist-baslik', 'Uçuş türü dağılımı'));
        var dagilim = eleman('div', 'ist-dagilim');
        var etiketler = [['ggg', '🌙 GGG', 'd-ggg'], ['gş', '☀️ GŞ', 'd-gs'], ['au(sim)', '🖥️ Sim', 'd-sim']];
        var lejant = eleman('div', 'ist-lejant');
        etiketler.forEach(function (t) {
            var yuzde = toplam ? Math.round((tipler[t[0]] / toplam) * 100) : 0;
            if (tipler[t[0]] > 0) {
                var parca = eleman('div', t[2]);
                parca.style.width = (tipler[t[0]] / toplam * 100) + '%';
                dagilim.appendChild(parca);
            }
            lejant.appendChild(eleman('span', '', t[1] + ' %' + yuzde + ' (' + dkSaat(tipler[t[0]]) + ')'));
        });
        kap.appendChild(dagilim);
        kap.appendChild(lejant);

        // Hava aracı dağılımı
        kap.appendChild(eleman('div', 'ist-baslik', 'Hava aracına göre'));
        var sirali = Object.keys(araclar).sort(function (a, b) { return araclar[b] - araclar[a]; });
        sirali.forEach(function (a) {
            var satir = eleman('div', 'ist-arac');
            satir.appendChild(eleman('span', 'ist-arac-ad', a.toUpperCase()));
            var seritKap = eleman('div', 'ist-serit');
            var serit = eleman('i');
            serit.style.width = Math.round((araclar[a] / araclar[sirali[0]]) * 100) + '%';
            seritKap.appendChild(serit);
            satir.appendChild(seritKap);
            satir.appendChild(eleman('b', '', dkSaat(araclar[a])));
            kap.appendChild(satir);
        });
        modalAc('istatistikModal');
    }

    /* ---------- TEMA (koyu / açık) ---------- */

    function temaDegistir() {
        var acik = document.documentElement.getAttribute('data-tema') === 'acik';
        if (acik) document.documentElement.removeAttribute('data-tema');
        else document.documentElement.setAttribute('data-tema', 'acik');
        try { localStorage.setItem('logbookTema', acik ? 'koyu' : 'acik'); } catch (e) { /* tarayıcı depolamayı engelliyor olabilir */ }
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', acik ? '#0b1220' : '#eef3fb');
    }


    /* ---------- ANA EKRANA EKLEME KARTI ---------- */

    var kurulumOlayi = null;
    var EKLE_ERTELE_GUN = 7;

    function depoOku(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function depoYaz(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* depolama kapalı olabilir */ } }

    function uygulamaModundaMi() {
        return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    }
    function iosMu() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }
    function mobilMi() {
        return window.matchMedia && matchMedia('(max-width: 820px)').matches && matchMedia('(pointer: coarse)').matches;
    }

    function eklemeKartiKapat() {
        var k = $('eklemeKarti');
        if (k) k.remove();
    }

    function eklemeKartiAc() {
        eklemeKartiKapat();
        var kart = eleman('div', 'ekleme-karti');
        kart.id = 'eklemeKarti';
        kart.setAttribute('role', 'dialog');
        kart.setAttribute('aria-label', 'Ana ekrana ekle');

        var ust = eleman('div', 'ekleme-ust');
        var ikon = document.createElement('img');
        ikon.src = '/icon-192.png'; ikon.alt = ''; ikon.className = 'ekleme-ikon'; ikon.width = 48; ikon.height = 48;
        ust.appendChild(ikon);
        var metin = document.createElement('div');
        metin.appendChild(eleman('b', '', 'Logbook\'u ana ekrana ekle'));
        metin.appendChild(eleman('small', '', 'Uygulama gibi tek dokunuşla aç, tam ekran kullan.'));
        ust.appendChild(metin);
        kart.appendChild(ust);

        var butonlar = eleman('div', 'ekleme-butonlar');

        if (kurulumOlayi) {
            // Android / Chrome: tek dokunuşla yükleme penceresi
            var ekle = eleman('button', 'btn-tamam', 'Ana ekrana ekle');
            ekle.type = 'button';
            ekle.onclick = function () {
                var olay = kurulumOlayi;
                kurulumOlayi = null;
                eklemeKartiKapat();
                try {
                    olay.prompt();
                    if (olay.userChoice) olay.userChoice.then(function (s) {
                        if (s && s.outcome === 'accepted') depoYaz('logbookEklendi', '1');
                    });
                } catch (e) { /* tarayıcı izin vermediyse sessizce geçilir */ }
            };
            butonlar.appendChild(ekle);
        } else if (iosMu()) {
            var adimlar = eleman('ol', 'ekleme-adimlar');
            var a1 = document.createElement('li');
            a1.appendChild(document.createTextNode('Alttaki '));
            var simge = eleman('span', 'ekleme-simge');
            simge.setAttribute('aria-hidden', 'true');
            simge.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 11H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
            a1.appendChild(simge);
            a1.appendChild(document.createTextNode(' Paylaş düğmesine dokun'));
            adimlar.appendChild(a1);
            adimlar.appendChild(eleman('li', '', 'Listeyi kaydırıp "Ana Ekrana Ekle" seçeneğini seç'));
            adimlar.appendChild(eleman('li', '', 'Sağ üstteki "Ekle"ye dokun'));
            kart.appendChild(adimlar);
            var tamam = eleman('button', 'btn-tamam', 'Anladım');
            tamam.type = 'button';
            tamam.onclick = function () { eklemeKartiKapat(); depoYaz('logbookEkleErtele', String(Date.now())); };
            butonlar.appendChild(tamam);
        } else {
            var adimlar2 = eleman('ol', 'ekleme-adimlar');
            adimlar2.appendChild(eleman('li', '', 'Tarayıcının menüsünü aç (⋮ veya ⋯)'));
            adimlar2.appendChild(eleman('li', '', '"Ana ekrana ekle" ya da "Uygulamayı yükle" seçeneğine dokun'));
            kart.appendChild(adimlar2);
            var tamam2 = eleman('button', 'btn-tamam', 'Anladım');
            tamam2.type = 'button';
            tamam2.onclick = function () { eklemeKartiKapat(); depoYaz('logbookEkleErtele', String(Date.now())); };
            butonlar.appendChild(tamam2);
        }

        var sonra = eleman('button', 'btn-iptal', 'Daha sonra');
        sonra.type = 'button';
        sonra.onclick = function () { eklemeKartiKapat(); depoYaz('logbookEkleErtele', String(Date.now())); };
        butonlar.appendChild(sonra);
        kart.appendChild(butonlar);

        var hic = eleman('button', 'ekleme-hic', 'Bir daha gösterme');
        hic.type = 'button';
        hic.onclick = function () { eklemeKartiKapat(); depoYaz('logbookEkleGizle', '1'); };
        kart.appendChild(hic);

        document.body.appendChild(kart);
    }

    // Otomatik gösterim: yalnızca telefonda, uygulama olarak açık değilse, daha önce eklenmemiş/gizlenmemişse
    function eklemeKartiniBelirle() {
        if (uygulamaModundaMi() || !mobilMi()) return;
        if (depoOku('logbookEklendi') === '1' || depoOku('logbookEkleGizle') === '1') return;
        var ertele = parseInt(depoOku('logbookEkleErtele') || '0', 10);
        if (ertele && Date.now() - ertele < EKLE_ERTELE_GUN * 24 * 3600 * 1000) return;
        setTimeout(function () {
            if (!document.getElementById('eklemeKarti') && !document.querySelector('.modal-arka.acik')) eklemeKartiAc();
        }, 3500);
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        kurulumOlayi = e;
    });
    window.addEventListener('appinstalled', function () {
        depoYaz('logbookEklendi', '1');
        kurulumOlayi = null;
        eklemeKartiKapat();
    });

    // Hizmet işçisi: yalnızca "uygulama olarak yüklenebilir" olmak için (önbellek tutmaz)
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () { /* desteklenmiyorsa sorun değil */ });
        });
    }


    function uyariAcKapat(dugme) {
        var kutu = document.querySelector('.uyari-gizli');
        if (!kutu) return;
        var acildi = kutu.hidden;
        kutu.hidden = !acildi;
        dugme.setAttribute('aria-expanded', acildi ? 'true' : 'false');
        dugme.textContent = acildi ? '▲ Gizle' : '▼ ' + kutu.children.length + ' uyarı daha';
    }

    /* ---------- ÇÖP KUTUSU ---------- */

    async function copGeriAl(id) {
        // Panel yenilenince pencereler de yenilendiği için, açık olup olmadığı önceden hatırlanır
        var copAcikti = $('copModal').classList.contains('acik');
        var sonuc = await apiCagir('/api/restore-flight', 'POST', { id: id });
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            bildir('Uçuş geri alındı.', 'basari');
            await paneliYenile();
            if (copAcikti) copAc();
        } else {
            bildir(sonuc.message || 'Uçuş geri alınamadı.', 'hata');
        }
    }

    async function copKaliciSil(id) {
        if (!(await onayIste('Bu uçuş kalıcı olarak silinecek, geri alınamaz. Emin misiniz?'))) return;
        var sonuc = await apiCagir('/api/purge-flight', 'POST', { id: id });
        if (sonuc.oturumYok) return;
        if (sonuc.success) { bildir('Kalıcı olarak silindi.', 'basari'); copAc(); }
        else bildir(sonuc.message || 'Silinemedi.', 'hata');
    }

    async function copAc() {
        var kap = $('copIcerik');
        kap.textContent = '';
        kap.appendChild(eleman('div', 'bos-mesaj', 'Yükleniyor...'));
        modalAc('copModal');
        var sonuc = await apiCagir('/api/trash', 'GET');
        if (sonuc.oturumYok) return;
        kap.textContent = '';
        if (!sonuc.success) {
            kap.appendChild(eleman('div', 'bos-mesaj', sonuc.message || 'Silinenler alınamadı.'));
            return;
        }
        if (!sonuc.liste.length) {
            kap.appendChild(eleman('div', 'bos-mesaj', 'Silinmiş uçuş yok.'));
            return;
        }
        sonuc.liste.forEach(function (f) {
            var tema = f.egitimTipi === 'ggg' ? ' tema-ay' : (f.egitimTipi === 'gş' ? ' tema-gunes' : '');
            var ikon = f.egitimTipi === 'ggg' ? '🌙 ' : (f.egitimTipi === 'gş' ? '☀️ ' : '');
            var satir = eleman('div', 'cop-satir' + tema);
            var sol = document.createElement('div');
            sol.appendChild(eleman('strong', 'liste-tarih', trTarih(f.tarih) + '  ' + f.sure));
            sol.appendChild(document.createElement('br'));
            sol.appendChild(eleman('span', 'liste-ince', ikon + (f.havaAraciTipi || '').toUpperCase() + ' · ' + (f.egitimTipi || '').toUpperCase()));
            if (f.gorevAciklamasi) {
                sol.appendChild(document.createElement('br'));
                sol.appendChild(eleman('span', 'liste-ince cop-acik', f.gorevAciklamasi.length > 50 ? f.gorevAciklamasi.slice(0, 50) + '...' : f.gorevAciklamasi));
            }
            if (f.silinme) {
                var kalanGun = Math.max(0, (sonuc.gun || 30) - Math.floor((Date.now() - new Date(f.silinme).getTime()) / 86400000));
                sol.appendChild(document.createElement('br'));
                sol.appendChild(eleman('span', 'liste-ince cop-kalan', kalanGun + ' gün sonra kalıcı silinir'));
            }
            satir.appendChild(sol);
            var sag = eleman('div', 'cop-butonlar');
            var geri = eleman('button', 'cop-geri', 'Geri al'); geri.type = 'button'; geri.dataset.eylem = 'cop-geri'; geri.dataset.id = f.id;
            var sil = eleman('button', 'cop-sil', 'Sil'); sil.type = 'button'; sil.dataset.eylem = 'cop-sil'; sil.dataset.id = f.id;
            sag.appendChild(geri); sag.appendChild(sil);
            satir.appendChild(sag);
            kap.appendChild(satir);
        });
    }

    /* ---------- UÇUŞ ŞABLONLARI ---------- */

    function sablonlariCiz() {
        var kap = $('sablonListe');
        if (!kap) return;
        kap.textContent = '';
        var liste = panelVeri.sablonlar || [];
        if (!liste.length) {
            kap.appendChild(eleman('span', 'sablon-bos', 'Henüz şablon yok. Sık yaptığın bir uçuşu aşağıdan kaydet.'));
            return;
        }
        liste.forEach(function (t) {
            var chip = eleman('div', 'sablon-chip');
            var ana = eleman('button', 'sablon-uygula');
            ana.type = 'button';
            ana.dataset.eylem = 'sablon-uygula';
            ana.dataset.id = t.id;
            ana.appendChild(eleman('b', '', t.ad));
            ana.appendChild(eleman('small', '', (t.havaAraciTipi || '').toUpperCase() + ' · ' + (t.egitimTipi || '').toUpperCase() + ' · ' + (t.sure || '')));
            chip.appendChild(ana);
            var x = eleman('button', 'sablon-x', '✕');
            x.type = 'button';
            x.dataset.eylem = 'sablon-sil';
            x.dataset.id = t.id;
            x.setAttribute('aria-label', t.ad + ' şablonunu sil');
            chip.appendChild(x);
            kap.appendChild(chip);
        });
    }

    function sablonUygula(id) {
        var t = (panelVeri.sablonlar || []).filter(function (x) { return x.id === id; })[0];
        if (!t) return;
        $('havaAraciTipi').value = t.havaAraciTipi;
        $('egitimTipi').value = t.egitimTipi;
        $('gorevAciklamasi').value = t.gorevAciklamasi || '';
        sureyiFormaYaz('', t.sure, false);
        bildir('"' + t.ad + '" şablonu forma uygulandı. Tarihi kontrol edin.', 'basari');
    }

    function sablonKaydetAc() {
        if ($('topluKutu') && $('topluKutu').checked) return bildir('Toplu süre şablon olarak kaydedilemez. Önce toplu kutucuğunu kapatın.', 'hata');
        var egitim = $('egitimTipi').value;
        var saat = $('sureAlani').dataset.saat || '00';
        var dakika = $('sureAlani').dataset.dakika || '00';
        if (!egitim) return bildir('Önce formda Eğitim Sınıflandırması seçin.', 'hata');
        if (saat === '00' && dakika === '00') return bildir('Önce formda uçuş süresini seçin.', 'hata');
        var hava = $('havaAraciTipi').value;
        $('sablonOnizleme').textContent = hava.toUpperCase() + ' · ' + egitim.toUpperCase() + ' · ' + saat + ':' + dakika;
        $('sablonAd').value = hava.toUpperCase() + ' ' + egitim.toUpperCase() + ' ' + saat + ':' + dakika;
        modalAc('sablonModal');
        setTimeout(function () { $('sablonAd').select(); }, 50);
    }

    async function sablonKaydet(dugme) {
        var ad = $('sablonAd').value.trim();
        if (!ad) return bildir('Şablon adı gerekli.', 'hata');
        dugme.disabled = true;
        var sonuc = await apiCagir('/api/add-template', 'POST', {
            ad: ad,
            havaAraciTipi: $('havaAraciTipi').value,
            egitimTipi: $('egitimTipi').value,
            sure: ($('sureAlani').dataset.saat || '00') + ':' + ($('sureAlani').dataset.dakika || '00'),
            gorevAciklamasi: $('gorevAciklamasi').value
        });
        dugme.disabled = false;
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            panelVeri.sablonlar = sonuc.sablonlar;
            sablonlariCiz();
            modalKapat('sablonModal');
            bildir('Şablon kaydedildi.', 'basari');
        } else {
            bildir(sonuc.message || 'Şablon kaydedilemedi.', 'hata');
        }
    }

    async function sablonSil(id) {
        if (!(await onayIste('Bu şablon silinsin mi?'))) return;
        var sonuc = await apiCagir('/api/delete-template', 'POST', { id: id });
        if (sonuc.oturumYok) return;
        if (sonuc.success) {
            panelVeri.sablonlar = sonuc.sablonlar;
            sablonlariCiz();
            bildir('Şablon silindi.', 'basari');
        } else {
            bildir(sonuc.message || 'Şablon silinemedi.', 'hata');
        }
    }

    /* ---------- TAKVİM ---------- */

    var AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    var tk = { yil: 0, ay: 0, secili: '' };

    function iki(n) { return String(n).padStart(2, '0'); }
    function tarihAnahtari(y, a, g) { return y + '-' + iki(a + 1) + '-' + iki(g); }

    // Takvim, listedeki tüm uçuşlardan beslenir (filtre ve sayfalamadan etkilenmez)
    function gunlereGore() {
        var harita = {};
        document.querySelectorAll('.ucus-satiri').forEach(function (r) {
            var d = r.dataset;
            if (!d.tarih) return;
            (harita[d.tarih] = harita[d.tarih] || []).push({ hava: d.hava, egitim: d.egitim, sure: d.sure, aciklama: d.aciklama || '' });
        });
        return harita;
    }

    function takvimCiz() {
        var harita = gunlereGore();
        var bugun = new Date();
        var bugunAnahtar = tarihAnahtari(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
        $('tkBaslik').textContent = AY_ADLARI[tk.ay] + ' ' + tk.yil;

        var grid = $('tkGrid');
        grid.textContent = '';
        ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].forEach(function (g) { grid.appendChild(eleman('div', 'tk-hafta', g)); });

        var ilk = (new Date(tk.yil, tk.ay, 1).getDay() + 6) % 7;
        var gunSayisi = new Date(tk.yil, tk.ay + 1, 0).getDate();
        for (var i = 0; i < ilk; i++) grid.appendChild(eleman('div', 'tk-bos'));

        var aylikDakika = 0, aylikUcus = 0;
        for (var g = 1; g <= gunSayisi; g++) {
            var anahtar = tarihAnahtari(tk.yil, tk.ay, g);
            var ucuslar = harita[anahtar] || [];
            var hucre = eleman('button', 'tk-gun-btn' + (anahtar === bugunAnahtar ? ' bugun' : '') + (anahtar === tk.secili ? ' secili' : '') + (ucuslar.length ? ' dolu' : ''));
            hucre.type = 'button';
            hucre.dataset.eylem = 'takvim-gun';
            hucre.dataset.tarih = anahtar;
            hucre.appendChild(eleman('span', 'tk-no', String(g)));
            if (ucuslar.length) {
                var dk = 0, tipler = {};
                ucuslar.forEach(function (u) { dk += sureDakika(u.sure); tipler[u.egitim] = true; });
                aylikDakika += dk; aylikUcus += ucuslar.length;
                var noktalar = eleman('span', 'tk-noktalar');
                if (tipler['ggg']) noktalar.appendChild(eleman('i', 'n-ay'));
                if (tipler['gş']) noktalar.appendChild(eleman('i', 'n-gunes'));
                if (tipler['au(sim)']) noktalar.appendChild(eleman('i', 'n-sim'));
                hucre.appendChild(noktalar);
                hucre.appendChild(eleman('span', 'tk-sure', Math.floor(dk / 60) + ':' + iki(dk % 60)));
            }
            grid.appendChild(hucre);
        }
        $('tkOzet').textContent = aylikUcus ? (Math.floor(aylikDakika / 60) + ':' + iki(aylikDakika % 60) + ' saat · ' + aylikUcus + ' uçuş') : 'Bu ay uçuş yok';
        takvimGunDetay(harita);
    }

    function takvimGunDetay(harita) {
        var kap = $('tkGun');
        kap.textContent = '';
        if (!tk.secili) {
            kap.appendChild(eleman('div', 'tk-ipucu', 'Bir güne dokunarak o günün uçuşlarını gör.'));
            return;
        }
        var ucuslar = (harita || gunlereGore())[tk.secili] || [];
        kap.appendChild(eleman('div', 'tk-gun-baslik', trTarih(tk.secili)));
        if (!ucuslar.length) kap.appendChild(eleman('div', 'tk-ipucu', 'Bu günde uçuş kaydı yok.'));
        ucuslar.forEach(function (u) {
            var tema = u.egitim === 'ggg' ? ' tema-ay' : (u.egitim === 'gş' ? ' tema-gunes' : '');
            var ikon = u.egitim === 'ggg' ? '🌙 ' : (u.egitim === 'gş' ? '☀️ ' : '');
            var satir = eleman('div', 'liste-satir' + tema);
            var sol = document.createElement('div');
            sol.appendChild(eleman('strong', 'liste-tarih', (u.hava || '').toUpperCase()));
            sol.appendChild(eleman('span', 'liste-alt', ikon + (u.egitim || '').toUpperCase()));
            if (u.aciklama) {
                sol.appendChild(document.createElement('br'));
                sol.appendChild(eleman('span', 'liste-ince', u.aciklama.length > 60 ? u.aciklama.slice(0, 60) + '...' : u.aciklama));
            }
            satir.appendChild(sol);
            satir.appendChild(eleman('div', 'rozet', u.sure || ''));
            kap.appendChild(satir);
        });
        var ekle = eleman('button', 'tk-ekle', '➕ Bu güne uçuş ekle');
        ekle.type = 'button';
        ekle.dataset.eylem = 'takvim-ekle';
        ekle.dataset.tarih = tk.secili;
        kap.appendChild(ekle);
    }

    function takvimAc() {
        var t = new Date();
        tk.yil = t.getFullYear();
        tk.ay = t.getMonth();
        tk.secili = tarihAnahtari(tk.yil, tk.ay, t.getDate());
        takvimCiz();
        modalAc('takvimModal');
    }

    function takvimAyDegistir(fark) {
        tk.ay += fark;
        if (tk.ay < 0) { tk.ay = 11; tk.yil--; }
        if (tk.ay > 11) { tk.ay = 0; tk.yil++; }
        tk.secili = '';
        takvimCiz();
    }

    function takvimBuGuneEkle(tarih) {
        modalKapat('takvimModal');
        $('tarih').value = tarih;
        var kutu = $('ekleIcerikKutusu');
        if (!kutu.classList.contains('acik')) akordeonAcKapat('ekleIcerikKutusu', 'ekleOkIkon', document.querySelector('[data-icerik="ekleIcerikKutusu"]'));
        $('ekleIcerikKutusu').scrollIntoView({ behavior: 'smooth', block: 'center' });
        bildir(trTarih(tarih) + ' tarihi forma yazıldı. Diğer bilgileri doldurun.', 'basari');
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
        var ozetParcalari = [];
        if (yil) ozetParcalari.push(yil + ' dönemi');
        if (ay) ozetParcalari.push($('filtreAy').selectedOptions[0].textContent);
        if (hava) ozetParcalari.push(hava.toUpperCase());
        if (egitim) ozetParcalari.push(egitim.toUpperCase());
        sonFiltreOzet = ozetParcalari.join(' · ');

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

        sonFiltreli = gorunur;
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
            case 'profil-modal': profilModalAc('bilgi'); break;
            case 'ekle-goster': modalKapat('profilModal'); eklemeKartiAc(); break;
            case 'uyari-ac': uyariAcKapat(hedef); break;
            case 'cop-ac': copAc(); break;
            case 'cop-geri': copGeriAl(d.id); break;
            case 'cop-sil': copKaliciSil(d.id); break;
            case 'sablon-uygula': sablonUygula(d.id); break;
            case 'sablon-sil': sablonSil(d.id); break;
            case 'sablon-kaydet-ac': sablonKaydetAc(); break;
            case 'sablon-kaydet': sablonKaydet(hedef); break;
            case 'takvim-ac': takvimAc(); break;
            case 'takvim-onceki': takvimAyDegistir(-1); break;
            case 'takvim-sonraki': takvimAyDegistir(1); break;
            case 'takvim-bugun': takvimAc(); break;
            case 'takvim-gun': tk.secili = d.tarih; takvimCiz(); break;
            case 'takvim-ekle': takvimBuGuneEkle(d.tarih); break;
            case 'profil-sekme': profilSekme(d.sekme); break;
            case 'profil-kaydet': profilKaydet(hedef); break;
            case 'sure-modal': sureModalAc(d.hedef, d.metin); break;
            case 'ucus-duzenle': e.stopPropagation(); duzenleModalAc(d.id); break;
            case 'duzenle-kaydet': duzenleKaydet(hedef); break;
            case 'son-kopyala': sonUcusuKopyala(); break;
            case 'toplu-degis': topluDegis(d.onek); break;
            case 'istatistik-ac': istatistikAc(); break;
            case 'csv-indir': csvIndir(); break;
            case 'pdf-indir': pdfIndir(); break;
            case 'tema-degistir': temaDegistir(); break;
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

    // Boy / kilo / doğum tarihi değişince VKİ ve yaş anında güncellenir
    document.addEventListener('input', function (e) {
        if (e.target && /^profil(Boy|Kilo|Dogum)$/.test(e.target.id)) profilHesapla();
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
    sonKopyaGuncelle();
    sablonlariCiz();
    eklemeKartiniBelirle();
    if (uygulamaModundaMi()) document.querySelectorAll('[data-eylem="ekle-goster"]').forEach(function (b) { b.hidden = true; });
})();
