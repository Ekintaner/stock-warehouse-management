# Uygulama planı

Bu plan numaralı aşamaları korur. Her aşama tamamlanmış özellik iddiası değildir; çıktılar ve doğrulama koşulları geliştirme sırasında yerine getirilmesi gereken hedeflerdir. Aşama 3'ün oturum altyapısına bağlı `3.1` ana-kayıt teslimatı, stok modüllerine geçmeden önce ayrı kapsam olarak tamamlanmıştır; Aşama 4–8 numaraları ve kapsamı değiştirilmemiştir.

## Aşama 1 — Yerel iskelet ve karar doğrulaması (**tamamlandı: 2026-10-05**)

**Amaç:** Araç zincirini desteklenen güncel kararlı sürümler üzerinden doğrulamak ve yerel geliştirme temelini kurmak.

**Çıktılar:**
- [x] Tek depo içinde `apps/web` ve `apps/api` npm workspaces.
- [x] React/strict TypeScript/Vite frontend, TypeScript/Fastify API başlangıç yapısı ve `/api/health`.
- [x] Web geliştirme proxy'si, localhost dinlemesi, `.env.example` içindeki API portu ve birlikte geliştirme komutu.
- [x] Build, typecheck, lint ve backend test komutları; `package-lock.json`.
- [x] Sürümler resmi Node.js sürüm sayfası ve npm registry üzerinden kontrol edilip uyumlu kararlı sürümler olarak sabitlendi.

**Doğrulama:**
- [x] İlk kurulum kontrolünde bağımlılıklar resmi npm registry üzerinden kuruldu ve o tarihteki audit sıfır bulgu bildirdi; güncel audit durumu README'de ayrıca kayıtlıdır.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` ve `npm test` başarılı; iki Fastify inject testi geçti.
- [x] Web ve API yerel geliştirme sunucuları birlikte başlatıldı; tarayıcıda başlangıç ekranı ve API'ye erişilebilir durumu doğrulandı.
- [x] Bilinmeyen API rotasının 404 yanıtı test edildi; health endpoint'i yalnızca API sürecini bildiriyor.
- [x] `.env` ve yerel yapılandırma Git dışında tutuluyor; gerçek secret eklenmedi.

Yerel PostgreSQL bağlantısı, veritabanı kurulumu, Prisma şeması ve migration'lar bu aşamanın parçası değildir; sonraki veri modeli aşamasına bırakılmıştır.

## Aşama 2 — Şema ve veritabanı hazırlığı

**Durum:** Veri modeli ve yerel veritabanı hazırlığı doğrulandı. İki migration geliştirme ve ayrı test veritabanlarına uygulandı; kullanıcı yönetimi, CRUD ve stok işlem servisleri bu aşamanın dışında kaldı.

**Amaç:** Katalog, depo, kullanıcı, stok taslakları ve defter için temel veri modelini kurmak.

**Çıktılar:**
- [x] `apps/api/prisma/schema.prisma`, Prisma 7 config ve ilk PostgreSQL migration dosyası.
- [x] Kullanıcı/oturum/atama, ürün/kategori, depo/konum, tedarikçi, depo-ürün eşiği, bakiye, belge, transfer, sayım, hareket, idempotency ve audit modeli.
- [x] Veri silme, miktar `CHECK` koşulları, hareket kaynağı doğrulama, değiştirilemez defter, negatif bakiye, sayım partial unique index'i ve stok bakiyesi trigger'ı için SQL migration kuralları.
- [x] Yalnızca yerel ve bu projeye ayrılmış `stock_warehouse_local` veritabanını kabul eden preflight komutları; boş olmayan tanımsız hedefte durma koruması.
- [x] Uygulama ve migration bağlantılarını ayırma; `stock_warehouse_test` için bağımsız migration config'i ve yerel hedef ön kontrolü.
- [x] Bakiye trigger'ını tek yazım yolu olarak belirleme; uygulama rolü için bakiye/defter yetki daraltma SQL'i ve seed'de bakiye yazımını kaldırma.
- [x] Yerel roller/veritabanları için mevcut veriyi koruyan psql bootstrap ve parolaları gizli alarak `.env` kuran PowerShell yönergesi.
- [x] Uygulama rolüyle çalışacak PostgreSQL entegrasyon testleri ve ayrı `test:db` komutu.
- [x] Kullanıcı/parola/hareket veya doğrudan bakiye yazmayan sentetik demo katalog seed'i; hareketsiz stok sıfır kabul edilir.
- [x] İlk migration ve çıkış bakiyesi düzeltme migration'ı, yalnızca localhost üzerindeki iki ayrılmış veritabanına uygulandı.
- [x] Uygulama rolü izinleri iki veritabanında uygulandı; uygulama rolü tablo sahibi veya migration rolü üyesi değildir.

