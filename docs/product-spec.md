> **Güncel teslim — 2026-10-17:** Sayım backend ve arayüzü, belge tam terslemesi,
> tedarikçiler, kullanıcı/depo atamaları, minimum stok, stok/dönem raporları,
> CSV, denetim ve defter/bakiye kontrolü uygulanmıştır. Aşağıdaki eski aşama
> notları tarihseldir; güncel kapsam README ve doğrulama raporundadır.

# Ürün gereksinimleri

## 1. Amaç ve ilk sürüm sınırı

Uygulama, küçük bir hırdavat ve teknik malzeme işletmesinin birden fazla deposundaki ürün miktarlarını ve bu miktarları değiştiren belgeleri izlemek için planlanır. İşlemler izlenebilir, doğrulanabilir ve hatalı kayıtlar sonradan açıklanabilir olmalıdır. Arayüz ve kullanıcıya dönük mesajlar Türkçedir; kod, API ve veri modeli isimleri İngilizcedir.

İlk sürüm tek işletmeye aittir; çok kiracılı SaaS değildir. Çalışma yereldir ve temel işlevler için ücretli veya bulut hizmeti gerekmez. Yapay zekâ özelliği olmayacaktır. Giriş/oturum altyapısı, ürün/kategori/depo/raf ana kayıtları, giriş/çıkış belgeleri ve depolar arası transferler uygulanmıştır; sayım, ters hareket ve raporlama bölümleri hedef ve kabul koşuludur.

## 2. Roller ve yetki matrisi

| İşlem | Yönetici | Depo sorumlusu | Yalnızca görüntüleme |
|---|---|---|---|
| Ürün ve kategori kataloğunu görüntüleme | Evet | Evet | Evet |
| Depo ve rafları görüntüleme | Tüm depolar | Atanmış depolar | Atanmış depolar |
| Ürün, kategori, depo ve raf oluşturma/düzenleme/pasifleştirme | Evet | Hayır | Hayır |
| Tedarikçi kayıtlarını görüntüleme | Evet | Evet | Evet |
| Tedarikçi oluşturma/düzenleme/pasifleştirme | Evet | Hayır | Hayır |
| Depo sorumlusu ve depo atamalarını yönetme | Evet | Hayır | Hayır |
| Herhangi bir depoda giriş, çıkış, transfer, sayım başlatma ve fark onayı | Evet | Hayır | Hayır |
| Kendisine atanmış depoda giriş/çıkış belgesi oluşturma ve onaylama | Evet | Evet | Hayır |
| Atanmış deponun taraf olduğu transferi taslak oluşturma/sevk/teslim alma | Evet | Evet | Hayır |
| Atanmış depoda sayım açma, sayım miktarı girme ve farkı onaylama | Evet | Evet | Hayır |
| İzin verilen kapsamda stok ve hareket geçmişini görüntüleme | Tüm depolar | Atanmış depolar | Yetkilendirilmiş görüntüleme kapsamı |
| Rapor ve CSV dışa aktarımı | Tüm depolar | Atanmış depolar | Yetkilendirilmiş görüntüleme kapsamı |
| Denetim kayıtlarını görüntüleme | Tüm kayıtlar | Atanmış depolarla ilgili kayıtlar | Yetkilendirilmiş görüntüleme kapsamı |
| Kullanıcı/rol/atama yönetimi | Evet | Hayır | Hayır |

Yalnızca görüntüleme rolü ve depo sorumlusu, depo/raf detaylarını yalnızca kendilerine atanmış depolarda görür; ürün ve kategori kataloğu tüm rollere açıktır. Yönetici bütün depolara erişir. Liste ve detay endpoint'leri aynı kapsamı uygular; atanmamış depo/raf detayları bilgi sızdırmayan 404 yanıtı verir. Depo sorumlusunun ve görüntüleme rolünün yazma isteği, UI'dan bağımsız olarak her API isteğinde sunucu tarafında reddedilir. Transferde kaynak depo için sevk, hedef depo için teslim alma yetkisi ayrıca kontrol edilir. Bir kullanıcı iki depodan yalnızca birine atanmışsa, diğer depoya yönelik işlem yapamaz.

