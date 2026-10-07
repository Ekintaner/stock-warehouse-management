# Mimari taslak

## 1. İlkeler

Uygulama tek işletme için, yerel bilgisayarda çalışan modüler monolittir. Giriş/oturum, katalog ana kayıtları, giriş/çıkış belgeleri, stok görünümü, hareket geçmişi ve transferler uygulanmıştır; sayım ve raporlar henüz plan kapsamındadır. Frontend React/TypeScript/Vite, API Node.js/TypeScript/Fastify, kalıcı veri PostgreSQL; Prisma veri erişimi ve şema değişiklikleri için kullanılır. Frontend ve backend tek depoda npm workspaces olur. REST API sınırları modüllere göre düzenlenir; ayrı dağıtılan servis, mesaj kuyruğu, Kubernetes veya zorunlu Docker yoktur. Veri modeli Prisma ORM **7.10.0** ile oluşturulmuştur; PostgreSQL bağlantısı için aynı sürümlü `@prisma/client` ve `@prisma/adapter-pg` ile `pg` kullanılır. Prisma 7'nin `prisma-client` generator'ı özel çıktı dizini ve PostgreSQL driver adapter'ı gerektirir.

Prisma paketi Node.js 24 ve TypeScript 6.0.3 ile uyumlu kararlı sürüm olarak npm kaydından doğrulanmıştır. Bağımlılık sürümleri kök npm kilit dosyasında sabitlenmiştir.

## 2. Önerilen klasör yapısı

```text
/
  package.json                 # npm workspaces kökü
  apps/
    web/
      src/
        app/
        components/
        features/
        services/
    api/
      src/
        app.ts
        server.ts
        database/
          prisma.ts
          local-database-target.ts
        generated/
          prisma/                   # Prisma Client üretim çıktısı
        plugins/
        modules/
          auth/
          users/
          catalog/
          warehouses/
          inventory/
          transfers/
          counts/
          reports/
          audit/
        shared/
      prisma.config.ts
      prisma/
        schema.prisma
        migrations/
        seed.ts                   # Yalnızca sentetik demo kayıtları
  docs/
```

Kök workspace, `apps/web` ve `apps/api` paketlerini yönetir. Prisma şeması, config, migration ve seed dosyaları `apps/api/prisma/` altında; tek kontrollü Prisma istemcisi `apps/api/src/database/` altında bulunur. Generated client kaynak kontrolüne alınmaz, `npm run db:generate` ile yeniden üretilir. Modüller kendi route/handler, uygulama servisi, validasyon şeması ve veri erişim sorumluluğuna sahip olur. Stok yazımı tek bir inventory uygulama servisi/işlem sınırından geçer; modüller birbirlerinin tablolarına doğrudan ve kontrolsüz yazmaz.

## 3. Modül sınırları

- **auth/users:** Parola doğrulama, sunucu oturumu, rol ve depo atamaları.
- **catalog:** Ürün, SKU/barkod benzersizliği, kategori ve birimler.
- **warehouses:** Depo ve raf/konum yönetimi; pasifleştirme.
- **inventory:** Giriş/çıkış taslakları, onay, değiştirilemez hareket defteri, bakiye projeksiyonu ve idempotency uygulanmıştır. Onaylı belge düzeltme/ters hareket ve uzlaştırma henüz uygulanmamıştır.
- **transfers:** Transfer taslağı ve durum makinesi; tam sevk/teslim/geri dönüş hareketlerini inventory defterine transaction içinde uygular.
- **counts:** Sayım kilidinin açılması, satırların girilmesi ve farkın inventory üzerinden onaylanması.
- **reports:** Yetki kapsamlı stok, düşük stok, depo özeti, giriş/çıkış ve CSV sorguları.
- **audit:** Kritik yönetim/depo işlemleri için değiştirilemez olay izi.

Handler'lar HTTP kimlik doğrulama/validasyon/yanıt eşlemesini yapar. İş kuralları uygulama servislerinde tutulur. Veritabanı transaction'ı, eşzamanlılık kontrolü ve hareket/bakiye yazımları iş servisinin açıkça yönettiği birim-of-work içinde yapılır.