**Doğrulama:**
- [x] `npm run db:validate` başarılı; `npm run db:generate` Prisma Client'i üretti.
- [x] Migration SQL'i bağlantı olmadan Prisma `migrate diff --from-empty` ile üretildi ve PostgreSQL'e yazma yapılmadan proje migration dosyasına kaydedildi.
- [x] Yerel DB preflight'ının uzak veya yanlış adlı veritabanını reddetmesi için birim testleri eklendi.
- [x] Geliştirme ve test DB adlarının ayrılması için URL hedefi birim testi; `.env` placeholder'ları ve `.gitignore` kuralı mevcut.
- [x] Migration'lar geliştirme ve ayrı test veritabanlarına uygulandı; stok CHECK/partial-index/trigger kuralları PostgreSQL'de sınandı.
- [x] Sentetik geliştirme seed'i iki kez çalıştırıldı; katalog sayıları aynı kaldı, kullanıcı/hareket/bakiye oluşturulmadı.
- [x] FK kaynak koruması, miktar kuralları, negatif stok rollback'i, movement UPDATE/DELETE/TRUNCATE reddi, doğrudan bakiye yazımı ve trigger devre dışı bırakma yetkisi test edildi.
- [x] Uygulama rolüyle dokuz gerçek PostgreSQL entegrasyon testi geçti; eşzamanlı stok çıkışı ve ilk yönetici oluşturma kilidi ayrı bağlantılarla doğrulandı.
- [x] SKU/barkod API normalizasyonu ve DB benzersizlik davranışı Aşama 3.1 ayrı PostgreSQL regresyon testinde doğrulandı.

## Ara verme notu — 2026-10-06 maliyet kontrolü

**Tamamlanan aşamalar:** Aşama 1 yerel web/API iskeleti; Aşama 2 Prisma veri modeli, iki yerel migration, uygulama rolü izinleri ve sentetik seed doğrulaması. Maliyet incelemesinde proje dosyalarında ücretli API, bulut hizmeti, üçüncü taraf kimlik/e-posta sağlayıcısı, dış font/CDN veya ücretli servis gerektiren bir bağımlılık saptanmadı. Kök ve workspace doğrudan bağımlılıklarının beyan edilen lisansları MIT, Apache-2.0 veya BSD-2-Clause; ayrı lisans yükümlülükleri ve transitif bağımlılıklar bu maliyet kontrolünde tam lisans denetiminden geçirilmedi.

**Tarihsel devam notu (2026-10-06):** Bu not yazıldığı sırada uygulama geliştirmesi yürütülmüyordu ve SKU/barkod PostgreSQL testleri yoktu. Aşağıdaki Aşama 3.1 bu test boşluğunu kapatır; Prisma CLI audit bulguları ise açık kalır. VS Code oturumunun sağlayıcı, abonelik, kredi/kota veya API kullanım ayarları proje dosyalarından doğrulanamaz; uzantı listesinde bilinen adlarla eşleşen bir AI uzantısı bulunamadı, bu ücretsiz kullanım kanıtı değildir.

**Tarihsel devam notu (2026-10-06):** Bu maliyet kontrolünden sonra Aşama 3.1 ana-kayıt teslimatı tamamlandı. O tarihte Aşama 4 henüz başlatılmamıştı; 2026-10-07 stok giriş/çıkış teslimatı aşağıda kayıtlıdır.

## Aşama 3 — Oturum, rol ve depo yetkilendirmesi

**Durum:** Tamamlandı (2026-10-06). Prisma'da mevcut User/Session/UserWarehouse şeması kullanıldı; yeni migration, şema reset'i veya stok verisi değişikliği yapılmadı.

**Amaç:** Yerel kullanıcı oturumu ve sunucu tarafında yetki sınırlarını kurmak.

