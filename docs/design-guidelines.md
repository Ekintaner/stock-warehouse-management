# Tasarım yönergeleri

## 1. Görsel yön

Arayüz küçük bir hırdavat ve teknik malzeme deposunun günlük işlerine hizmet eder. Açık zemin, koyu gri metin ve tek bir vurgu rengi kullanılır. Renk, durum veya önceliğin tek göstergesi olmaz. Gradyan, dekoratif grafik, anlamsız animasyon ve hazır SaaS dashboard görünümü kullanılmaz. Görsel hiyerarşi ürün listesi, belge satırları, bakiye ve sonraki işlem adımını öne çıkarır.

Masaüstü kullanımında depo iş akışlarını verimli kıl; dar ekranlarda temel görüntüleme ve form kullanımı bozulmasın. Sırf alan doldurmak için metrik kartı ekleme. Depo özeti, düşük stok ve son hareket gibi doğrudan iş kararı destekleyen bilgileri kompakt listelerle göster.

## 2. Navigasyon ve ekran düzeni

- Ana gezinme: **Özet**, **Ürünler**, **Depolar**, **Tedarikçiler**, **Stok belgeleri**, **Transferler**, **Sayım**, **Hareketler**, **Raporlar**, **Yönetim**.
- Kullanıcıya yalnızca rolü ve depo atamalarına uygun eylemler gösterilir; sunucu yetkisi yine asıl sınırdır.
- Seçili depo kapsamı görünür olmalı; tüm depoları kapsayan yönetici raporları ayrıca belirtilmelidir.
- Sayfa başlığında kısa amaç, birincil eylem ve gerekiyorsa depo filtresi bulunur.
- Belge akışında başlık, durum, satırlar ve toplamlar tek bakışta anlaşılır; uzun satır formları kaydetme/onay adımlarında kullanıcının girdisini korur.
- Kritik onay öncesi kaynak depo, hedef depo, satır sayısı ve ürün/miktar etkisi açıkça gösterilir.

## 3. Tablolar, sayılar ve tarihler

- Ürün ve hareket listeleri arama, filtreleme ve sayfalama sunar. Aktif filtreler kolayca temizlenebilir; filtre değişince sayfa başı sonuçlara dönülür.
- Sayısal miktarlar sağa hizalanır ve birim miktarın yanında tutarlı gösterilir: `12 adet`, `3,250 kg`. Görsel ondalık ayracı Türkçe gösterime uygundur; API ve CSV biçimleri sözleşmede açıkça tanımlanır.
- Adet miktarı kesirsiz gösterilir; kg/metre en fazla üç ondalık basamak taşır. Gereksiz sondaki sıfırlar gösterilmez.
- Tarih/saat biçimi arayüzde tutarlı, yerel kullanıcı için anlaşılır olur; kayıt ve karşılaştırma sunucuda zaman dilimi bilgisiyle yapılır.
- Durum etiketi metin taşır: **Taslak**, **Sevk edildi**, **Teslim alındı**, **Onaylandı**, **İptal edildi**. Renk ikincil destek olabilir, tek başına anlam taşımaz.
- Boş değer, pasif kayıt ve yetersiz stok gibi durumlar farklı ve açık metinlerle ifade edilir.

## 4. Form ve işlem davranışı

- Her alanın görünür etiketi ve gerekli olduğunda kısa yardım metni vardır. Placeholder etiket yerine kullanılmaz.
- Hatalar ilgili alanla ilişkilendirilir ve form gönderiminden sonra odak ilk hataya taşınabilir.
- Sunucu doğrulama hatası, ağ hatası veya yetki hatasında kullanıcı girdisi korunur; sayfa sessizce sıfırlanmaz.
- Belge satırı ekleme/silme klavye ile yapılabilir. Ürün araması SKU, barkod veya ad üzerinden sonuçları açıkça ayırt eder.
- Onay düğmesi tekrar gönderime karşı devre dışı görünse de idempotency asıl güvenceyi backend'de sağlar.
- Kritik işlem onay penceresi yalnızca “Emin misiniz?” demez; örneğin “2 satırda toplam 8 adet kaynak depodan düşecek; transfer yoldaki stoğa alınacak.” biçiminde etkiyi açıklar.
- Başarılı işlemden sonra ilgili belge/sonuç bağlantısı ve yeni durum gösterilir.

## 5. Durumlar, erişilebilirlik ve geri bildirim

Her liste ve işlem akışı için **yükleniyor**, **boş liste**, **hata**, **yetkisiz erişim** ve **başarılı işlem** durumu tasarlanır. Yüklenme durumunda içerik yerleşimi mümkün olduğunca sabit kalır. Boş durum, uygulanabilir bir sonraki eylemi açıklar; boş olmayan gerçek dışı örnek istatistik üretmez.

- Klavye ile gezinme ve temel form gönderimi çalışır; odak göstergesi görünür ve yüksek kontrastlıdır.
- Başlık hiyerarşisi, tablo başlıkları, form etiketleri, hata ilişkileri ve diyalog erişilebilir adları semantik olarak tanımlanır.
- Renk kontrastı okunabilir olmalı; durum simgesi varsa yanında metin de bulunur.
- Ekran okuyucuya başarı/hata geri bildirimi uygun canlı bölgeyle iletilir; otomatik odak değişimi beklenmedik olmaz.
- Animasyon temel bilgiye erişim için gerekli değildir; hareket azaltma tercihi gözetilir.

## 6. Türkçe metin örnekleri

- Boş hareket listesi: **“Bu filtrelerle eşleşen stok hareketi yok.”**
- Atanmamış depo: **“Bu depoda işlem yapma yetkiniz yok.”**
- Yetersiz bakiye: **“Çıkış tamamlanamadı. Depo stoğu istenen miktar için yetersiz.”**
- Açık sayım engeli: **“Bu depoda sayım açık. Miktar değişikliği sayım kapatılana kadar yapılamaz.”**
- Transfer onayı: **“Sevk et: belirtilen miktar kaynak depodan düşecek ve teslim alınana kadar yoldaki stokta görünecek.”**
- Tekrar anahtarı çakışması: **“Bu istek anahtarı farklı bir içerikle daha önce kullanılmış. İşlem uygulanmadı.”**
- Başarılı onay: **“Stok giriş belgesi onaylandı.”**
- Demo açıklaması: **“Örnek kayıtlar sentetiktir; gerçek işletme verisi değildir.”**

Metinler suçlayıcı olmamalı ve mümkün olduğunda sonraki adımı belirtmelidir. Teknik stack trace veya ham SQL mesajı kullanıcıya gösterilmez.