## 4. Veri modeli taslağı

İsimler ve ilişkiler mevcut Prisma şemasıyla eşleştirilmiştir. Auth/katalog ve stok giriş/çıkış servisleri uygulanmıştır; transfer, sayım ve raporlama servisleri sonraki aşamalardadır.

| Varlık | Önemli alanlar / ilişkiler |
|---|---|
| `User` | Kimlik, benzersiz giriş adı, parola hash'i, rol, aktiflik |
| `Session` | Rastgele oturum kimliği hash'i, kullanıcı, oluşturulma/son erişim/sona erme/iptal zamanları |
| `UserWarehouse` | Kullanıcı-depo ataması; tekil birleşik anahtar |
| `Product` | Benzersiz `sku`, nullable benzersiz `barcode`, ad/açıklama, kategori, birim, aktiflik |
| `Warehouse` | Kod/ad, aktiflik |
| `WarehouseLocation` | Depo, raf/konum kodu/adı, aktiflik ve stale-edit için `updatedAt` |
| `WarehouseProductSetting` | Depo-ürün, `minimumStock`; ürünün depo bazlı eşik değeri |
| `Supplier` | Ad, isteğe bağlı iletişim bilgileri, aktiflik |
| `StockDocument` | Taslak belge türü (giriş/çıkış), durum, depo, isteğe bağlı tedarikçi/neden, oluşturan |
| `StockDocumentLine` | Taslak belge, ürün, decimal miktar, isteğe bağlı konum/not |
| `Transfer` / `TransferLine` | Kaynak/hedef depo, durum, tam satırlar, sevk/teslim olayları; dönüş başlangıç durumu ve gerekçesi |
| `StockCount` / `StockCountLine` | Depo, açık/onaylı/iptal durumu, başlangıç/kapanış, sorumlu, sabit sistem miktarı, null olabilen sayılan miktar |
| `StockMovement` | Her biri tek bir gerçek FK kaynağına bağlı append-only defter satırı; ürün, depo, yön, pozitif miktar, birim snapshot'ı, tür, oluşturan, zaman ve varsa ters hareket |
| `StockBalance` | Ürün-depo çiftinin tek, güncel, negatif olamayan `numeric(18,3)` bakiyesi; bileşik birincil anahtar |
| `IdempotencyRecord` | Anahtar kapsamı, canonical request hash'i, sonuç kaynağı/yanıt referansı ve oluşturulma zamanı |
| `AuditEvent` | Aktör, eylem, hedef, zaman, istek/ilişki kimliği ve hassas olmayan değişiklik özeti |

### Veri modeli ve veritabanı invariants

