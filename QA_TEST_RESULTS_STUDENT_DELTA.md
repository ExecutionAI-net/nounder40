# QA Test Sonuçları — Student Paneli DELTA Raporu

> Bu dosya, ana `QA_TEST_RESULTS.md`'nin "4. Student Paneli" bölümünde
> belgelenmiş **kapsanmamış alanları** (gerçek UI tıklama akışları, booking/
> cancel/waitlist/buy/discount/support/documents/address) test etmek için
> ayrı bir QA ajanı tarafından hazırlanmıştır. Koordinatör bu dosyayı ana
> rapora birleştirecektir. `QA_TEST_RESULTS.md` değiştirilmemiştir.

**Test ortamı:** Ağırlıklı olarak **local** (`http://localhost:8080`,
`qa.student@qa-nounder40.test`, doğru şekilde "QA Test School"'a bağlı).
Dev'de (`https://dev.danzaclassicanounder40.com`) hiçbir yazma işlemi
yapılmadı — mevcut `qa.student` orada hâlâ yanlış bağlı (Bulgu bölümüne
bakınız, önceki oturumdan miras).

**Yeni throwaway dev kaydı oluşturulmadı** — tüm yazma/fonksiyonel testler
local'de, mevcut doğru-bağlı `qa.student` ile yapıldı; dev'e temas edilmedi.

---

## ÖNEMLİ ORTAM UYARISI — Paralel QA ajanları arasında veri/oturum çakışması 🟠 Yüksek (metodolojik, ürün hatası değil)

Bu görev 4 paralel QA ajanının (HQ/School/Teacher/Student) **aynı paylaşılan
tarayıcı penceresi (Claude Browser pane) ve aynı local Docker/Postgres**
üzerinde eşzamanlı çalıştığı bir kurulumda yürütüldü. İki farklı çakışma
türü gözlemlendi ve bunlar test sürecini defalarca kesintiye uğrattı:

1. **`localStorage` paylaşımı**: `nu40_access`/`nu40_refresh` token'ları
   `http://localhost:8080` origin'i altında **tüm sekmeler arasında
   paylaşılıyor**. Sibling bir ajan (örn. Teacher paneli) kendi hesabıyla
   giriş yaptığı anda, benim sekmemdeki `qa.student` oturumu sessizce
   **teacher rolüne** dönüşüyor ve sonraki tüm `student/*` API çağrıları
   `403 Forbidden` dönüyor — hem UI'da görünür bir hata mesajı olmadan hem de
   sebepsiz görünen bir şekilde. Bu, `İptal — politika ÜSTÜNDE (iade)`
   senaryosunu ilk denemede iki kez kesintiye uğrattı (§ Bulgu listesine
   bakınız, üçüncü denemede JS içinden doğrudan `fetch` ile giriş yapılarak
   yarış penceresi daraltıldı ve test tamamlandı).
2. **Paylaşılan DB üzerinde çapraz-ajan mutasyonu**: Sept 8 16:53 dersi için
   yaptığım bir booking, ben iptal etmeden önce **başka bir ajan tarafından
   "attended" (yoklama alındı) olarak işaretlendi** — muhtemelen Teacher
   paneli ajanı QA Course derslerinde genel yoklama testi yaparken bu spesifik
   ders kaydına rastladı. Bu, benim iptal denemem 403 aldığında ek bir
   karışıklık kaynağı oldu.

**Sonuç/öneri:** Bu bulgular **ürün kodunda bir hata değildir** — CLAUDE.md
zaten JWT'nin `localStorage`'da tutulduğunu bir mimari invariant olarak not
ediyor (§3.1) ve bu, tek-kullanıcılı gerçek kullanım için sorun yaratmaz.
Ancak paralel QA koşuları için: (a) her ajana **ayrı bir local Docker Compose
projesi/port** vermek (paylaşılan DB'yi ortadan kaldırır) ya da (b) her
ajanın kendi test hesabı için token'ı `localStorage` yerine bellekte tutup
her kritik eylemden hemen önce JS içinden `fetch`/`localStorage.setItem` ile
"taze" giriş yapması (bu oturumda ikinci yaklaşım kullanıldı ve işe yaradı)
önerilir.

---

## Yeni Bulgular (önem sırasına göre)

### 🟠 Bulgu S1 — Takvim widget'ı, seçili arayüz dili ne olursa olsun her zaman Türkçe render ediliyor
**Sayfa:** `/en/student/book` (Calendar görünümü)
**Repro:** İngilizce locale'de (`/en/...`, header'da 🇬🇧 seçili) Book a Lesson
sayfasını aç, "Calendar" görünümünü kullan.
**Gözlem:** Ay adı "**Eylül 2026**" (olması gereken: "September 2026") ve
haftanın günleri "**PZT SAL ÇAR PER CUM CMT PAZ**" (olması gereken: "MON TUE
WED THU FRI SAT SUN") olarak görünüyor — sayfanın geri kalanı (nav, "Home",
"Calendar", "My lessons" vb.) doğru şekilde İngilizce iken. Muhtemel sebep:
takvim kütüphanesinin (örn. `date-fns`) locale parametresi `next-intl`'in
aktif locale'inden değil, tarayıcı/sistem varsayılanından ya da sabit
`tr` locale'inden okunuyor.
**Etki:** Her locale'de (en/it/es/fr/de) görünür; İngilizce/İspanyolca/
Fransızca/Almanca kullanıcılar için takvim ay/gün adları anlaşılmaz Türkçe
kısaltmalar olarak kalıyor. Kanıt: `get_page_text` çıktısı, ekran görüntüsü
alındı (bkz. oturum içi ekran görüntüleri).
**Konum:** Muhtemelen `frontend/src/app/[locale]/student/book/` altındaki
takvim bileşeni veya paylaşılan bir `Calendar`/`DatePicker` bileşeni.

### 🟡 Bulgu S2 — Waitlist alt yapısı var ama öğrenci tarafında hiç UI yok (mevcut bilinen boşluğun canlı doğrulaması)
**Repro:** `Course.waitlist_enabled=True` yapıldı, bir dersin `max_capacity`
değeri geçici olarak 0'a çekilerek "dolu" hale getirildi (local, test amaçlı,
sonradan geri alındı). Öğrenci "Book a Lesson" sayfasında bu dersi görüntüledi.
**Gözlem:** Ders kartında sadece ham etiket "**Full**" gösteriliyor ve "Book
Button" **disabled** (`button.disabled === true`) durumda — tıklanınca
hiçbir modal/mesaj/waitlist seçeneği açılmıyor. `grep -ri waitlist
frontend/src` sonucu: `waitlist` kelimesi yalnızca **School tarafının** kurs
oluşturma/düzenleme formlarında geçiyor (`CoursesClient.tsx`, course
new/edit sayfaları) — student tarafı kod tabanında **hiç** geçmiyor.
**Değerlendirme:** Bu, CLAUDE.md §10'da zaten belgelenmiş bilinen/bilinçli
boşluğun ("Waitlist motoru — `Course.waitlist_enabled` alanı var, motor yok")
**canlı/UI seviyesinde doğrulanmış halidir** — yeni bir bug değil, ama artık
somut kanıtla (disabled buton, sıfır geri bildirim) teyit edilmiş durumda.
Kullanıcı deneyimi açısından not: dolu bir dersin sadece "Full" yazıp
disabled bir buton göstermesi (üstelik "Full" de çevrilmemiş bir etiket,
bkz. S3) minimal ama kabul edilebilir bir sinyal.

