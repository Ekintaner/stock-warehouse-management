# Yerel Stok ve Depo Yönetimi

Küçük bir hırdavat ve teknik malzeme işletmesinin birden fazla deposundaki stok ve depo hareketlerini yönetmek için yerel uygulama.

> **Durum:** Giriş/oturum, ürün/kategori/depo/raf ana kayıtları, stok giriş/çıkış belgeleri ve depolar arası transferler çalışır. Stok, belge, transfer ve hareket ekranları backend yetki kapsamı, audit, CSRF ve idempotent onayla korunur. Sayım, stok belgesi düzeltme/ters hareketi, tedarikçi CRUD, maliyetlendirme ve raporlama henüz uygulanmadı.

## Teknoloji ve doğrulanmış sürümler

- Node.js **24.14.0**, npm **11.9.0**
- React / React DOM **19.3.0**
- Vite **8.3.2**, `@vitejs/plugin-react` **6.1.2**
- TypeScript **6.0.3**
- Fastify **5.12.5**, `tsx` **4.23.15**
- Prisma ORM / Prisma Client / PostgreSQL adapter **7.10.0**
- PostgreSQL Node.js driver (`pg`) **8.23.1**
- ESLint / `typescript-eslint` **10.12.0 / 8.71.1**

Proje Node.js **24.14.0–24.x** aralığını ister. Bağımlılıklar lock dosyasında sabitlenmiştir.

### npm audit

2026-10-07 tarihli son yerel `npm audit` ve `npm audit --omit=dev` kontrolleri (transfer aşaması sırasında tekrarlandı) ikisi de 4 yüksek bulgu bildirdi; `concurrently`/`shell-quote` kaynaklı 2 kritik bulgu giderildi. Transfer için yeni paket eklenmedi. Açık bulgular Prisma CLI transitif bağımlılıklarındadır.