- Kullanıcı rolleri `ADMIN`, `WAREHOUSE_MANAGER` ve `VIEWER` enum değerleridir. `Session.tokenHash`, ham oturum token'ı değil, benzersiz 64 karakterli SHA-256 özeti saklar. Seed kullanıcı veya parola oluşturmaz.
- Ürün kategorisi ve ürün/depo/konum/tedarikçi kodları fiziksel silme yerine pasifleştirme için `isActive` taşır. Kullanılmış kayıtlara giden FK'ler `RESTRICT` davranır; kullanıcı ilişkileri geçmiş hareket/denetim kayıtlarını silemez.
- SKU baş/son boşlukları temizlenip ASCII büyük harfe normalize edilir; 1–64 karakterlik izinli biçimi `[A-Z0-9][A-Z0-9._-]*` olur. Kategori/depo/raf kodları 1–48 karakter ve aynı ASCII karakter ailesiyle sınırlıdır. SKU benzersiz indeksi ve nullable barkod benzersiz indeksi veritabanı seviyesinde eşzamanlı çakışmaları engeller.
- Barkod metin olarak tutulur; boş/yalnız boşluk değeri `NULL`, baştaki sıfırlar ve anlamlı iç boşluklar korunur. Baş/son boşluklar kırpılır; 1–64 görünür ASCII karakter, büyük/küçük harfe duyarlı tam eşleşme politikası uygulanır.
- Ürün adı 180, açıklama 1000 karakteri geçemez. Kategori/depo/raf kodu en çok 48; bu kayıtların adları en çok 120 karakterdir. Ürün kimliği API'de değiştirilemez: SKU değişikliği aynı ID ve geçmiş FK ilişkilerini korur. Fiziksel silme endpoint'i yoktur.
- Pasif kategori yeni ürüne atanamaz; daha önce bağlı ürünlerin ilişkisi korunur. Herhangi bir movement veya stok belgesi/transfer/sayım satırı bulunan ürünün birimi değiştirilemez.
- Katalog okuma tüm rollere açıktır; depo/raf listesi ve detayı yönetici için tüm depolarda, diğer roller için yalnızca atanmış depo ID'lerinde çalışır. Katalog ana kayıt yazımı yalnızca yöneticidir; backend kontrolü UI gizlemesinden bağımsızdır. Her mutasyon audit olayını aynı Prisma transaction'ında yazar ve eski `updatedAt` ile düzenleme 409 döndürür.
- Depo pasifleştirme aynı transaction'da depo satırını `FOR UPDATE` ile kilitler; pozitif bakiye, taslak/sevk edilmiş transfer veya açık sayım varsa reddeder. Bu, mevcut `StockMovement` ve sayım tetikleyicilerinin depo satırı kilit protokolüyle aynıdır. Raf kodu yalnızca depo içinde benzersizdir; konumlar ayrı bakiye tutmaz.
- Raf/konum yalnızca belge satırında seçilebilen yerleşim bilgisidir. `StockBalance` anahtarı depo ve üründür; raf bazında ayrı miktar veya bakiyeyi paylaştırma yoktur.
- Ürün-depo minimum eşiği, bakiye, belge/transfer/sayım satırı ve hareket miktarları `numeric(18,3)` kullanır. Bakiye, eşik, sayım snapshot'ı ve sayım miktarı negatif olamaz; belge/transfer/hareket miktarı pozitif olmalıdır. Adet biriminin tam sayı olması, satırdaki birim ile ürün birimi eşitliği ve en fazla üç ondalık basamak stok belge API'sinde doğrulanır; farklı tabloların birim alanına bakan basit SQL `CHECK` yeterli değildir.
- Giriş/çıkış, transfer ve sayım numaraları ayrı `BIGSERIAL`/sequence değeridir; benzersiz artan numara `MAX + 1` hesabına bağlı değildir ve transaction rollback'lerinde boşluk kalması kabul edilir. Aynı stok belgesinde ve transferde ürün başına tek satır bileşik benzersizlikle korunur.
- Taslak giriş/çıkış belgesi bakiyeyi değiştirmez. Sadece onay anında, belge ve tüm satırları atomik transaction içinde tamamlanır. DB status/timestamp `CHECK` koşulları taslak, onaylı ve iptal edilmiş biçimleri tutarlı tutar. İptal yalnızca taslak belge için geçerlidir; onaylı belge/movement silinmez veya düzenlenmez.
- Belge onayı aynı kullanıcı/operasyon/idempotency key kombinasyonunu tekilleştirir; aynı içerikte yeniden gönderim kayıtlı yanıtı döndürür, farklı gövde 409 alır. Document number `BIGSERIAL` sequence ile atanır; sıra boşlukları normaldir.
- Giriş/çıkış onayı önce depo satırını ortak `FOR UPDATE` protokolüyle, sonra belgeyi ve ürün sıralı satırlarını kilitler. Depo/ürün aktifliği, açık sayım ve çıkış bakiyesi kilitlerden sonra yeniden okunur. Bakiye değişikliği doğrudan Prisma'dan değil, `StockMovement` INSERT trigger'ından gerçekleşir. Onay, audit ve idempotency yanıtı aynı transaction'da commit/rollback edilir.
- Read-only `/api/stock` tek bir yetkili depo için ürün bakiyesi sunar; olmayan balance satırı `0.000` olarak ifade edilir. `/api/stock-movements` ürün/depo/tarih/yön filtresi, kararlı sayfalama ve yetkili depo kapsamını uygular. `/api/suppliers` bu aşamada yalnızca mevcut tedarikçi seçim listesidir; tedarikçi CRUD yoktur.
- `/api/transfer-warehouses` seçim listesi yalnız aktif depoların ID/kod/ad alanlarını döndürür. `/api/transfers` liste/detail yetkisi yönetici için tüm kayıtlar, diğer roller için kaynak veya hedef depo ataması üzerindendir. Depo sorumlusunun oluşturma/sevk yetkisi kaynak atamasına, teslim yetkisi hedef atamasına bağlıdır; geri dönüş yalnız yöneticidir. `/api/stock` her istek için seçili deponun atamasını yeniden kontrol eder.
- `/api/stock` içinde `inTransitIncoming` ve `inTransitOutgoing`, yalnızca sorgulanan deponun `SHIPPED` TransferLine satırlarından türetilmiş decimal string'lerdir. Bu değerler `quantity` bakiyesine eklenmez ve ayrı değişebilir bakiye değildir. Transfer liste filtreleri kaynak/hedef veya iki uçtan biri depo, durum ve tarih aralığını destekler.
- Transfer kaynak/hedef depoları farklıdır. İstenen akış `DRAFT → SHIPPED → RECEIVED`, `DRAFT → CANCELLED` ve `SHIPPED → RETURNED` durumlarıdır; teslim sonrası dönüş desteklenmez ve API 409 döndürür. Taslak iptal edilebilir, sevk edilmiş kayıt normal iptal edilemez. Geri dönüş yalnızca yönetici tarafından ve zorunlu gerekçeyle yapılır. Yoldan geri dönüş kaynağa tam miktarı ekler, hedef stoğu değiştirmez ve transit miktarı kapatır.
- Uygulamadan önce test DB'sinde 21 adet `RETURNED`/`returnOrigin=RECEIVED` tarihsel test kaydı, geliştirme DB'sinde bu biçimde 0 kayıt bulundu. Geçmiş kayıtlar ve movement'lar olduğu gibi bırakıldı. 20261007200000 migration'ı status trigger'ında yeni `RECEIVED → RETURNED` geçişini yasaklar ve `NOT VALID` kontrolüyle aynı biçimde yeni kayıt eklenmesini önler; mevcut tarihsel kayıtlar doğrulanıp güncellenmez.
- Yoldaki miktarın tek doğruluk kaynağı `Transfer` durumu ile `TransferLine.quantity` birleşimidir: yalnızca `SHIPPED` transfer satırları yoldadır; teslim veya tam dönüş tamamlanınca yoldaki miktar sıfırlanır. Ayrı, düzenlenebilir bir yoldaki stok bakiyesi tutulmaz.
- Sayımın başlangıç bakiyesi snapshot olarak tutulur; `countedQuantity = NULL` henüz sayılmadığını ifade eder. Fark sayılan miktar eksi snapshot olarak türetilir. PostgreSQL partial unique index'i depo başına yalnızca bir `OPEN` sayım olmasını sağlar.
- Her `StockMovement` için gerçek kaynak FK'si olarak belge satırı, transfer satırı, sayım satırı veya ters çevrilen önceki hareketten tam olarak biri dolu olmalıdır. Hareket türü/evresi ile kaynak ve yön DB `CHECK`/trigger'larında eşleştirilir. Transfer satırı sevk, teslim ve yoldan dönüş için faz bazlı benzersiz hareket anahtarları kullanır; `RETURN_SHIPMENT`/`RETURN_RECEIPT` fazları yalnızca önceki kapsamdan kalan kayıtları okumak için şemada korunur, yeni uygulama akışında kullanılmaz. İlk sürümde giriş/çıkış hareketi yalnızca bir defa, aynı ürün/depo/birim ve tam miktarla ters çevrilebilir; genel ters hareket, transfer veya sayım hareketlerini hedeflemez.
- Stok belgesi/transfer/sayım başlık ve satır değişiklikleri SQL trigger'larıyla taslak/açık durumlarla sınırlandırılır. Transfer yalnızca taslak→sevk/iptal, sevk→teslim/geri dönüş ve teslim→geri dönüş geçişlerini yapabilir; terminal hareket kayıtları yeniden taslak yapılamaz. DB durum check'leri gerekli kullanıcı/zaman alanlarının durumla tutarlı olmasını ister.
- Migration, `StockMovement` için `UPDATE`, `DELETE` ve `TRUNCATE` işlemlerini reddeden trigger kurar; her kaynak FK'si silmeyi `RESTRICT` eder. `BEFORE INSERT` trigger'ı hareketin onaylı kaynak kaydı, ürün, depo, birim, miktar, yön ve evreyle eşleşmesini kontrol eder. `AFTER INSERT` trigger'ı, sabit `search_path` kullanan `SECURITY DEFINER` fonksiyonuyla `StockBalance`'ı aynı PostgreSQL transaction'ında günceller. Girişlerde pozitif delta UPSERT edilir; çıkışlarda mevcut bakiye yalnızca sonuç negatif olmayacaksa koşullu atomik `UPDATE` edilir. Negatif delta'yı UPSERT'in `EXCLUDED` satırında taşımak PostgreSQL `CHECK` kısıtını çatışma çözümünden önce tetikleyebileceği için bu yol kullanılmaz. **Bakiye tablosunun tek yazım sahibi bu trigger'dır.** Backend servisleri `StockBalance` tablosuna ayrıca INSERT/UPDATE/DELETE yapmaz; hareket INSERT'i ve trigger'ın bakiye projeksiyonu tek transaction içindedir. Trigger hatası transaction'ın hem hareketini hem bakiye değişikliğini geri alır.
- `stock_warehouse_app` migration ile tabloların sahibi olmaz. `grant-app-access.sql` bu role `StockMovement` için yalnızca INSERT; `StockBalance` için yalnızca SELECT verir ve hareket UPDATE/DELETE/TRUNCATE yetkisini reddeder. `AuditEvent` de uygulama rolü için ekle-sadece tablodur. Uygulama rolü bakiye yazamaz, trigger'ı değiştiremez/devre dışı bırakamaz veya tabloyu TRUNCATE edemez. `stock_warehouse_migrator` ayrı, superuser olmayan migration rolüdür; şema/tabloları sahiplenir ve uygulama sürecinde kullanılmaz. Migration/şema sahipliği rolü güvenilir yönetim kimliğidir; superuser olmayan uygulama rolü bu yetkiye sahip değildir.
- Stok movement `BEFORE INSERT` tetikleyicisi depo satırını `FOR UPDATE` ile kilitler ve ilgili açık sayım koşulunu kontrol eder; sayım açılış tetikleyicisi aynı depo satırını kilitler. Transfer durum güncellemesi iki depo satırını `LEAST/GREATEST` UUID sırasıyla kilitler; backend çok depo etkileyen tüm işlemlerde aynı sabit artan sıra ile depo kilitlerini movement eklemeden önce almalıdır. Veritabanı trigger'ı tek hareket başına depo kilidi sağlar; çok satırlı/çok depolu servis protokolünün yerini tutmaz.
- Audit JSON'una parola hash'i, ham oturum token'ı veya secret yazılmaz. Katalog audit yazıcısı yalnızca katalog alanlarının before/after özetini seçer; uygulama DB rolü AuditEvent için UPDATE/DELETE/TRUNCATE yapamaz. Audit kaydı hareket defterinin yerine geçmez.

