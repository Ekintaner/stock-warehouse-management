# Son doğrulama — 2026-10-17

## Sonuçlar

| Kontrol | Sonuç |
| --- | --- |
| npm run build | Başarılı |
| npm run typecheck | Başarılı |
| npm run lint | Başarılı |
| npm test | 18 geçti, 0 başarısız, 0 atlandı |
| npm run test:db | 15 geçti, 0 başarısız, 0 atlandı |
| npm run db:validate | Başarılı |
| npm run db:migrate | 5 migration, bekleyen yok |
| npm run db:test:migrate | 5 migration, bekleyen yok |
| npm run db:grants | İki yerel hedefte uygulandı |
| npm audit | 0 bulgu |
| npm audit --omit=dev | 0 bulgu |
| npm run test:browser (Edge) | Başarılı |

Test sayıları Node test bloklarının sayısıdır; bir entegrasyon bloğu birden
fazla kabul senaryosu içerir. Test sayısı senaryo veya kapsam yüzdesi değildir.

## Gerçek PostgreSQL kapsamı

Mevcut stok, katalog, transfer ve sayım regresyonları; yeni operasyon testi
ile tamamlandı. Yeni test yetki ve CSRF, tedarikçi oluşturma/düzenleme ve stale
edit, stok eşiği, depo kapsamlı stok/özet/dönem raporları, CSV formül korunması,
terslemede audit hatası rollback’i, yetersiz stok reddi, aynı anahtarın tekrarı,
çelişen içerik, ikinci tersleme reddi, kullanıcı oluşturma/depo atama/parola
güncelleme ve hash’in yanıt dışında kalmasını doğrular.

İlk yönetici mevcut veriler yüzünden atlanmaz: var olan hesabı değiştirmeme
kontrolü ve yeni rastgele şemada iki bağlantılı ilk oluşturma yarışı ayrıdır.
Yalnızca testin oluşturduğu şema test sonunda kaldırılır. Test dosyaları,
paylaşılan hata-enjeksiyon trigger’larının çakışmaması için sırayla yürütülür.

## Tarayıcı kabulü

Yerel Edge, 1440×1000 pencere, yalnızca stock_warehouse_test:

- Gerçek parola ile giriş, oturum kontrolü ve çıkış.
- Sayım formundan açılış, ürün miktarı girişi ve kaydetme.
- Seçilen üründe snapshot 10, sayılan 8, fark −2 ve onay sonrası bakiye 8.
- Diğer katalog satırları aynı API’den snapshot miktarlarıyla hazırlanır.
- Stok raporu, depo özeti, CSV indirme ve tedarikçi formunun gönderimi.
- Gerçek transfer ekranında sevk, teslim ve ayrı transferde yoldan geri dönüş.
- Belge ekranından tersleme; yenileme sonrası terslenmiş durumun korunması.
- Kullanıcı/depo ataması ve denetim ekranlarının açılması; yenileme.
- Tarayıcı pageerror olayı oluşmaması.

Sentetik tarayıcı hesabı çalışma sonunda pasifleştirilir, oturumları iptal edilir.
Append-only hareketler ve sayımlar yalnızca test veritabanında korunur.
Geliştirme veritabanında kullanıcı, belge, stok veya test hareketi oluşturulmadı.
Geliştirme/test migration durumları kontrol edildi; yeni migration gerekmedi.

## Bilinen sınırlar

Bu rapor bağımsız sızma testi veya yüksek yük/uzun süreli dayanıklılık testi
değildir. Tarayıcı testi bütün alanların bütün kombinasyonlarını kapsamaz.
İlk yönetici izole şema testi yalnızca User tablosunu ve ilgili enum’u kopyalar;
tamamen boş veritabanı kurulumu diğer migration kontrollerinden ayrıdır.
Kısmi transfer, teslim sonrası iade, maliyet muhasebesi, e-posta ile parola
sıfırlama ve internet dağıtımı kapsam dışıdır. Test fixture’ları zamanla büyür;
projeye özel test DB yedekleme/yenilemesi manuel ve ayrı bir bakım kararıdır.

## Yerel açılış

Bu bilgisayarda 3000 portu CareerOS’a ait olduğundan ona dokunulmadan stok
API’si 3100’e alındı. Vite proxy’si aynı PORT ayarını izler:

```powershell
$env:PORT='3100'
npm run dev
```

Web: http://127.0.0.1:5173. Gerçek .env dosyası değiştirilmedi.
Bu çalışma sonunda yeni commit veya GitHub push yapılmadı.