### 🟢 Bulgu S3 — i18n bulgusu genişletmesi: Book/Cancel/History/Chat akışlarında çok sayıda yeni ham etiket örneği
Ana rapordaki Bulgu #4/#9 (`Label X`, `Tab X`, `X Desc`, `Faq Title`) ailesine
ait, bu oturumda **ilk kez** UI tıklama akışları sırasında görülen ek örnekler:

| Sayfa | Ham etiket | Olması gereken (bağlamdan çıkarım) |
|---|---|---|
| `/student/book` (liste/kart) | `Book Button` | "Book" |
| `/student/book` (liste/kart) | `Spots Left` | "X spots left" (gerçek sayı) |
| `/student/book` confirm modal | `Cancel Button` | "Cancel" |
| `/student/book` cancel modal | `Cancel Button` (aynı) | "Cancel" |
| `/student/bookings` | `Tab Upcoming` / `Tab Past` / `Tab Cancelled` | "Upcoming" / "Past" / "Cancelled" |
| `/student/bookings` liste kartı | `Cancel Button` | "Cancel" |
| `/student/profile` | `Tab Profile` / `Tab Documents` | "Profile" / "Documents" (Address zaten doğru — önceki bulguyla tutarlı) |
| `/student/profile` (Profile sekmesi) | `Language Hint` | (dil tercihini açıklayan bir yardım metni olmalı) |
| `/student/profile` (Documents sekmesi) | `Date Of Birth` başlığı belgeler bölümünün üstünde beliriyor (bağlam dışı) | muhtemelen yanlış/eksik i18n anahtarı nedeniyle Documents panelinde sızıyor |
| `/student/packages` | `Tab Packages` / `Tab History` | "Packages" / "History" |
| `/student/packages` paket kartı | `Package Default` | paket adı boşsa gösterilecek fallback metni (kendisi bir i18n anahtarı gibi görünüyor) |
| `/student/packages` → History | `Tx No Show` / `Tx Refunded` / `Tx Purchased` | "No Show" / "Refunded" / "Purchased" |
| `/student/support` (chat kutusu) | mesaj textarea `placeholder="Placeholder"` | gerçek bir placeholder metni ("Type a message...") |
| `/student/support` (chat mesaj listesi) | `Date Today` | "Today" |
| `/student/support` | `Faq Title` (önceden bilinen) | "Frequently Asked Questions" |