**Çıktılar:**
- [x] Node.js scrypt (N=2^17, r=8, p=1, 16 bayt rastgele salt) ile parola hash'i; sunucu oturum kaydı, SHA-256 token özeti, HttpOnly/SameSite cookie, 12 saat sona erme ve çıkışta iptal.
- [x] Oturuma bağlı CSRF doğrulaması ve katı yerel `Origin` denetimi; dar same-origin Vite proxy kullanımı, CORS wildcard yok.
- [x] Kullanıcı+adres başına 15 dakikada 5, adres başına 20 başarısız giriş sınırı (uygulama belleğinde).
- [x] ADMIN, WAREHOUSE_MANAGER ve VIEWER için backend rol/depo yetki yardımcıları.
- [x] İlk yöneticiyi varsayılan parola olmadan oluşturan gizli parola girişli `npm run auth:create-admin` komutu.
- [x] Türkçe giriş, oturum bilgisi ve çıkış ekranı; parola veya CSRF token'ı kalıcı tarayıcı depolamasına yazılmaz.

**Doğrulama:**
- [x] Başarılı girişin yeni rastgele oturum üretmesi; CSRF'siz çıkışın reddi ve çıkış sonrası oturumun geçersizliği auth birim testleriyle doğrulanır.
- [x] Beklenmeyen/eksik Origin reddi, scrypt salt/hash ve giriş deneme sınırı test edilir.
- [x] Depo sorumlusu atanmamış depoda, görüntüleyici mutasyonda reddedilir; yönetici depo kapsamını aşabilir (backend yardımcı testleri).
- [x] Hash yanıt gövdesine girmez; cookie HttpOnly ve SameSite=Strict; hata mesajı parola/oturum bilgisi içermez.
- [x] İlk yönetici advisory-lock çağrısı gerçek test veritabanında Prisma raw execution ile doğrulandı; yarış ve yeniden çalıştırma mevcut hesabı değiştirmez.
- [x] Tarayıcıda giriş ekranı ve hatalı kimlik bilgisi yanıtı doğrulandı; başarılı giriş/oturum/çıkış akışı test deposu ile API inject testinde doğrulandı. Gerçek kullanıcıyla tarayıcıdan başarılı giriş/çıkış, varsayılan yönetici hesabı oluşturulmaması ve ilk hesabın kullanıcı tarafından gizli girişle oluşturulması nedeniyle bu oturumda çalıştırılmadı.

## Aşama 3.1 — Ürün, kategori, depo ve raf ana kayıtları

**Durum:** Tamamlandı (2026-10-06). Aşama 3'ün auth/CSRF altyapısı kullanıldı; ek migration yalnızca ürün açıklaması ve raf `updatedAt` alanını ekler. Geliştirme ve ayrı test veritabanına `migrate deploy` ile uygulandı; reset veya `db push` yapılmadı.

**Çıktılar:**
- [x] Yönetici ürün/kategori/depo/raf ana kayıtlarını oluşturur, düzenler ve pasifleştirir; hiçbir fiziksel silme endpoint'i yoktur. Ürün ID'si sabit kalır; SKU değişikliği kimliği ve geçmiş FK'leri değiştirmez.
- [x] Ürün listesi arama/kategori/aktiflik filtresi, 1–100 sayfa boyutu ve allowlist kararlı sıralama sunar; kategori/depo listeleri sayfalanır. SKU ve barkod benzersizliği veritabanı unique indeksleriyle korunur.
- [x] SKU ASCII büyük harf ve `[A-Z0-9][A-Z0-9._-]{0,63}`; barkod boşsa `NULL`, baştaki sıfır ve iç boşluk korunur, görünür ASCII uzunluğu 1–64. Ürün adı/açıklaması ve kod/ad sınırları doğrulanır.
- [x] Pasif kategori yeni ürüne atanmaz; ürünün hareket/belge/transfer/sayım geçmişinde birim değişikliği 409 ile reddedilir. Güncelleme `updatedAt` sürümüyle stale-edit kontrolü yapar.
- [x] Depo ve raf liste/detayları aynı backend kapsamını uygular: yönetici tüm depoları, diğer roller yalnızca atanmış depoları görür. Yazma yalnızca yöneticidir; CSRF/Origin kontrolleri yürürlüktedir.
- [x] Depo pasifleştirme aynı transaction'da movement/sayım trigger'larıyla ortak `Warehouse FOR UPDATE` kilidini alır; pozitif bakiye, taslak/sevk edilmiş transfer ve açık sayımda işlemi reddeder.
- [x] Her ana kayıt mutasyonu hassas olmayan before/after audit özetiyle aynı transaction'da yazılır; audit başarısızlığında iş değişikliği geri alınır. `AuditEvent` uygulama rolü için ekle-sadece durumuna getirildi.
- [x] Giriş kartı sade uygulama kabuğuna çevrildi; yalnızca Ürünler, Kategoriler ve Depolar gezinmesi vardır. Stok miktarı veya henüz uygulanmayan modül menüsü eklenmedi.
- [x] `20261006020000_catalog_master_data` migration'ı `Product.description` ve `WarehouseLocation.updatedAt` ekler; geliştirme ve test DB'de uygulanmıştır.