## 3. Ana kayıtlar ve ekranlar

1. **Oturum açma:** Kullanıcı adı/e-posta ve parola; hata mesajı hassas bilgi açığa çıkarmaz.
2. **Stok:** Yetkili depo için ürün bazlı read-only güncel miktar; eksik bakiye satırı sıfır gösterilir.
3. **Ürünler:** SKU, isteğe bağlı barkod, ad/açıklama, kategori, birim ve aktiflik; arama, filtre, kararlı sıralama ve sunucu taraflı sayfalama. Katalog listesinde stok miktarı gösterilmez.
4. **Kategoriler, depolar ve raflar:** Yönetici ana kayıtları düzenler; atanmış depo kapsamı dışındaki depo ve raflar listelenmez veya detaydan erişilemez. Raf konumu ilgili depo altında yönetilir.
5. **Tedarikçiler:** Temel iletişim ve aktiflik bilgileri; satın alma siparişi kapsam dışıdır.
6. **Stok giriş/çıkış belgeleri (uygulandı):** Çok satırlı taslak, düzenleme, taslak iptali, liste/detay ve açık etkili onay. Girişte var olan aktif tedarikçi isteğe bağlı seçilebilir; tedarikçi CRUD yoktur. Onaylı belgede değişiklik/düzeltme yoktur.
7. **Transferler (uygulandı):** Taslak, sevk, teslim, taslak iptali ve gerekçeli tam geri dönüş. Kaynak/hedef, satırlar, işlem yapan ve durum zamanları görüntülenir. Yoldaki miktar hareketlerle tutarlı transfer satırlarından türetilir.
8. **Stok sayımı:** Depo sayımını başlatma, sistem miktarını sabitleme, fiziksel miktarları girme, farkı inceleme ve onaylama.
9. **Stok hareketleri (uygulandı):** Ürün, depo, tarih aralığı ve yön filtreleriyle sınırlı, sunucu tarafında sayfalanan değiştirilemez hareket defteri; belge ve işlem yapan bilgisi görüntülenir.
10. **Raporlar:** Düşük stok, depo özeti, tarih/depo bazlı giriş ve çıkış raporları; CSV dışa aktarımı.
11. **Denetim kayıtları:** Kim, ne zaman, hangi kaydı hangi nedenle değiştirdi veya hangi hareketi onayladı.
12. **Kullanıcılar ve atamalar:** Yönetici tarafından kullanıcı ve rol yönetimi; depo sorumlularına ve yalnızca görüntüleme kullanıcılarına depo atama.

Tüm liste ekranlarında yüklenme, boş sonuç, hata ve yetkisiz erişim durumları bulunur. Mutasyonlarda başarılı işlem açıkça bildirilir; başarısız doğrulamada girilmiş form verisi korunur.

## 4. İş akışları ve iş kuralları

### Ürün ve depo yönetimi