**Değerlendirme:** Bu, ana rapordaki sistemik i18n regresyonunun kapsamını
genişletiyor — School/Teacher/Student panellerinde artık **20+ sayfa/bileşen**
etkilenmiş durumda. Kök neden değişmedi (muhtemelen `frontend/messages/en.json`
içinde eksik/yanlış isimlendirilmiş anahtarlar).

### 🟢 Bulgu S4 — "Buy Now" / discount "Apply" / FAQ akordiyon başlıkları: otomasyon tıklamaları bazen ilk denemede tepki vermiyor
**Gözlem:** Bu oturumda birden çok kez (Buy Now butonu, discount code Apply
butonu, FAQ akordiyon başlığı, Profile "Address" sekmesi) koordinat tabanlı
bir `left_click` (erişilebilirlik ağacı `ref` ile) **hiçbir görünür etki
yaratmadan** sessizce başarısız oldu; aynı elemente native JS `element.click()`
çağrısı ise her seferinde beklenen davranışı (modal açma, hata/başarı mesajı,
sekme değişimi) tetikledi. Bu, üç farklı sayfada ve üç farklı bileşen türünde
(buton, buton, akordiyon) tekrarlanan bir örüntü.
**Değerlendirme:** Bunun test aracının (Claude Browser) tıklama-olay
simülasyonuyla ilgili bir husus mu, yoksa uygulamanın gerçek `pointerdown`/
`mousedown` olaylarına (yalnızca senkron `click`'e değil) bağımlı bir olay
işleyici deseni kullanmasından mı kaynaklandığı **kesin olarak
ayrıştırılamadı**. Gerçek kullanıcı fare tıklamaları hem `mousedown` hem
`click` üretir, dolayısıyla gerçek kullanıcılar için muhtemelen sorun
yaşanmıyor — ama bu örüntü, bazı butonların yalnızca belirli olay
sıralamalarına tepki verdiğine dair zayıf bir sinyal olabilir. Düşük öncelikle
not edildi; kesin teşhis için gerçek fare/dokunmatik cihazda manuel doğrulama
önerilir.

---

## Doğrulanan / PASS Olan Akışlar (bu oturumda ilk kez gerçek UI tıklamasıyla test edildi)

| # | Senaryo | Yöntem | Sonuç |
|---|---|---|---|
| 1 | **Booking — tam UI akışı**: Book a Lesson → ders kartı → "Book" → onay modalı ("Confirm booking": tarih/saat/öğretmen/okul/kredi özeti) → "Yes Book Now" | Gerçek tıklama | ✅ Modal doğru bilgi gösteriyor; onaydan hemen sonra header'daki kredi sayacı **anında** güncelleniyor (örn. 8→7); ders "My Classes → Upcoming" altında beliriyor |
| 2 | **İptal — politika eşiğinin ALTINDA (yakar), tam UI akışı** | `/student/book`'tan "Cancel Booking" → uyarı modalı | ✅ Modal net bir uyarı gösteriyor: "⚠️ The lesson will not be refunded. Only 3.5 hours to the lesson, less than the 24 hours the school requires: outside its cancellation policy." → "Yes, cancel anyway" sonrası kredi **değişmedi** (API ile doğrulandı: `credits` sabit kaldı, booking `cancellation_type:"outside_policy"`, `credit_refunded:false`) |
| 3 | **İptal — politika eşiğinin ÜSTÜNDE (iade eder), tam UI akışı** | Hem `/student/book` hem `/student/bookings` sayfasından "Cancel Booking" | ✅ Modal net bir onay gösteriyor: "✓ The lesson goes back into your package. You are cancelling more than 24 hours ahead: within the school's cancellation policy (24 hours)." → "Yes, cancel and refund" sonrası kredi **arttı** (API ile doğrulandı: `cancellation_type:"within_policy"`, `credit_refunded:true`, header'daki kredi sayacı güncellendi) |
| 4 | **Yetersiz kredi ile booking denemesi** (paketler geçici olarak 0 krediye çekildi, test sonunda geri yüklendi) | "Book" tıklaması | ✅ Uygulama çökmüyor; onay modalı yerine "Buy a package and save — With 'QA Credit Pack' this lesson would cost you €2.50" mesajı gösteriliyor ve **"Yes Book Now" butonu hiç render edilmiyor** — yani kredisiz booking'e izin verilmiyor, kullanıcı satın almaya yönlendiriliyor |
| 5 | **Buy Packages → checkout diyaloğu → discount code (geçersiz)** | UI'da "Buy Now" → "Complete your purchase" modalı → geçersiz kod girip "Apply" | ✅ "Invalid code." mesajı net şekilde gösteriliyor, fiyat değişmiyor |
| 6 | **Buy Packages → discount code (geçerli, %10)** | Local'de geçici bir `DiscountCode` (QATEST10, %10, `applies_to=[]`) oluşturulup UI'da uygulandı | ✅ "Code QATEST10 applied: −€2.50" ve "Total with the discount: €22.50" doğru hesaplandı (€25 → €22.50) |
| 7 | **Buy Packages → "Go to payment" → Stripe sınırına kadar** | "Go to payment" tıklaması | ✅ Çökmüyor; `POST /api/stripe/checkout/` isteği gönderiliyor ve backend `school_not_connected` (400) ile net şekilde reddediyor (school'un Stripe onboarding'i tamamlanmamış — bilinen, önceden belgelenmiş ortam sınırlaması). **Küçük not:** UI tarafında bu hata sadece jenerik bir "API error 400" toast'ı olarak gösteriliyor — kullanıcıya "ödeme şu an bu okul için kullanılamıyor" gibi anlamlı bir mesaj verilmiyor (bkz. Bulgu S5 aşağıda) |
| 8 | **Support — okula gerçek mesaj gönderme** | Chat kutusuna metin yazıp "Send" | ✅ Mesaj UI'da anında görünüyor; **okul tarafında bağımsız olarak doğrulandı**: `qa.school.owner` token'ıyla `GET /api/chat/conversations/` çağrıldığında mesaj doğru içerik, zaman damgası ve `unread_count:1` ile görünüyor |
| 9 | **Support — FAQ akordiyon aç/kapa** | "How do I book a lesson?" başlığına tıklama | ✅ Doğru şekilde genişliyor ve doğru (ve doğru çevrilmiş) cevap metnini gösteriyor: "Go to Book, pick your city and the lesson, then confirm. The credit is deducted when you book." |
| 10 | **Profile → Documents sekmesi, okul belge istemiyorken** | Sekmeye geçiş | ✅ "This school does not ask for documents." — doğru boş durum |
| 11 | **Profile → Documents sekmesi, okul zorunlu belge istediğinde** (local'de geçici `SchoolDocumentType(required=True)` oluşturuldu, sonra silindi) | Sekmeye geçiş | ✅ "ID Card*" olarak zorunlu belge doğru gösteriliyor, durum "Not Uploaded", "Upload" butonu tıklanabilir ve tıklandığında hata vermeden native dosya seçiciyi tetikliyor (otomasyon aracı native dosya diyaloğunu tamamlayamadığından gerçek dosya yükleme denenmedi, ama UI hatasız açılıyor) |
| 12 | **Profile → Address sekmesi doldur + kaydet + kalıcılık** | Form doldurma + "Save Changes" | ✅ "Profile Updated" toast'ı görünüyor; sayfa yenilendikten (ve API ile bağımsız doğrulandıktan) sonra `address`, `city`, `postal_code`, `province`, `country` alanlarının hepsi doğru kalıcı — bu sekmenin diğerlerinin aksine (Bulgu #4/S3) doğru çevrilmiş olduğu **teyit edildi** |
| 13 | **"Calendar" nav öğesi vs "Book" sayfası** | Kod incelemesi + navigasyon | Netleştirme: `frontend/src/app/[locale]/student/` altında ayrı bir `calendar/` rotası **yok**. Sidebar'daki "Calendar" linki doğrudan `/student/book`'a gidiyor; o sayfadaki "Calendar"/"List" toggle'ı aynı booking sayfasının iki görünüm modu. Bu bir hata değil — görev tanımındaki "Calendar sayfası ayrı mı?" sorusunun cevabı: **hayır, aynı sayfa**, sadece nav etiketi "Calendar" |
| 14 | **My Packages → History sekmesi** | Sekme değişimi | ✅ Tüm geçmiş işlemler (booking, no-show, iptal/refund, satın alma) doğru kronolojik sırada, doğru ikonlarla (✗/↩/🛒/✓) ve doğru kredi delta'larıyla listeleniyor — sadece etiketler çevrilmemiş (bkz. S3) |
| 15 | **Rol izolasyonu (yeniden doğrulama)** | qa.student token ile `/api/hq/*`, `/api/school/*` çağrıları | ✅ Ana raporda zaten belgelenmiş, bu oturumda tekrar gözlemlendi: hepsi `403` |

### 🟢 Bulgu S5 — Stripe checkout hatası kullanıcıya jenerik "API error 400" olarak gösteriliyor
**Repro:** Buy Packages → paket seç → "Go to payment".
**Gözlem:** Backend `{"error":"school_not_connected"}` (400) döndürüyor — bu
beklenen ve doğru davranış (okulun Stripe onboarding'i tamamlanmamış,
bilinen ortam sınırlaması). Ama frontend bu spesifik hatayı yakalayıp
anlamlı bir mesaja çevirmek yerine jenerik bir "API error 400" toast'ı
gösteriyor. Gerçek prodüksiyonda (okulun Stripe'ı bağlı olduğu bir senaryoda)
bu kod yolu muhtemelen hiç tetiklenmez, ama okul Stripe onboarding'ini
tamamlamamışken bir öğrenci paket satın almaya çalışırsa şu an gördüğü mesaj
kullanıcı dostu değil. Düşük öncelik — kozmetik.

---

## Test Ortamı Değişiklikleri ve Temizlik

Local ortamda test için geçici olarak oluşturulan/değiştirilen ve **test
sonunda temizlenen/geri alınan** veriler:

- `Course.waitlist_enabled` geçici olarak `True` yapıldı → **geri alındı
  (`False`)**.
- Bir dersin (`f126bfdb-...`, 2026-09-07 16:53) `max_capacity` değeri geçici
  olarak `0`'a çekildi → **geri alındı (`10`)**.
- Refund-cancel senaryosunu paralel-ajan çakışmasından izole test edebilmek
  için geçici bir ders oluşturuldu (`e4f8b540-...`, 2026-09-20 10:00) →
  **test sonunda silindi**.
- Geçerli bir discount code test edebilmek için `DiscountCode(code=QATEST10,
  %10)` oluşturuldu → **test sonunda silindi**.
- Documents akışını test edebilmek için `SchoolDocumentType(code=id_card,
  required=True)` oluşturuldu → **test sonunda silindi**.
- İki `StudentPackage` kaydının `credits_remaining` değeri, "yetersiz kredi"
  senaryosunu test etmek için geçici olarak `0`'a çekildi → **test sonunda
  orijinal değerlerine (5.0 ve 2.5) geri yüklendi**.
- Gerçek booking/cancel akışları (kalıcı, geri alınamaz iş mantığı testleri)
  local `qa.student` hesabının kredi/booking geçmişinde iz bıraktı — bu,
  görev talimatlarına göre beklenen ve kabul edilebilir bir durumdur (local,
  izole, tek kullanıcılı ortam).

**Dev ortamına hiç dokunulmadı** — mevcut `qa.student` hesabı (Danza Clásica
Barcelona'ya yanlış bağlı) hiç kullanılmadı, yeni bir throwaway kayıt da
oluşturulmadı (mevcut local hesap tüm senaryolar için yeterli ve daha güvenliydi).

---

## Kapsam Dışı / Test Edilemeyenler

- **Gerçek Stripe ödeme tamamlama**: Beklendiği gibi mümkün değil (maskeli
  anahtarlar, bilinen sınırlama) — "Go to payment" sonrası graceful 400
  hatası doğrulandı (bkz. Test #7).
  - **Belge yükleme (gerçek dosya)**: Native OS dosya seçici otomasyon aracı
  tarafından tamamlanamadığından, "Upload" butonunun dosya seçiciyi hatasız
  açtığı doğrulandı ama gerçek bir dosyanın sunucuya yüklenip "pending
  validation" durumuna geçtiği uçtan uca doğrulanamadı. Bu, backend
  `/api/student/documents/` endpoint'inin ayrı bir curl ile (multipart file
  upload) test edilmesiyle tamamlanabilir — zaman kısıtı nedeniyle bu
  oturumda yapılmadı.
- **Waitlist'e katılma sonrası "yer açılınca otomatik terfi"**: Öğrenci
  tarafında waitlist'e katılma seçeneği UI'da hiç mevcut olmadığından
  (Bulgu S2) bu senaryo test edilemedi — motor gerçekten yok.
