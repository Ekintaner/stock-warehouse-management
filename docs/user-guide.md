# Kullanım ve kabul rehberi

## İlk kullanım

Yöneticiyle giriş yapın. Önce kategori, ürün ve iki depo oluşturun. Raflar
konum bilgisidir; ayrı miktar taşımaz. Kullanıcılar bölümünden depo sorumlusu
ve görüntüleyici oluşturup gerekli depoları atayın. Varsayılan parola yoktur.

## Stok ve transfer

1. Stok girişinde 10 adet ürün için taslak oluşturun. Taslak miktarı değiştirmez.
2. Onaylayın: stok 10 olur, tek giriş hareketi görünür.
3. Üç adet çıkışı onaylayın: stok 7 olur. Fazla çıkış reddedilmelidir.
4. İki adet transferi sevk edin: kaynak 5, yoldaki 2, hedef henüz değişmez.
5. Hedefte teslim alın: hedef 2, yoldaki 0 olur.
6. Ayrı bir sevk edilmiş transferi yöneticiyle gerekçeli geri döndürün:
   kaynak miktarı geri gelir, hedef değişmez. Teslim alınmış transfer dönmez.

## Sayım

Sayım açınca ilgili depoda miktar değiştiren işlemler durur. Bütün aktif
ürünler ve pasif ama stoklu ürünler kapsama alınır. Boş miktar sayılmamış,
0 fiziksel olarak bulunamadı demektir. Kaydetmek stoğu değiştirmez.
Bütün satırları kaydettikten sonra yönetici farkları onaylar. Örneğin sistem
10, fiziksel 8 ise tek 2 adet OUT fark hareketi oluşur ve bakiye 8 olur.
İptal stoğu değiştirmeden hareket engelini kaldırır. Kapanmış sayım düzenlenmez.
Sayfadan ayrılmadan miktarları kaydedin; filtre ve sayfalama kirli girişte kilitlenir.

## Hata düzeltme ve raporlar

Onaylı giriş/çıkış detayından yönetici tam ters hareket oluşturabilir.
Gerekçe zorunludur. Tersleme negatif stok yaratacaksa reddedilir. İkinci kez
terslenemez; orijinal belge ve hareketler geçmişte korunur.

Raporlar bölümünde depo/ürün filtresi, minimum stok eşiği ve düşük stok
listesi bulunur. Dönemsel özet depo ve tarih aralığıyla çalışır; ölçü birimleri
ayrı gösterilir. CSV aynı yetki kapsamını taşır. Defter/bakiye kontrolü salt
okunurdur; uyuşmazlığı otomatik olarak düzeltmez.

## Yedekleme

Uygulamayı durdurup yerel PostgreSQL aracınızla geliştirme veritabanının
özel format yedeğini alabilirsiniz. Parola terminalde sorulur:

```text
pg_dump -h 127.0.0.1 -p 5432 -U stock_warehouse_migrator -d stock_warehouse_local -W -Fc -f stock-warehouse.backup
```

Yedeği kaynak depoya yüklemeyin. Geri yükleme mevcut veriyi etkileyebildiği
 için önce ayrı boş bir veritabanında deneyin; uygulama otomatik restore yapmaz.
.env ve bağlantı parolalarını yedek dosyalarıyla birlikte paylaşmayın.