- SKU zorunlu ve benzersizdir. Barkod isteğe bağlıdır; verildiğinde benzersizdir.
- SKU baş/son boşlukları kaldırıldıktan sonra ASCII büyük harfe çevrilir; 1–64 karakter ve `[A-Z0-9][A-Z0-9._-]*` biçimindedir. Benzersiz DB indeksi eşzamanlı isteklerde son garantidir.
- Barkod metin olarak saklanır; baş/son boşlukları kırpılır, boş değer `NULL` yapılır, iç boşluklar korunur. 1–64 görünür ASCII karakteri kabul edilir; büyük/küçük harfe duyarlı bire bir benzersizdir ve baştaki sıfırlar korunur.
- Ürün adı en fazla 180, açıklama en fazla 1000 karakterdir; boş ad reddedilir. Kategori/depo/raf kodları 1–48 ASCII karakterle sınırlıdır (`A-Z`, `0-9`, `.`, `_`, `-`); adlar en fazla 120 karakterdir. SKU ve kodlar trim edilip büyük harfe normalize edilir.
- Pasif kategori yeni ürüne atanamaz; kategori pasifleştirilince mevcut ürün ilişkileri korunur. Ürün birimi, movement veya stok belgesi/transfer/sayım satırı geçmişi varsa değiştirilemez.
- Kimlikler API'de değiştirilemez. SKU değişikliği aynı Product kimliğini korur; geçmiş FK ilişkileri ve audit izleri bu kimliğe bağlı kalır. Ürün, kategori, depo ve raf için fiziksel silme endpoint'i yoktur; pasifleştirme geçmiş ilişkileri korur.
- Depo pasifleştirme, aynı transaction'da depo satırını mevcut movement/sayım düzeniyle aynı `FOR UPDATE` kilidiyle alır; pozitif bakiye, taslak/sevk edilmiş transfer veya açık sayım varsa reddedilir. Raflar yalnızca ilgili depoya bağlı yerleşim bilgisidir; bağımsız stok tutmaz.
- Ana kayıt oluşturma/düzenleme/pasifleştirme ve audit olayı tek transaction içindedir. Audit yazımı başarısızsa ana kayıt değişikliği de rollback olur. Beklenen `updatedAt` sürümü eşleşmiyorsa eşzamanlı düzenleme 409 ile reddedilir.
- Katalog ekranında yalnızca Ürünler, Kategoriler ve Depolar gezinmesi bulunur; rapor, tedarikçi veya henüz çalışmayan stok modülü için menü yoktur.
- Raf/konum, depoya bağlı basit bir kod/ad bilgisidir; lot veya seri takibi değildir.

### Giriş ve çıkış

- Kullanıcı bir veya daha fazla satırı taslak olarak girer; ürün başına tek satır vardır. Miktar pozitif decimal string olarak taşınır; en fazla üç ondalık basamak, `EACH` için tam sayı şartı vardır. Yerel form virgülü nokta ile standartlaştırır.
- Taslak düzenlenebilir ve yalnızca iptal edilebilir; bu aşamada fiziksel silme endpoint'i yoktur. Onaylanmış belge ve hareket değiştirilemez/silinemez.
- Onay, bütün satırları tek veritabanı işlemi içinde uygular. Herhangi bir satır geçersizse hiçbir satır stok bakiyesine yansımaz.
- Çıkış stok yetersizliği nedeniyle başarısızsa stok negatife düşmez ve taslak verisi kaybolmaz.
- Onayda aktif depo/ürün, yetki ve açık sayım tekrar kontrol edilir. Ortak depo kilidi ve belge/satır kilitleri alınır; stale düzenleme reddedilir.
- Onay idempotency anahtarı kullanıcı ve operasyonla kapsamlanır. Aynı anahtar/içerik ilk sonucu verir; aynı anahtarın başka içerikle kullanımı 409'dur. Hareket, belge durumu, idempotency cevabı ve audit tek transaction içindedir.
- Bu aşamada onaylı belge düzeltmesi ve ters hareket uygulanmaz; onaylı kayıtta iptal/silme eylemi gösterilmez.

### Depolar arası transfer