**Doğrulama:**
- [x] `npm run build`, `npm run typecheck`, `npm run lint` ve `npm test` başarılı; auth dahil 18 birim testi geçti.
- [x] `npm run test:db`: 9 PostgreSQL testi geçti, ilk yönetici regression testi test DB'de mevcut yönetici bulunduğu için güvenle atlandı; başarısız test yok. Katalog testi gerçek test DB'de auth/CSRF, roller, atama kapsamı, SKU/barkod/null, eşzamanlı unique, stale edit, geçmişte birim kilidi, pasif kategori, depo/raf eşleşmesi, pasifleştirme kilit kontrolleri ve audit rollback'i doğrular. Pozitif stok fixture'ı movement trigger'ıyla aynı transaction'da oluşturulup rollback edilir.
- [x] Yerel tarayıcıda mevcut gerçek yönetici oturumuyla katalog liste/filtre/detay, form görüntüleme, depo/raf ve yenileme/geri akışı incelendi. Geliştirme verisini değiştirmemek için create/edit formu gönderilmedi; mutasyonlar ayrı test DB'de API testiyle çalıştırıldı. Kullanıcı kendi hesabıyla son yazma akışını kontrol edebilir.
- [x] `npm audit` ve `npm audit --omit=dev` ikisi de 4 yüksek Prisma CLI transitif bulgusu bildirdi; yeni paket/override eklenmedi. `npm audit fix --force` çalıştırılmadı. Açık advisory listesi ve uyumlu major sürüm bulunmaması README'de kayıtlıdır.

**Tarihsel sınır (2026-10-06):** Aşama 4 stok defteri ve giriş/çıkış, Aşama 5 transfer, Aşama 6 sayım, Aşama 7 operasyonel web iş akışları ve Aşama 8 raporlama henüz başlatılmamıştı.

## Aşama 4 — Stok giriş/çıkış belgeleri ve stok görünümü

**Durum:** İstenen giriş/çıkış kapsamı tamamlandı (2026-10-07). Var olan Prisma şeması, `StockMovement` trigger'ı ve DB rol izinleri kullanıldı; yeni migration gerekmedi. Mevcut auth, katalog ve audit davranışları korundu.

**Çıktılar:**
- [x] Giriş/çıkış taslak oluşturma, stale-edit kontrollü düzenleme, taslak iptali, belge liste/detay.
- [x] Miktarlar decimal string olarak API'ye alınır; en fazla üç ondalık basamak, pozitif değer ve `EACH` için tam sayı kuralı doğrulanır. Aynı ürüne ikinci satır reddedilir.
- [x] Yönetici her depoda; depo sorumlusu yalnızca atanmış depoda belge oluşturur/düzenler/iptal eder/onaylar. Görüntüleme rolü ve diğer depolar için yazma reddedilir. Okuma kapsamı liste, detay, stok ve hareket yollarında backend'de korunur.
- [x] Onayda ortak depo kilidi, belge kilidi ve sıralı satır kilitleri alınır; aktif depo/ürün, açık sayım ve çıkış bakiyesi tekrar doğrulanır. Çok satırlı hareketler `StockMovement` INSERT trigger'ından geçer; backend `StockBalance` yazmaz.
- [x] Belge durumu, append-only hareketler, idempotency sonucu ve audit tek transaction'dadır. Kullanıcı/operasyon/idempotency-key unique sınırı, aynı istek için kayıtlı yanıtı; farklı içerik için 409'u sağlar. Belge numarası `BIGSERIAL` ile üretilir; sıra boşlukları normal kabul edilir.
- [x] Depo bazlı read-only stok ekranı eksik bakiye satırını `0.000` gösterir. Hareket geçmişi ürün/depo/tarih/yön filtreleri ve sunucu sayfalamasıyla belge ve işlem yapan bilgisini gösterir.
- [x] Mevcut aktif tedarikçiler giriş formunda seçim için listelenir; tedarikçi CRUD eklenmedi. Transfer, sayım, maliyetlendirme, rapor dashboard'u, onaylı belge düzeltme/ters hareket ve fiziksel silme endpoint'i kapsam dışıdır.