- Önceki `concurrently@10.0.5` kurulumu `shell-quote@1.9.0` sürümünü doğrudan ve sabit bağımlılık olarak getiriyordu. [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), `shell-quote >=1.8.4 <1.11.0` aralığını etkiliyor; düzeltme `1.11.0` ile yayımlandı (registry'deki güncel sürüm kontrolünde `1.12.0`). Açıklama token'ından sonra saldırgan kontrollü yeni satır içeren token aynı shell quote işlemine girdiğinde komut enjeksiyonu mümkün; mevcut dev komutları sabit olsa da paket kaldırıldı. Yerine Windows'ta shell kullanmadan Node.js alt süreçlerini başlatıp kapatan `scripts/dev.mjs` kondu. Böylece bu dev bağımlılığı ve bulgusu kaldırıldı.
- Kalan `deepmerge-ts@7.1.5`, Prisma `@prisma/config@7.10.0` alt bağımlılığıdır. [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) etkilenen sürümleri `<8.0.0` olarak belirtir; düzeltilmiş sürüm `8.0.0+` (registry kontrolünde güncel `8.0.2`). Saldırganın döngüsel object graph'ı `deepmerge` işlemine ulaştırması gerekir.
- Kalan `mysql2@3.15.3` de Prisma CLI `7.10.0` alt bağımlılığıdır. [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) `<3.22.0` aralığında clear-password/TLS sorunu; [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) `<=3.23.0` aralığında sıkıştırılmış paket çözme DoS'u bildirir. Buna göre advisory eşikleri sırasıyla `3.22.0+` ve `3.24.0+`; registry'de güncel `3.24.5` kontrol edildi.
- `npm audit --omit=dev` sonucu da bu Prisma CLI zincirini sayıyor: `@prisma/client@7.10.0` `prisma: *` peer dependency'sini `optional` olarak bildirir; kilit dosyasında Prisma CLI ve alt bağımlılıklar `devOptional` işaretlidir. Workspace/peer çözümlemesinde bu opsiyonel peer production-only audit grafiğinde kaldığından `--omit=dev` ile düşmemiştir. `npm ls prisma --omit=dev` de aynı peer yolunu gösterdi.
- Prisma 7 kararlı sürüm aralığının registry kontrolünde son sürüm `7.10.0`; CLI alt bağımlılıklarını bu aralıkta güvenli sürümlere çıkaran yeni bir Prisma sürümü yok. Audit'in önerdiği Prisma `6.19.3` major düşüşü mevcut Prisma 7 config/migration uyumluluğu doğrulanmadan yapılmadı. `deepmerge-ts` ve `mysql2` için override eklenmedi; Prisma CLI kaynaklı 4 yüksek bulgu açıktır ve yeni audit kontrolünde yeniden ele alınmalıdır.

## Ön koşullar

- Windows, macOS veya Linux üzerinde Node.js **24.14.0–24.x** ve npm **9+**.
- Web/API için boş yerel portlar: **5173** ve **3000**.
- Uygulama ve migration için localhost PostgreSQL; geliştirme DB adı `stock_warehouse_local`, test DB adı `stock_warehouse_test`.
- Şema doğrulama/Prisma Client üretimi PostgreSQL bağlantısı gerektirmez.

## Kurulum

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

PostgreSQL kurulu değilse [resmî Windows indirme sayfasından](https://www.postgresql.org/download/windows/) kendiniz kurun; proje bilgisayarınıza sistem aracı yüklemez. Bu çalışma alanında PostgreSQL 18.6 kurulum dizini ve çalışan `postgresql-x64-18` servisi bulundu; localhost 5432 portu bağlantı kabul ediyor.

### Yerel PostgreSQL rolleri ve veritabanları

Yalnızca localhost PostgreSQL sunucusunda iki ayrı rol ve proje veritabanını hazırlamak için aşağıdaki psql bootstrap betiğini kullanın. Yönetici parolası `-W` seçeneğiyle terminalde gizli istenir. Betik rolleri parolasız oluşturur; sonraki adımda `\password` komutları terminalde yeni rol parolalarını gizli ister. Hiçbir parola komut satırında veya SQL dosyasında yer almaz.

PowerShell'i proje kökünde açın; yönetici rolünüz `postgres` değilse `-U` değerini değiştirin. PATH değişikliği yapmadan PostgreSQL 18'in kurulum dizinindeki `psql.exe` kullanılır:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -W -f .\apps\api\prisma\setup-local-postgres.sql
```

Bootstrap eksik rolleri/veritabanlarını oluşturur, mevcut rolleri superuser olmayan `NOINHERIT` hâline getirir ve uygulama rolünün migration rolü üyeliğini kaldırır. Mevcut veritabanlarının sahipliğini/içeriğini kontrol eder; proje işareti olmayan dolu veya migration rolünün sahip olmadığı DB'de durur. Mevcut veriyi silmez ve DB sahipliğini değiştirmez. Var olan rollerin parolasını değiştirmez; parolası bilinmiyorsa pgAdmin'den yerel olarak değiştirin.

Bootstrap başarılı olduktan sonra etkileşimli psql oturumu açıp rol parolalarını terminalin gizli istemiyle belirleyin:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

psql içinde şu komutları girin; her parola iki kez gizli istenir:

```text
\password stock_warehouse_app
\password stock_warehouse_migrator
\q
```

URL parolalarını iki rolün parolasını gizli sorarak `.env`'ye yerleştirin:

```powershell
.\scripts\Configure-LocalDatabaseEnv.ps1
```

Script `.env`'yi ekrana yazdırmaz. `.env` ve `.env.*`, `.gitignore` tarafından hariç tutulur; gerçek parolaları sohbet veya kaynak dosyalarıyla paylaşmayın:

- `DATABASE_URL`: uygulama rolü → `stock_warehouse_local`
- `MIGRATION_DATABASE_URL`: migration rolü → `stock_warehouse_local`
- `TEST_DATABASE_URL`: uygulama rolü → `stock_warehouse_test`
- `TEST_MIGRATION_DATABASE_URL`: migration rolü → `stock_warehouse_test`

Migration'ları uyguladıktan sonra `npm run db:grants` komutuyla [grant-app-access.sql](./apps/api/prisma/grant-app-access.sql) her iki veritabanında migration rolü üzerinden çalıştırılır. Uygulama rolü tablo sahibi değildir; `StockMovement` için INSERT dışında yazma/TRUNCATE, `StockBalance` için hiçbir yazma, `AuditEvent` için UPDATE/DELETE/TRUNCATE yetkisi verilmez. Bu komut migration sonrası tekrar çalıştırılabilir; seed ön kontrolü de izinleri denetler.

## Geliştirme ortamı

Kök dizinden:

```powershell
npm run dev
```

Web arayüzü `http://127.0.0.1:5173`, API `http://127.0.0.1:3000` adresindedir. Vite göreli `/api` isteklerini localhost API'ye iletir. `GET /api/health` yalnızca API sürecinin çalıştığını bildirir; veritabanı sağlığını bildirmez.

## İlk yönetici hesabı ve giriş

Şema migration'ı ve uygulama izinleri hazırlandıktan sonra proje kökünde:

```powershell
npm run auth:create-admin
```

Komut kullanıcı adı ve görünen adı terminalden alır; en az 14 karakterli parola ve onayı **ekranda gösterilmeden** istenir. Parola scrypt (`N=2^17`, `r=8`, `p=1`, 16 bayt rastgele salt) ile saklanır. Varsayılan parola, kullanıcı veya seed hesabı oluşturulmaz. Komut yalnızca henüz yönetici hesabı yoksa ilk yöneticiyi ekler ve mevcut kullanıcıları değiştirmez. Komut etkileşimli bir terminal gerektirir.

Giriş ekranı `http://127.0.0.1:5173` üzerinde açılır. Oturum tarayıcıda `HttpOnly`, `SameSite=Strict` cookie ile tutulur; token'ın yalnızca SHA-256 özeti sunucuda saklanır. `APP_ORIGIN` varsayılan olarak yerel Vite adresidir. Yalnızca HTTPS kullanan yerel bir proxy arkasında `COOKIE_SECURE=true` yapın; varsayılan yerel HTTP ayarı `false` kalmalıdır. Giriş denemesi sınırı API süreci belleğinde tutulur ve süreç yeniden başlayınca sıfırlanır. Scrypt hesaplamaları en fazla iki eşzamanlı işlem ve sekiz bekleyen istekle sınırlıdır; kapasite dolarsa giriş `503` ile açıkça reddedilir.

## Doğrulama ve veritabanı komutları

```powershell
npm run db:validate
npm run db:generate
npm run build
npm run typecheck
npm run lint
npm test
```

`npm test` backend ve auth birim testlerini çalıştırır. Gerçek PostgreSQL testleri yalnızca ayrı entegrasyon komutuyla, uygulama rolü ve test veritabanı kullanılarak başlatılır:

```powershell
npm run db:migrate
npm run db:test:migrate
npm run db:grants
npm run test:db
```

DB grant komutu her iki projeye ayrılmış DB'de uygulama izinlerini ayarlar. Testler gerçek eşzamanlı çıkış, movement/bakiye trigger davranışı, kaynak/aşama tekilliği, CHECK/partial unique/FK, uygulama rolü izinleri ve stok belge API'sini sınar. Katalog ve stok regresyonları yalnızca ayrı `stock_warehouse_test` veritabanına yazar; onaylanan test hareketleri append-only olduğu için benzersiz, sentetik belgeler/hareketler test DB'de kalır. Geliştirme veritabanına test fixture'ı yazılmaz; başlangıç bakiyesi her zaman onaylı belge hareketiyle üretilir.

Geliştirme migration ve sentetik katalog seed'i:

```powershell
npm run db:migrate
npm run db:seed
```

Ayrı test veritabanına migration:

```powershell
npm run db:test:migrate
```

`db:test:migrate` yalnızca `TEST_MIGRATION_DATABASE_URL` ile `stock_warehouse_test` hedefine bağlanır. Test uygulama bağlantısı `TEST_DATABASE_URL` ile geliştirme bağlantısından ayrıdır. `migrate reset` veya `db push` kullanılmaz. Her iki migration komutu yalnızca boş veya bu projenin sahiplik işareti ve tam migration geçmişi bulunan hedefi kabul eder.

Seed tekrar çalıştırılabilir; sentetik kategori, ürün, iki depo, konum, tedarikçi ve eşik kayıtlarını hazırlar. Kullanıcı, parola veya stok hareketi oluşturmaz. Seed bakiye tablosuna yazmaz: hiç hareket almamış ürün-depo çiftinin miktarı sıfır kabul edilir; bir bakiye satırını oluşturan tek yol onaylanmış stok hareketi trigger'ıdır.

## Stok bakiyesi ve hareket defteri

`StockMovement` INSERT trigger'ı bakiye projeksiyonunu aynı PostgreSQL transaction'ında günceller ve negatif stok doğuracak işlemi reddeder. Backend servisleri bakiyeyi ayrıca artırıp azaltmamalıdır; `StockBalance` tablosunun tek yazım sahibi bu trigger'dır. Uygulama rolü tablo sahibi değildir, hareket UPDATE/DELETE/TRUNCATE ve bakiye yazma yetkisine sahip olmaz. Trigger hatası hareket ve bakiye değişikliğini birlikte rollback eder. Birden fazla depoyu etkileyen backend işlemleri depoları UUID sırasıyla kilitlemelidir.

Giriş/çıkış belgeleri için `/api/stock-documents`, depo bazlı salt okunur stok görünümü için `/api/stock`, hareket geçmişi için `/api/stock-movements` ve mevcut tedarikçileri seçmek için salt okunur `/api/suppliers` endpoint'leri vardır. Taslak en az bir farklı üründen oluşan satır içerir; miktar API'de decimal string'dir, pozitif ve en fazla üç ondalıklıdır; `EACH` tam sayı olmalıdır. Türkçe form virgüllü miktarı standart decimal string'e çevirir. Stok miktarı olmayan ürün-depo çifti `0.000` döner.

Yönetici bütün depolarda, depo sorumlusu yalnızca atanmış depolarında taslak oluşturup düzenleyebilir, iptal edebilir ve onaylayabilir. Görüntüleme rolü stok, belge ve hareketleri yetkili depolarında okuyabilir, yazamaz. Onay öncesi depo satırı ortak `FOR UPDATE` kilidiyle alınır; belge ve satırları da kilitlenip durum/ürün/aktiflik/sayım/bakiye tekrar kontrol edilir. Hareketler, belge durumu, idempotency sonucu ve audit aynı transaction'dadır. Onay `Idempotency-Key` ile tekrarlanabilir; aynı anahtar ve istek aynı sonucu döndürür, anahtarın farklı içerikle kullanılması 409'dur. Sıra numarası PostgreSQL sequence/BIGSERIAL ile verilir; boşluklar geçerlidir, `MAX + 1` kullanılmaz.

## Depolar arası transferler

`/transfers` ekranı taslak oluşturma/düzenleme/iptal, liste, detay, sevk, teslim alma ve yönetici geri dönüşünü kapsar. Geri dönüş yalnız **SHIPPED** durumunda yapılır; **RECEIVED** transfer için endpoint 409 döndürür ve arayüzde geri dönüş eylemi gösterilmez. Transfer API'si (`/api/transfers`) kaynak/hedef yetkisini backend'de denetler. Depo sorumlusu atanmış kaynak depoda taslak ve sevk işlemi; atanmış hedef depoda teslim işlemi yapabilir. Yalnızca yönetici geri dönüş yapabilir. Transferi iki uç depodan en az birine atanmış kullanıcı okuyabilir. `/api/transfer-warehouses` aktif depoların yalnız ID, kod ve adını seçim için döndürür; `/api/stock` yine istenen depoya göre yetki uygular.

Taslak stok değiştirmez. Sevk kaynak stoğu düşürür, teslim hedef stoğu artırır, SHIPPED geri dönüşü tam miktarı kaynak stoğa ekleyip hedef stoğu değiştirmeden transit miktarını kapatır. Hareketler kaynak transfer satırı/aşamasıyla `StockMovement` olarak aynı transaction'da yazılır; trigger bakiye güncellemesinin tek yazım yoludur. Yoldaki miktar `SHIPPED` transfer satırlarından türetilir ve mevcut stoktan ayrı gösterilir. Kısmi geçiş yoktur. Sevk/teslim/geri dönüş idempotency kapsamları ayrıdır; aynı anahtar/gövde güvenle tekrar edilebilir, farklı içerik 409 alır. Çok depo kilitleri sabit UUID sırasındadır; audit, durum ve movement'lar atomiktir.

Kapsam düzeltmesinden önce mevcut veriler yalnızca okundu: geliştirme veritabanında teslim sonrası dönüş kaydı yoktu; ayrı test veritabanında 21 tarihsel sentetik kayıt bulundu. Kayıtlar ve hareketleri korunmuştur. Yeni migration trigger ve yeni yazımlara `RECEIVED → RETURNED` yolunu kapatır; geçmiş satırları geriye dönük değiştirmez veya doğrulamaya tabi tutmaz.

## Katalog davranışı

Yönetici ürün, kategori, depo ve raf oluşturabilir, düzenleyebilir ve pasifleştirebilir. Depo sorumlusu ve görüntüleme rolü ürün/kategori kataloğunu okuyabilir; depo ve raf listesi/detayı yalnızca atanmış depolarla sınırlıdır. API liste ve detay yollarında aynı kontrolü yapar. Ürünler sunucu tarafında aranır, filtrelenir, sınırlı sayfalanır ve allowlist sıralaması kullanır.

SKU baş/son boşlukları temizlenip ASCII büyük harfe normalleştirilir (`[A-Z0-9][A-Z0-9._-]{0,63}`). Barkod metindir: baş/son boşluklar kırpılır, boş değer `NULL` olur, 1–64 görünür ASCII karakter kabul edilir, iç boşluk ve baştaki sıfırlar korunur. Ad en çok 180, açıklama en çok 1000 karakter; kategori/depo/raf kodu en çok 48 ve adları en çok 120 karakterdir. Ürün ID'si sabit kalır; SKU değişikliği geçmiş ilişkileri taşıyan Product kaydını yeniden kimliklendirmez. Hareket veya belge/transfer/sayım satırı geçmişi olan ürünün birimi değişmez.

Depo pasifleştirme transaction içinde depo satırını kilitler ve pozitif bakiye, taslak/sevk edilmiş transfer veya açık sayım varsa reddeder. Raflar depo içi benzersiz koda sahip yerleşim bilgileridir; raf bazında bakiye yoktur. Ana kayıt değişikliği ile alanları allowlist edilmiş audit olayı tek transaction'da yazılır; eski `updatedAt` sürümüyle gelen değişiklik 409 alır. Fiziksel silme API'si yoktur.

## Ücretsiz ve yerel çalışma

Ücretli servis, bulut hesabı, kredi kartı, özel alan adı, Docker, harici font/CDN, analitik veya AI servisi gerekmez. Projede AI modeli, chatbot, AI SDK'sı veya AI API'si kullanılmaz. PostgreSQL'in kurulumunu kullanıcı kendi makinesinde ve kendi yerel yetkileriyle yapar.

## Şu anda çalışanlar ve henüz uygulanmayanlar

Çalışma alanında giriş/oturum, katalog, stok bakiyesi, giriş/çıkış belgeleri, transferler ve hareket geçmişi vardır. Parola scrypt ile hash'lenir; oturum token'ı sunucuda hash'li saklanır; değiştirici isteklerde yerel origin ve oturuma bağlı CSRF token'ı doğrulanır. Katalog ana kayıtlarını yalnızca yönetici yönetir; stok belgesi ve transfer işlemlerinde depo/rol kapsamı backend'de uygulanır; görüntüleme rolü sadece okur. Stok değişikliklerinde belge/transfer/movement/balance/audit/idempotency işlemleri tek transaction ile yürür ve bakiye yalnızca trigger tarafından yazılır. Tedarikçi CRUD, kullanıcı/depo atama UI'sı, sayım, onaylı belge düzeltme, genel hareket tersleme, stok uzlaştırma ve raporlar henüz yapılmamıştır.

Yerel PostgreSQL 18.6 servisi ve loopback bağlantıları doğrulandı. Seed'deki ürün, kategori, depo, raf ve tedarikçi kayıtları test amaçlı sentetiktir; gerçek işletme verisi değildir. Seed kullanıcı, hareket veya bakiye satırı oluşturmaz. PostgreSQL regresyonları yalnızca `stock_warehouse_test` veritabanında çalışır. Onaylanan test hareketleri append-only oldukları için benzersiz test verileri olarak bu ayrı DB'de kalabilir; geliştirme veritabanına yazılmaz ve doğrudan bakiye yazımı kullanılmaz.