- Durumlar: **Taslak → Sevk edildi → Teslim alındı**; taslak **İptal edildi** durumuna alınır. Bu aşamada yalnızca **Sevk edildi → Geri döndü** desteklenir. Teslim alınmış transfer iade edilmez; API 409 döndürür.
- Taslak oluşturma/düzenleme/iptal stok değiştirmez. Kaynak ve hedef farklı, aktif depolar olmalı; transferde ürün başına bir satır, pozitif decimal string, en çok üç ondalık basamak ve `EACH` için tam sayı kuralı uygulanır.
- Sevk tüm satırları atomik olarak kaynak stoktan düşürür. Yetersiz bakiye veya etkilenen depoda açık sayım varsa işlem bütünüyle reddedilir.
- Teslim alma tüm satırları atomik olarak hedef stoğa ekler. Yoldaki sevk edilmiş transferin gerekçeli geri dönüşü tüm miktarı kaynak stoğa ekler; hedef stok değişmez ve yoldaki miktar kapanır.
- Kısmi sevk, teslim veya dönüş yoktur. Sevk edilmiş transfer normal iptal edilemez; transfer ve satırları hareket oluştuktan sonra değiştirilemez.
- Yoldaki miktarın tek doğruluk kaynağı `SHIPPED` durumundaki transfer satırlarıdır. Stok ekranında yetkili seçili depo için `Yoldaki giriş` ve `Yoldaki çıkış` ayrı görünür; mevcut ve kullanılabilir stok hesabına eklenmez.
- Depo sorumlusu atanmış kaynak depoda taslak oluşturabilir/düzenleyebilir/iptal edebilir/sevk edebilir; atanmış hedef depoda teslim alabilir. Geri dönüş yalnız yöneticidedir. Yönetici tüm depolarda işlem yapabilir, görüntüleme rolü yazamaz. Transferi kaynak veya hedef depoya atanmış kullanıcı okuyabilir; depo seçim API'si diğer aktif depolar için yalnız ID/kod/ad verir, depo detayı/raf/miktar vermez.
- Sevk, teslim ve geri dönüş ayrı idempotency kapsamları kullanır. Aynı anahtar/gövde tekrarlandığında ilk sonuç döner; aynı anahtar farklı içerikte 409'dur. Transfer ve etkilenen depolar sabit ID sırasıyla kilitlenir; hareket, durum, audit ve idempotency aynı transaction'dadır.

### Sayım ve düzeltme

- Aynı depoda aynı anda en fazla bir açık sayım bulunabilir.
- Sayım satırlarının miktarı raf/konum bazında değil, depo toplam bakiyesi bazında tutulur; raf/konum yalnızca yerleşim bilgisidir.
- Sayım başlatılırken depo miktar değiştiren işlemlere kapatılır; ilgili depoda sayım sonuçlanana/iptal edilene kadar giriş, çıkış, transfer sevki/teslimi, ters hareket ve başka sayım farkı uygulanamaz.
- Sayım satırları için başlangıç sistem miktarı ve sayım zamanı saklanır. Sayım sırasında miktarı etkileyen işlemler engellendiğinden bu miktar karşılaştırma için sabittir.
- Her satırın fiziksel miktarı girilir; fark yönetici veya yetkili depo sorumlusu tarafından onaylanır.
- Negatif fark stok çıkışı, pozitif fark stok girişi olur. Sıfır fark için miktar hareketi üretilmez.
- Fark onayı atomiktir. Onayla beraber fark hareketleri, bakiye güncellemesi ve denetim kaydı yazılır; sayım kapatılır.
- Sayımı iptal etmek stok değiştirmez ve sayım taslağını/açıklamasını denetim iziyle kapatır.

## 5. Miktar ve stok tutarlılığı

- Miktarlar PostgreSQL `numeric/decimal` ve decimal aritmetik kullanır; JavaScript `number` ile stok hesabı yapılmaz.
- Adet birimi yalnızca tam sayıdır. Kg ve metre gibi ölçü birimleri en fazla üç ondalık basamak kabul eder. Sıfırdan büyük miktar girilmesi gerekir.
- Her onaylanmış stok değişimi değiştirilemez bir hareket defteri kaydıdır. Bakiye, aynı veritabanı işlemi içinde defterle birlikte güncellenen bir projeksiyondur.
- Serbest bakiye düzenleme endpoint'i/ekranı bulunmaz. Düzeltme, onaylı giriş/çıkış, sayım farkı veya bağlı ters hareket olarak kaydedilir.
- Her stok değişikliğinde önce etkilenen depoların veritabanı kilidi alınır; sonra sayım kilidi/durumu ve bakiye yeniden okunup doğrulanır. Eşzamanlı çıkışların toplamı mevcut stoğu aşamaz.
- Sayım açma/kapatma da aynı depo satırı kilidini kullanır; birden fazla depoyu etkileyen işlemler depo kimliklerini sabit artan sırada kilitler.
- Çok satırlı belge, stok defteri, bakiye, belge durumu, idempotency kaydı ve denetim kaydı tek transaction sınırında tutarlı biçimde sonuçlanır.
- İstemci tekrarları idempotency anahtarıyla ele alınır. Aynı kapsam ve anahtar ile aynı içerik tekrar gelirse ilk sonucun aynısı döndürülür; aynı anahtar farklı içerikle kullanılırsa istek çakışma hatasıyla reddedilir.
- Bakiye ile defter için periyodik/operasyonel uzlaştırma sorgusu planlanır. Sapma bulunursa otomatik sessiz düzeltme yapılmaz; hata raporlanır, kök neden incelenir ve denetlenebilir düzeltme hareketi oluşturulur.