### Taslak ile onaylanmış hareketin ayrımı

`StockDocument` ve satırları düzenlenebilir taslak veridir; taslaklar stok kaynağı değildir. Her onaylı belge satırı için tek `StockMovement` defter satırı oluşur. Transfer sevk/teslim/dönüş evreleri ve onaylı sayım farkları kendi gerçek kaynak satırına bağlı movement üretir. Movement insert trigger'ı defter satırıyla bakiye projeksiyonunu aynı transaction'da yazar; backend bakiye satırına doğrudan yazmaz. Seed kullanıcı/parola/hareket oluşturmaz ve bakiye satırı eklemez; henüz hareket görmemiş ürün-depo çifti sıfır bakiye kabul edilir. Hareketler değişmez; giriş/çıkış hatası yalnızca özgün movement'e bağlı, tam miktarlı bir ters movement ile düzeltilir. Transfer ve sayım düzeltmeleri kendi iş akışlarına aittir.

## 5. Stok yazımı ve transaction tutarlılığı

1. API yetkiyi ve belge geçişini doğrular; Prisma `Decimal` değerleri decimal string olarak alınıp verilir. Frontend/API JSON miktarları decimal string taşır; Prisma Decimal değerleri gelişigüzel JavaScript `number`'a dönüştürülmez. Binary floating-point stok hesabında kullanılmaz.
2. API transaction içinde miktar değiştirecek işlem ve sayım açma/kapatma öncesinde etkilenen `"Warehouse"` satırlarını `SELECT ... FOR UPDATE` ile kilitler. Birden fazla depo söz konusuysa UUID'leri sabit artan sıraya dizip aynı sırayla kilitler; bu ortak sıra deadlock riskini azaltır.
3. Kilit alındıktan sonra açık sayım koşulu ve bakiye yeniden okunur. Sayım açma işlemi de aynı depo satırı kilidini alır ve açık sayım durumunu oluşturur. Böylece sayım başlatma ile hareket başlatma veritabanı tarafından aynı kilit üzerinde sıralanır; sayım açıkken yeni miktar hareketine izin verilmez.
4. Depo başına açık sayımı ayrıca PostgreSQL kısmi benzersiz indeks/uygun constraint ile tekilleştirmek planlanır. Depo kapısı satırı her depo için daima mevcut olmalıdır. Her stok yazma yolu ve sayım açma/kapatma yolu aynı protokole uyar; uygulama DB rolü dışından yazım desteklenen iş akışı değildir.
5. `StockMovement` insert trigger'ı giriş delta'sını `INSERT ... ON CONFLICT ... DO UPDATE` ile, çıkış delta'sını ise `quantity + delta >= 0` koşullu atomik `UPDATE` ile uygular. Çıkışta bakiye satırı yoksa veya yetersizse hareket reddedilir. Depo satırı kilidiyle sıralanan eşzamanlı çıkışlar mevcut stoğu aşamaz; negatif sonuç üretecek movement insert'i ve tüm transaction geri alınır. Bu, `StockBalance` için tek yazım yoludur; hareketin eklenmesi başarılı olup trigger'ın bakiye yazımı başarısız kalamaz.
6. Tek transaction içinde idempotency sonucu, onaylı kaynak/durum geçişi, movement, trigger tarafından güncellenen bakiye ve audit event yazılır. Herhangi bir satırın iş kuralı veya constraint hatasında tümü rollback olur. Uygulama bağlantı bilgisi `DATABASE_URL`, migration rolü `MIGRATION_DATABASE_URL` kullanır; test hedefi için `TEST_DATABASE_URL` ve `TEST_MIGRATION_DATABASE_URL` geliştirme hedefinden ayrıdır. Prisma migrate için yalnızca migration URL'si kullanılır; API ve seed tablo sahibi olmayan uygulama rolüyle bağlanır.