**Doğrulama ve anlamlı testler:**
- [x] Ayrı test DB'de taslak bakiye üretmez; çok satırlı giriş/çıkış, yetersiz çıkışın tümüyle rollback'i, decimal/Adet doğrulaması, pasif ürün/depo ve açık sayım reddi doğrulandı.
- [x] Yetki/atama, CSRF, taslak düzenleme ve iptal, stale edit, onaylı belge düzenleme reddi, belge/stok/hareket kapsamı doğrulandı.
- [x] Aynı belge eşzamanlı çift onayında tek movement seti ve aynı sonuç; aynı anahtar farklı içerikte 409; iki ayrı çıkış belgesinin eşzamanlı onayında negatif olmayan bakiye doğrulandı.
- [x] Audit trigger hatasında belge durumu, movement, idempotency ve bakiye transaction rollback'i doğrulandı.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:validate` ve tam `npm run test:db` başarılı. PostgreSQL: 10 geçti, 1 atlandı, 0 başarısız; mevcut yönetici test verisini korumak için ilk-yönetici senaryosu atlandı.
- [x] Ayrı PostgreSQL stok regresyonu benzersiz sentetik fixtures kullanır ve onaylı test movement'ları append-only olduğundan bunlar yalnızca `stock_warehouse_test` içinde kalabilir. Geliştirme DB'ye stok/test verisi yazılmadı.
- [x] Tarayıcıda stok ekranı, giriş/çıkış listeleri ve taslak formları açıldı; ürün seçimi, mevcut stok bilgisi ve virgüllü miktar girişi kontrol edildi. Hiçbir form gönderilmedi; gerçek kullanıcıyla belge oluşturma/onay akışı bu nedenle tarayıcıda uygulanmadı.
- [x] 2026-10-07 tarihli `npm audit` ve `npm audit --omit=dev` yine 4 yüksek bulgu verdi; Prisma CLI zinciri açık kaldı. Zorlayıcı fix/override veya yeni bağımlılık eklenmedi.

**Kalan işler:** Aşama 5 transfer ve Aşama 6 sayım başlamadı. Aşama 4'teki onaylı belge tersleme/düzeltme ve ledger-bakiye uzlaştırma da bu talebin kapsamı dışındadır; uygulanmış gibi sayılmaz.

## Aşama 5 — Depolar arası stok transferi

**Durum:** Transfer backend'i, ayrı PostgreSQL regresyonları ve arayüz uygulandı (2026-10-07). Mevcut Prisma modelleri, enum'lar, hareket aşaması benzersizlikleri, kaynak trigger'ı ve depo pasifleştirme kuralı yeterli olduğundan migration gerekmedi.

**Çıktılar:**
- [x] Taslak oluşturma/düzenleme/liste/detay; Taslak → Sevk edildi → Teslim alındı, Taslak → İptal edildi ve yalnız sevk edilmiş transferden (SHIPPED → RETURNED) tam geri dönüş.
- [x] Sevkte kaynak depodan, teslimde hedef depoya, yalnız yoldan geri dönüşte kaynağa movement yazılır. Geri dönüş hedef bakiyeyi değiştirmez ve yoldaki miktarı kapatır. Bakiye yalnızca `StockMovement` INSERT trigger'ı ile yazılır. Yoldaki miktar SHIPPED transfer satırlarından türetilir ve stok ekranında mevcut bakiyeden ayrı gösterilir.
- [x] Miktar decimal string, pozitif/en çok üç ondalık; `EACH` tam sayı; transfer başına ürün tekrarı yok. Depolar farklı olmalı. Transfer numarası `BIGSERIAL` sequence ile üretilir, `MAX + 1` yok.
- [x] Yönetici tüm transferleri yönetir. Depo sorumlusu atanmış kaynakta taslak oluşturma/düzenleme/iptal/sevk; atanmış hedefte teslim yapabilir. Geri dönüş yalnız yöneticiye açık. Atanmış kaynak veya hedef üzerinden okuma, diğer depoların bakiye bilgisini açmaz. Depo seçme endpoint'i yalnız aktif ID/kod/ad döndürür.
- [x] Transfer ve depolar sabit ID sırasıyla kilitlenir; aktiflik, atama, durum, açık sayım ve kaynak bakiyesi kilit altında doğrulanır. Audit, durum, movement'lar ve idempotency yanıtı tek transaction'da tamamlanır.
- [x] Sevk/teslim/geri dönüşün idempotency kapsamları ayrıdır; aynı anahtar/gövde aynı sonucu döndürür, farklı gövde 409'dur. Eşzamanlı durum geçişi ve DB hareket phase unique kısıtları çift movement'ı önler. Taslak stale edit `updatedAt` ile reddedilir.
- [x] Arayüzde transfer listesi/durum-depo-tarih filtreleri/sayfalama, taslak formu, satır başına kaynak mevcut stok, detay, işlem yapan/zaman, koşula bağlı eylemler ve zorunlu geri dönüş gerekçesi bulunur. Eylem onaylarında etki özeti ve ağ belirsizliğinde aynı idempotency anahtarıyla tekrar deneme vardır.