## 6. Kapsam dışı

Gerçek ödeme, muhasebe entegrasyonu, fatura kesme, satın alma siparişi, mobil uygulama, barkod donanımı entegrasyonu, lot/seri numarası, son kullanma tarihi, stok maliyetlendirmesi, tedarikçi CRUD, sayım, onaylı belge düzeltmesi, genel ters hareket, rapor dashboard'u, harici kimlik sağlayıcısı, zorunlu e-posta servisi ve çok kiracılı SaaS ilk sürümde yoktur.

## 7. Somut kabul koşulları

1. SKU tekrarı reddedilir; isteğe bağlı barkod verildiyse barkod tekrarı da reddedilir. Hata ilgili alanda açıklanır, diğer form alanları korunur.
2. Depo sorumlusu atanmadığı depoda API üzerinden de stok belgesi onaylayamaz; yalnızca görüntüleme rolü hiçbir stok değiştirme isteğini başarıyla tamamlayamaz.
3. Aynı idempotency anahtarı ve aynı gövde tekrar gönderildiğinde tek bir hareket oluşur ve aynı sonuç alınır. Aynı anahtar farklı gövdeyle kullanıldığında ikinci istek reddedilir.
4. Başlangıç stoğu 10 adetken iki eşzamanlı 7 adet çıkıştan yalnızca biri başarılı olur; bakiye 3 olur, hiçbir ara/sonuç durumda negatif olmaz.
5. Çok satırlı çıkışın bir satırı yetersiz stokluysa belge ve hiçbir satırı uygulanmaz; tüm stok bakiyeleri değişmeden kalır.
6. Taslak transfer kaynak stoğu değiştirmez. Sevk kaynak bakiyesini düşürür ve yoldaki miktarı artırır; teslim alma yoldaki miktarı kapatıp hedef bakiyesini artırır. Her geçersiz durum geçişi reddedilir.
7. Taslak transfer iptal edilebilir; sevk edilmiş transfer normal iptal edilemez. Açıklamalı ters transfer özgün transferle ilişkilidir ve yetersiz stokta reddedilir.
8. Sayım açılması ile eşzamanlı stok işlemi aynı depo kilidi üzerinden sıralanır: işlem önce kilidi aldıysa tamamlanır ve sayım yeni bakiyeyi esas alır; sayım önce aldıysa işlem sayım kapanana dek reddedilir/engellenir. Açık sayım boyunca miktar değiştiren hiçbir işlem uygulanmaz.
9. Sayımda negatif fark çıkış, pozitif fark giriş hareketi üretir; sayım farkları, bakiye güncellemesi ve sayım kapanışı hep birlikte başarı ya da hep birlikte geri alınma davranışı gösterir.
10. Onaylanmış hareket kaydı güncellenemez/silinemez; düzeltme özgün kayda bağlı ters hareket ve neden oluşturur. Ters hareket negatif bakiye yaratamaz.
11. Adet biriminde kesir ve ölçü biriminde üçten fazla ondalık basamak API doğrulamasından geçmez.
12. Filtreler stok hareketlerini depo, ürün, tür ve tarih aralığına göre sınırlar; CSV çıktısı aynı yetki ve filtre kapsamını uygular.
13. Klavye ile temel belge ve sayım akışı tamamlanabilir; odak görünürdür, alanların erişilebilir etiketleri vardır ve durum metinle ifade edilir.
14. Giriş, boş liste, doğrulama hatası, sunucu hatası, yetkisiz erişim ve başarı durumlarının her biri anlaşılır Türkçe mesajla gösterilir.
15. Demo verileri sentetiktir ve ekranda/README'de demo olduğu açıkça belirtilir; gerçek kullanıcı veya başarı istatistiği izlenimi yaratılmaz.