Tüm miktarlar decimal `numeric(18,3)` tipinde saklanır. Birim hassasiyeti uygulama validasyonunda (adet tam sayı; ölçü birimleri en çok üç ondalık) denetlenir. PostgreSQL hedef scale üzerinde fazla ondalığı yuvarlayabildiğinden API, veritabanına yazmadan önce adet kesrini ve üçten fazla basamağı reddetmelidir. Veritabanı hareket ve bakiye invariants'larını trigger/check ile korur; kullanıcı rolü/depo yetkisi, her durum geçişinin izin verilen önceki durumu, ürün-birim eşleşmesi ve sayım kilidi gibi çapraz iş kuralları sonraki uygulama servisinde doğrulanacaktır.

### Sayım ve depo eşzamanlılığı

Migration'daki PostgreSQL trigger'ları sayım oluşturma/güncelleme ve stok hareketi insert'inde ilgili depo satırını `FOR UPDATE` ile kilitler; hareket trigger'ı sayım satırı olmayan hareketlerde açık sayımı da denetler. Bu DB kapısı sayım ile stok hareketinin aynı depo kilidi üzerinde sıralanmasına yardım eder. Üst seviye servisler aynı transaction'da işlemin etkileyeceği tüm depoları önceden, UUID'leri artan sırada kilitlemelidir; bu, birden fazla depoyu etkileyen transferlerde ortak deadlock azaltma protokolüdür. Sayım satır snapshot'ının kilit alındıktan sonra okunması ve durum geçişinin hareketlerle atomik yazılması servis katmanında tamamlanacaktır; bu servis henüz uygulanmış değildir.