**Doğrulama ve anlamlı testler:**
- [x] `transfer-routes.integration.test.ts` ayrı `stock_warehouse_test` üzerinde taslak/iptal etkisizliğini, sevk/teslim/geri dönüş bakiyelerini ve yoldaki türev değerleri, çok satırlı rollback, doğrulama, rol/depo erişimi, CSRF, pasif depo/açık sayım, stale edit, idempotency/409, audit rollback ve eşzamanlılık durumlarını gerçek PostgreSQL ile sınar.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:validate` başarılı; birim/auth testleri 18/18 geçti.
- [x] `npm run test:db` ayrı PostgreSQL test DB'sinde 11 geçti, 1 atlandı, 0 başarısız. Atlanan test ilk yönetici testi; test veritabanında yönetici bulunduğu için mevcut kayıt korunarak atlandı. Transfer regression gerçek PostgreSQL'de taslak, sevk, teslim, iki tür geri dönüş, eşzamanlılık, idempotency, yoldaki miktar, yetki, sayım, pasif depo, CSRF ve audit rollback koşullarını kapsadı.
- [x] Geri dönüş yalnız `SHIPPED` durumunda kabul edilir. `RECEIVED` durumundaki geri dönüş API'de 409 ile reddedilir; testte durum, bakiye ve hareket sayısının değişmediği, doğrudan DB geçişinin de trigger tarafından reddedildiği doğrulanır. `TransferWorkspace.tsx` geri dönüş eylemini yalnız `SHIPPED` durumunda gösterir. Bu regresyon, `transfer-routes.integration.test.ts` içindeki “transfer routes enforce assignment, status, idempotency, and PostgreSQL atomicity” testinin parçası olarak ayrı PostgreSQL test DB'sinde geçti.
- [x] Test edilen `RECEIVED` geri dönüş reddi, teslim ve geri dönüş eşzamanlılığı ile SHIPPED geri dönüş gerekçesi zorunluluğu PostgreSQL regresyonlarında geçti. Tam `npm run test:db`: 12 testten 11 geçti, 1 ilk-yönetici testi mevcut test verisini korumak için atlandı, 0 başarısız.
- [x] Tarayıcıda transfer listesi/filtreleri ve taslak formu açıldı; kaynak/hedef seçimi, ürün satırı ve kaynak stok göstergesi ile stok ekranındaki yoldaki giriş/çıkış sütunları doğrulandı. Taslak kaydedilmedi, sevk/teslim/geri dönüş çalıştırılmadı; geliştirme verisi değiştirilmedi. Gerçek kullanıcı ile hareketli uçtan uca tarayıcı kontrolü yapılmadı.
- [x] 2026-10-07 tarihli `npm audit` ve `npm audit --omit=dev` her biri 4 yüksek bulgu raporladı; açık Prisma CLI transitif advisories README'de korunur.
- [x] Önceden mevcut `RETURNED` + `returnOrigin=RECEIVED` kayıtları yalnızca okundu: geliştirme DB'de 0, test DB'de 21. Kayıtlar ve hareketleri değiştirilmedi. Yeni migration trigger'ı geçişi sınırlar ve `NOT VALID` kısıtıyla tarihsel satırları doğrulama/değiştirme işlemi yapmadan korur.

**Kalan işler:** Sayım, raporlama, tedarikçi yönetimi ve başka modüller bu aşamada başlatılmadı.

## Aşama 6 — Sayım ve depo hareket kilidi

**Durum:** Sıradaki aşama; henüz başlatılmadı. Aşama 5 transfer kapsamı tamamlandı. Açık işler: sayım açma, sayım satırları ve fark onayı/iptali akışlarını, ortak depo kilidiyle stok hareketi güvenliğini ve ayrı PostgreSQL testlerini uygulamak. Mevcut kullanıcı verileri ve hareket geçmişi korunmalı; stok bakiyesinin tek yazım yolu `StockMovement` trigger'ı olarak kalmalı.

**Amaç:** Sayım süresince miktar değişimini engelleyip farkı onaylı hareket olarak yazmak.

**Çıktılar:**
- Depo başına tek açık sayım.
- Depo kapısı satırı ve ortak `FOR UPDATE` kilit protokolü.
- Başlangıç sistem miktarı, fiziksel sayım, fark gözden geçirme, onay veya iptal akışı.
- Negatif fark için çıkış, pozitif fark için giriş hareketi; sıfır fark için hareket yok.

**Doğrulama ve anlamlı testler:**
- **Sayım açma yarışı:** Aynı depo sayım açılışı ve stok yazımı eşzamanlı başlatılır; ortak veritabanı kilidi nedeniyle biri önce sıralanır. Hareket önceyse tamamlanır ve sayım yeni bakiyeyi esas alır; sayım önceyse stok işlemi açık sayımda uygulanmaz.
- Sayım açıkken giriş, çıkış, transfer sevki/teslimi, ters hareket ve başka fark uygulaması engellenmeli.
- Aynı depo için ikinci açık sayım DB constraint'iyle de engellenmeli.
- Birden fazla sayım satırındaki farklardan biri geçersizse hiçbir fark hareketi/bakiye değişikliği kalmamalı.
- Sayım iptali miktarı değiştirmemeli; onay sayım, ledger, balance ve audit'i birlikte tamamlamalı.

## Aşama 7 — Web iş akışları ve erişilebilir arayüz

**Amaç:** Kalan operasyon modüllerinin arayüzlerini ilgili servislerine bağlamak. Katalog ekranları ve stok giriş/çıkış/stok/hareket/transfer ekranları ilgili aşamalarda uygulanmıştır.

**Çıktılar:**
- Sayım, kullanıcı/atama ve tedarikçi CRUD ekranları (stok belgesi, transfer ve hareket ekranları uygulanmıştır).
- Rapor ekranları ve henüz planlanan modüller için filtrelenebilir/sayfalanabilir görünümler.
- Yüklenme/boş/hata/yetkisiz/başarı durumları ve form verisi koruma.
- Görünür odak, klavye etkileşimi, etiketli alanlar ve Türkçe iş metinleri.

**Doğrulama:**
- Kritik iş akışları klavyeyle tamamlanabilir.
- Sunucu doğrulama hatasında form alanları korunur ve hata alanla ilişkilendirilir.
- Onay öncesinde etkilenecek depo, satır ve miktar açıkça gösterilir.
- Rol ve depo ataması olmayan kullanıcı için ilgili işlem görünmese de doğrudan API çağrısı reddedilir.

## Aşama 8 — Raporlar, CSV ve uçtan uca kabul

**Amaç:** Operasyonel raporlamayı ve bütün kritik iş kurallarının birlikte doğrulanmasını tamamlamak.

**Çıktılar:**
- Düşük stok, depo özeti, tarih/depo bazlı giriş ve çıkış raporları.
- Filtre ve yetki kapsamını koruyan CSV dışa aktarımı.
- Denetim kayıtları görünümü ve temel uzlaştırma operasyon yönergesi.

**Doğrulama:**
- Rapor sonuçları ilgili depo erişim kapsamının dışına veri sızdırmamalı; CSV aynı filtre ve yetkiyle sınırlı olmalı.
- CSV hücre formülü enjeksiyonuna karşı güvenli olmalı.
- Sentetik demo kaydı açıklaması görünür olmalı; uydurma başarı/kullanıcı istatistiği olmamalı.
- Kritik uçtan uca senaryolar: giriş → çıkış; çift istek; eşzamanlı çıkış; atomik çok satırlı belge; transfer taslak-sevk-teslim/ters dönüş; sayım ve yarış; yetkisiz erişim; ters hareket; uzlaştırma.
- Uygulamanın kurulum, migration, başlatma ve test yönergeleri yeni yerel ortamda takip edilebilir olmalı.