### Yerel DB sınırı ve uygulanma durumu

Prisma config ve migration/seed araçları `apps/api` altında, tek kök `.env` dosyası Prisma CLI için `dotenv/config`, API çalışma süreci için Node `--env-file-if-exists` ile yüklenir. `DATABASE_URL` yalnız `localhost`, `127.0.0.1` veya `::1` üzerindeki, `public` şemalı `stock_warehouse_local` veritabanını kabul eder. Migration komutu önce bağlantı hedefini ve boş DB/proje marker'ını denetler; boş olmayan ve marker taşımayan veritabanında durur. `migrate deploy` kullanılır; reset veya `db push` akışı yoktur.

İlk migration ve çıkış bakiyesi düzeltmesini içeren ikinci migration, yerel `stock_warehouse_local` ile ayrı `stock_warehouse_test` veritabanlarına uygulanmıştır. `stock_warehouse_app` rolünün izinleri her iki hedefte kurulmuş; katalog seed'i geliştirme veritabanında iki kez çalıştırılarak çoğalmadığı doğrulanmıştır. PostgreSQL entegrasyon testleri stok invariants ve ilk yönetici advisory-lock davranışı dâhil dokuz senaryoyu yalnızca test veritabanında doğrular. Yönetici komutu `pg_advisory_xact_lock` için void sonucu deserialize etmeyen `$executeRaw` kullanır; advisory lock ve korunan user kontrol/insert işlemi aynı Prisma transaction'ında kalır. Prisma CLI alt bağımlılıkları için açık audit bulguları README'de kayıtlıdır. Bu DB doğrulaması kullanıcı yönetimi CRUD veya stok işlem API'lerinin uygulandığı anlamına gelmez.

### Uzlaştırma

Defter, onaylı hareketlerin değiştirilemez kaydı; bakiye ise hızlı sorgu için güncellenen projeksiyondur. Her ikisi aynı PostgreSQL transaction'ında yazılır. Uzlaştırma sorgusu her ürün/stok hesabı için ledger satırlarının toplamını bakiye projeksiyonuyla kıyaslar. Fark, alarm/operasyon hatası olarak görünür ve denetim iziyle incelenir; kayıtlar sessizce yeniden yazılmaz. Gerekirse yönetici onaylı ve açıklamalı yeni düzeltme/ters hareketi açar.

## 6. İstek tekrarları ve idempotency

Stok değiştiren onay endpoint'leri istemciden idempotency anahtarı alır. Anahtar; kullanıcı/işlem türü gibi tanımlı kapsam içinde benzersizdir. Canonical, normalize edilmiş istek gövdesinin hash'i saklanır. Aynı anahtar ve hash tekrarında ilk başarılı sonucun referansı/yanıtı döner, ikinci hareket yazılmaz. Aynı anahtar farklı hash ile gelirse HTTP conflict eşdeğeri iş hatası verilir. Anahtar kaydı ve hareketler aynı transaction içinde olmalıdır; başarısız transaction anahtarı başarılı sonuç gibi tüketmemelidir. Benzersizlik constraint'i eşzamanlı aynı anahtar isteklerini çözer.

## 7. Oturum ve güvenlik

- Parolalar Node.js `scrypt` (N=2^17, r=8, p=1, 16 bayt rastgele salt) ile hash'lenir; düz metin saklanmaz. OWASP Argon2id'yi tercih eder; scrypt'i Argon2id kullanılamıyorsa alternatif sayar. Bu sürümde scrypt, Node.js'in kararlı built-in KDF API'siyle harici/native bağımlılık eklemeden kullanılabilir; Node 24.14'ün built-in Argon2 API'si **Release Candidate (Stability 1.2)** olduğundan henüz kararlı API değildir ve buna geçilmedi. Önceki N=2^15 özeti desteklenir ve başarılı girişte güncel parametrelere yeniden hash'lenir.
- Node'un scrypt `maxmem` sınırı güncel parametrelerde 192 MiB olarak ayarlanır (yaklaşık `128*N*r` gereksiniminin üzerinde pay bırakır). Süreçte en fazla iki KDF paralel çalışır ve en fazla sekiz iş sırada bekler; sıra dolunca API açık `503` döndürür. Karşılaştırma eşit uzunluklu türetilmiş anahtarlara `timingSafeEqual` ile yapılır; kullanıcı bulunmadığında da dummy hash doğrulanır.

Parola parametrelerinin kaynağı: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), Node.js v24 [Argon2 API kararlılık düzeyi](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback), [scrypt `maxmem` sınırı](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) ve [`timingSafeEqual`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptotimingsafeequala-b) belgeleri.
- Oturum sunucuda tutulur. Tarayıcıda token yalnızca `HttpOnly; SameSite=Strict; Path=/api` cookie'dedir; veritabanında SHA-256 özeti saklanır. Oturum 12 saat sonra sona erer; çıkışta iptal edilir. `Secure` yerel HTTPS proxy kullanımı için `COOKIE_SECURE` ayarıyla açılır.
- Cookie tabanlı değiştirici istekler katı `APP_ORIGIN` kontrolünden geçer; oturumlu çıkış için HMAC tabanlı, oturuma bağlı CSRF token'ı ayrıca gerekir. API yalnızca loopback üzerinde dinler, Vite aynı-origin proxy sağlar; CORS wildcard kullanılmaz.
- Giriş denemeleri uygulama sürecinde kullanıcı+adres başına 15 dakikada 5, adres başına 20 başarısız denemeyle sınırlıdır. Başarılı ve olmayan kullanıcı girişleri aynı genel hata yanıtını kullanır.
- Her istekteki backend yetki yardımcıları ADMIN, WAREHOUSE_MANAGER ve VIEWER rollerini; yönetici kapsamını ve depo atamasını denetler. Stok giriş/çıkış yazımı yöneticiye ve atanmış depo sorumlusuna açık, görüntüleme rolüne kapalıdır; okuma endpoint'leri depo erişim kapsamını uygular.
- API girdileri şemayla doğrulanır; SQL için Prisma parametreli sorguları kullanılır. CSV hücreleri formül enjeksiyonuna karşı güvenli dışa aktarılır.

## 8. API ve hata yönetimi

Auth endpoint'leri `POST /api/auth/login`, `GET /api/auth/session` ve CSRF korumalı `POST /api/auth/logout` şeklindedir. Katalog rotalarına ek olarak belge API'si `GET/POST /api/stock-documents`, `GET/PATCH /api/stock-documents/:id`, `POST /:id/cancel` ve `POST /:id/approve`; read-only stok ve hareket endpoint'leri `GET /api/stock` ile `GET /api/stock-movements` şeklindedir. Mevcut tedarikçiler seçim için `GET /api/suppliers` ile listelenir.

Yanıtlar sabit, makinece okunabilir hata kodu ve kullanıcıya uygun Türkçe mesaj içerir. En azından doğrulama, yetkisiz, bulunamadı, durum çakışması, yetersiz stok, idempotency anahtarı çakışması ve beklenmeyen sunucu hataları ayrıştırılır. Beklenmeyen hata loglanır ve correlation/request ID ile izlenir; iç stack trace istemciye verilmez. Beklenen iş kuralı başarısızlıkları açıkça döndürülür; sessiz varsayılan veya başarı gibi görünen fallback kullanılmaz.

## 9. Raporlama ve demo verisi

Raporlar erişim kapsamını backend sorgusunda uygular; sayfalama ve filtre parametreleri doğrulanır. CSV çıktısı da aynı veri erişim sınırına uyar. Demo seed verisi sentetiktir, gerçek kişi/işletme verisi içermez ve arayüzde demo olduğu açıkça belirtilir. Üretilmiş başarı oranı veya gerçekmiş gibi sunulan kullanıcı/işlem sayacı kullanılmaz.
