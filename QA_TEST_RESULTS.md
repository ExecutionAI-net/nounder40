# QA Test Sonuçları — No Under 40

> Bu dosya devam eden bir QA test raporudur. Her panel/rol testi bittikçe
> ilgili bölüm güncellenir (üzerine yazılır). Test ortamı: **dev**
> (`https://dev.danzaclassicanounder40.com`, `develop` branch). Bir istisna
> dışında (bkz. 1.2 Grup 6, DELETE testleri) tüm testler dev'de yapıldı; DB'ye
> yansıyan tüm test verileri (özel rol, test paketi, rol değişiklikleri) test
> sonunda temizlendi/geri alındı.

Test hesapları: `qa.hq.<rol>@qa-nounder40.test` / şifre `QaSuite!2026`
(`backend/core/management/commands/qa_platform.py` ile üretildi; okul/öğretmen/
öğrenci hesapları da aynı komuttan: `qa.school.<rol>@…`, `qa.teacher@…`,
`qa.student@…`). Backend kontrolleri `POST /api/auth/login/` ile alınan JWT
access token + `curl` üzerinden yapıldı.

**İkinci tur (derin fonksiyonel test):** 4 panel için 4 paralel QA ajanı
kullanıldı; her biri kendi bulgularını ayrı bir DELTA dosyasına yazdı, bu
dosyada özetlenip birleştirildi. Ham detay için: `QA_TEST_RESULTS_HQ_DELTA.md`,
`QA_TEST_RESULTS_SCHOOL_DELTA.md`, `QA_TEST_RESULTS_TEACHER_DELTA.md`,
`QA_TEST_RESULTS_STUDENT_DELTA.md`.

> ⚠️ **Metodoloji notu — paylaşılan tarayıcı oturumu:** 4 ajan aynı Claude
> Browser penceresini (farklı sekmelerde) ve aynı local Docker DB'sini
> paylaştı. JWT `localStorage`'da tutulduğu için (mimari invariant #1) ve
> `localStorage` origin bazlı **tüm sekmeler arasında ortak** olduğu için,
> bir ajanın girişi diğerinin oturumunu sessizce değiştirebiliyordu. Bu
> **ürün hatası değil** — tek kullanıcılı gerçek kullanımda hiç yaşanmaz —
> ama paralel test turunda birçok "sahte 403" üretti. Her ajan şüpheli
> sonuçları taze `curl` token'larıyla çapraz doğruladı; aşağıdaki bulgular
> bu şekilde temizlenmiş, gerçek bulgulardır. Gelecekte paralel QA turu
> yapılacaksa: her ajana ayrı bir Docker Compose projesi/port verilmesi
> önerilir.

---

## 0. Fix Durumu (2026-09-06 itibarıyla)

> Bu bölüm, aşağıdaki bulgulardan hangilerinin fixlenip merge edildiğini
> takip eder. Bulgu metinlerinin kendisi (1-5. bölümler) **değiştirilmedi** —
> orijinal QA kaydı olarak kalıyor.

### ✅ Fixlenip merge edilenler — `develop` + `main`

**PR [#44](https://github.com/ExecutionAI-net/nounder40/pull/44) → `develop`, PR [#45](https://github.com/ExecutionAI-net/nounder40/pull/45) → `main` (senkron):**
- HQ Grup 6 — Team yönetimi + yetki yükseltme (Critical #1-3): `hq_views.py` içine
  `_caller_hq_permissions()` guard'ları + `effective_hq_sub_role()` (flat kolon yerine
  gerçek `HQMember` ilişkisi — School tarafındaki `school_sub_role` ile aynı hata deseni).
- School Bulgu #1 — `PATCH /api/school/profile/` izinsiz yazma (Critical #4): `views.py`'de
  `_SCHOOL_SETTINGS_FIELDS`/`_SCHOOL_HQ_ONLY_FIELDS` alan kısıtlaması + izin kontrolü.
- HQ Grup 3/4 — route guard + backend API yetkilendirme eksikliği (Yüksek #5): yeni
  `HQSectionGuardMiddleware` (`backend/core/section_guard.py`), School tarafındaki
  middleware'in HQ eşleniği.
- School Bulgu #2 — `POST /team/` ile owner daveti (Yüksek #6): `SchoolTeamView.post()`'a
  `only_owner_assigns_owner` kontrolü eklendi.
- Package "tüm ders tiplerine açık" eski paketlerde Save engeli (Yüksek #9,
  §2.7): `catalog/serializers.py::PackageSerializer.validate()` — zaten boş olan
  `allowed_lesson_types`'ı korumaya alan `was_already_empty` kontrolü.
- Ayrıca bu grupta: birkaç Yüksek/Orta madde daha (HQ dashboard izin kontrolsüz
  widget'lar, vb.) — tam liste için PR #44 diff'ine bakın.

**PR [#46](https://github.com/ExecutionAI-net/nounder40/pull/46) → `develop`, PR [#47](https://github.com/ExecutionAI-net/nounder40/pull/47) → `main` (senkron):**
- Orta #19 — Öğretmen Inbox'tan yeni konuşma başlatamıyor + `teacher_support`
  kanalının frontend'de hiç implementasyonu yoktu (§3.1 son madde). Backend
  (`chat/views.py::perform_create`, `_role_context()` içine `TeacherSchool`
  fallback — yine aynı "flat kolon boş, gerçek ilişki dolu" hata deseni,
  bu kez `active_school_id` için) + frontend (`teacher/inbox/page.tsx` baştan
  yazıldı: tab'lı liste + "New Message"; 5 dilde çeviri anahtarı eklendi).

### ✅ Fixlenip merge edilenler (devam) — `develop` + `main`

**PR [#49](https://github.com/ExecutionAI-net/nounder40/pull/49) → `develop`, PR [#50](https://github.com/ExecutionAI-net/nounder40/pull/50) → `main` (sync):**
- **Orta #16 — i18n: ham anahtar/placeholder etiketler** (`Label X`, `Col X`,
  `Kpi X`, `Title`, `Tab X` vb. — dört panelin ortak sorunu, bkz. §1.5, §1.6,
  §2.4 Bulgu #4, §3 son not, §4 i18n bulgusu). `frontend/messages/en.json`'daki
  ~300 placeholder değer gerçek İngilizce metinle değiştirildi (bir önceki
  oturumdan devralınan, doğrulanmamış diff) — detektör script'iyle
  doğrulandı, 0 gerçek eşleşme kaldı (kalan 2 eşleşme regex'in kendi yanlış
  pozitifi). **Ek bulgu:** aynı bug it/es/fr/de.json'da da vardı — aynı
  anahtarlar kelime kelime çevrilmiş placeholder metniyle duruyordu (ör. ES
  `labelBaseFee` → "Etiqueta de Tarifa Base", DE birden fazla sayfa başlığı
  → düz "Titel", FR `tabPayments` → "Onglet Paiements"). CLAUDE.md §5'teki
  "beş dosyanın hepsi güncellenir" kuralı gereği bu ~95 madde de düzeltildi.
  Backend test suite (`pytest`, tam kapsam) yeşil; tarayıcıda en/it/de
  üzerinden HQ Dashboard, HQ Packages, School Packages, School Compensation,
  Teacher Attendance, Teacher Library, Student Profile, Student Packages
  sayfaları canlı doğrulandı.

  **Scope dışı bırakıldı (bilinçli):** bu diff'in hiç dokunmadığı, EN'de hâlâ
  ham duran ayrı bir grup daha var (`Form Title`, `Freq Single`, `Confirm
  Password Label`, `Sc Active Packages` gibi ~50 madde, `hq/permissions`,
  `school/compensation`, `student/buy` vb. sayfalarda) — bunlar bu PR'ın
  kapsamına hiç girmemişti (önceki oturumun 300 satırlık diff'i bunları
  değiştirmemiş), ayrı bir fix turu gerektiriyor. Bir sonraki fix grubuna
  aday olarak not edildi (bkz. §0 "henüz bir fix grubuna atanmadı").

### ✅ Fixlenip merge edilenler (devam #2) — paralel oturumlarca, `develop`+`main`

Bu koordinasyon turunda görüldü ki, ben i18n (#16) ile uğraşırken **paralel
başka Claude Code oturumları** aşağıdaki bulguların hemen hepsini zaten
fixleyip `develop`'a merge etmişti (GitHub PR'ı olmadan, doğrudan
`git merge` + push ile — commit hash'leri referans olarak aşağıda). Ben
bunları keşfedip doğruladım (kod incelemesi + tarayıcıda canlı test +
`pytest` tam suite) ve gerçekten çözülmüş olduklarını teyit ettim:

- **Yüksek #7 + #8** — commit [`b270c38`](https://github.com/ExecutionAI-net/nounder40/commit/b270c38) (`fix/qa-course-delete-closures`):
  kurs silme artık "hayalet ders" bırakmıyor + Closure Days booking/ders
  üretiminde uygulanıyor.
- **Yüksek #9 (School tarafı) + Orta #14** — commit [`7281fc5`](https://github.com/ExecutionAI-net/nounder40/commit/7281fc5) (`fix/qa-school-forms`):
  eski "tüm ders tiplerine açık" paketlerde Save engeli kaldırıldı (School
  formu tarafı) + Course `credit_cost` yarım kredi (1.5) artık formda
  sessizce tam sayıya yuvarlanmıyor.
- **Yüksek #12** — commit [`d6620a5`](https://github.com/ExecutionAI-net/nounder40/commit/d6620a5) (`fix/qa-student-panel-misc`):
  booking takvim widget'ı artık aktif uygulama locale'ini takip ediyor (her
  zaman Türkçe render sorunu çözüldü). Aynı grup Bulgu #27 (Stripe checkout
  jenerik hata mesajı, Düşük #25) ve #7ff6e7c ile ilişkili "payment
  succeeded" mesajının ders bitiminden sonra da görünmesi sorununu da
  kapsıyor.
- **Yüksek #11 + Orta #18** — commit [`851c5c4`](https://github.com/ExecutionAI-net/nounder40/commit/851c5c4) (`fix/qa-teacher-panel-display`):
  "NO SHOW RATE" artık `%` ile gösteriliyor (33% gibi, ham sayı değil);
  Compensation tablosunda "Month" kopya-yapıştır hatası düzeltildi — ikinci
  sütun artık gerçekten `course`, "Students" başlığı artık `t()` üzerinden
  çevriliyor (canlıda `en/teacher/compensation` ve `en/teacher/performance`
  sayfalarında doğrulandı).
- **Orta #13(route guard) + Düşük #21 + Düşük #22 + Orta #17 + Düşük #23** —
  commit [`4cfb9ea`](https://github.com/ExecutionAI-net/nounder40/commit/4cfb9ea) (`fix/qa-hq-panel-hardening`):
  HQ panel sayfaları artık direkt URL ile korumasız açılmıyor; Dashboard
  "New School"/"Recent Schools" widget'ları izne bağlandı; `/hq/debug`
  artık yalnızca `NODE_ENV==='production'` dışında çalışıyor (kod
  incelemesiyle doğrulandı — dev ortamında bilerek hâlâ açık, bu doğru
  davranış); "Export C S V" → "Export CSV" düzeltildi (canlıda
  `/hq/payments` üzerinden doğrulandı); Lesson Types "Filter Entry" →
  "Entry" düzeltildi.
- **Yüksek #5 (ek sertleştirme) + Kritik #1-3 (ek sertleştirme)** — commit
  [`d69cab9`](https://github.com/ExecutionAI-net/nounder40/commit/d69cab9) (`fix/qa-hq-section-guard`):
  `HQRole.permissions` artık her `/api/hq/*` isteğinde granüler kontrol
  ediliyor (PR #44'teki ilk implementasyonun üzerine ek sertleştirme).
- **Orta #20b + Düşük #24 + Düşük #26b + Yüksek #13(nginx, yalnızca local dev)** —
  commit [`01b65f2`](https://github.com/ExecutionAI-net/nounder40/commit/01b65f2) (`fix/qa-backend-hardening-misc`):
  Django admin `permissions` ArrayField artık JSON-benzeri hatalı girişi
  reddediyor; `PATCH /api/school/teachers/{id}/` artık email çakışmasında
  `500` yerine temiz `400` dönüyor; `chat.Conversation`/`schools.SchoolClosure`
  modellerine `__str__` eklendi; local dev nginx CSRF sorunu (`$host` →
  `$http_host`) kalıcı olarak düzeltildi.
- **Yüksek #6 (ek doğrulama)** — commit [`4a47025`](https://github.com/ExecutionAI-net/nounder40/commit/4a47025) (`fix/qa-school-team-owner-invite`):
  PR #44'teki fix'in tekrar doğrulanması/sertleştirilmesi.

**PR [#53](https://github.com/ExecutionAI-net/nounder40/pull/53) → `develop`, PR [#54](https://github.com/ExecutionAI-net/nounder40/pull/54) → `main` (sync) — ben bizzat test edip merge ettim:**
- **Yüksek #10 + Düşük #26** — `TeacherAttendanceView.post()` artık henüz
  gerçekleşmemiş (gelecek tarihli/saatli) bir ders için yoklama kabul
  etmiyor (`400 lesson_not_yet_occurred`), `_apply_marks()`'ın ters
  `status_id` fallback mantığı düzeltildi. Yeni test dosyası
  `backend/bookings/tests/test_attendance_marking.py` (5 senaryo). Tam
  `pytest` suite yeşil, merge öncesi `develop` ile çakışmasız birleştiği
  doğrulandı.

**PR [#56](https://github.com/ExecutionAI-net/nounder40/pull/56) → `develop`, PR [#57](https://github.com/ExecutionAI-net/nounder40/pull/57) → `main` (sync) — arka plan agent'ı yazdı, ben test edip merge ettim:**
- **i18n'de kalan ikinci küme** (PR #49/#50'nin dokunmadığı, ~185 `en.json`
  anahtarı + 4 dilin eşdeğerleri, toplam 332 değer değişikliği): `Role
  Finance`→`Finance`, `Sc Expires`→`Expires`, `Confirm Password Label`→
  `Confirm Password`, `Section Plans`→`Plans`, `Lessons Teaught`→
  `Lessons Taught` (yazım hatası, JSON key'i dokunulmadı bırakıldı — kodda
  referans var) vb. **Yol boyunca 2 gerçek fonksiyonel bug da bulundu ve
  düzeltildi**: `student.book.spotsLeft`/`noLessonsFoundIn`,
  `school.courses.detail.selectedCount`, `student.profile.docExpires`
  mesaj string'lerinde ICU interpolasyon yer tutucusu (`{count}`/`{city}`/
  `{date}`) hiç yoktu — kod doğru şekilde `t('spotsLeft', {count})` çağırıyordu
  ama string'de yer tutucu olmadığından sayı/şehir/tarih render'da sessizce
  kayboluyordu (5 dilin hepsinde). Canlıda doğrulandı: `/student/book`
  artık "10 spots left" gösteriyor, önceden sadece "spots left" idi. Ben
  ayrıca agent'ın gözden kaçırdığı 2 anahtarı (`hq.packages.placeholderNameEN`/
  `placeholderNameIT`, 5 dilde) manuel tamamladım. Tam `pytest` suite yeşil,
  tarayıcıda HQ Permissions/Teacher Performance/Teacher Compensation/Student
  Book sayfalarında canlı doğrulandı.

Bu turda ele alınan **tüm** madde artık `develop` + `main`'de. QA'de
kayıtlı hiçbir Kritik/Yüksek/Orta/Düşük bulgu açık kalmadı (bkz. §
"Bilinçli olarak ele alınmayan" — geri kalanlar zaten bug değil).

### ⏸️ Bilinçli olarak ele alınmayan (scope dışı, hâlâ geçerli)

- QA seed verisi `example.test` URL'leri (Teacher Library) — uygulama kodu değil.
- Waitlist öğrenci UI'ı — CLAUDE.md'de zaten kayıtlı bilinçli boşluk.
- Düşük #27 — bazı butonlarda otomasyon-tıklama şüphesi (belirsiz/kanıtlanamadı,
  gerçek kullanıcı fare/dokunmatik ile sorunsuz çalıştığı doğrulandı).

---

## 1. HQ Paneli

**Durum:** Rol & izin testi tamamlandı (5 kritik/yüksek bulgu). Fonksiyonel
tarama da yapıldı: sayfa envanteri (§1.4) + tüm `/api/hq/*` list endpoint'leri
sağlık kontrolünden geçirildi (§1.5). UI'da tarayıcı render zaman aşımları
nedeniyle Shop/Translations/Email Templates gibi sayfalarda School kadar
derin CRUD denemesi yapılamadı — bu sayfalar bir sonraki turda daha detaylı
ele alınabilir.

### 1.1 Yetenek/İzin Envanteri

7 builtin `HQRole`: `owner`, `super_admin`, `operations`, `finance`,
`tech_support`, `analytics`, `support` (+ HQ özel rol ekleyebilir,
`/hq/permissions` sayfasından).

18 izin anahtarı (`HQRole.permissions`): `dashboard, schools_view,
schools_create_edit, schools_activate, schools_platform_fee, payments,
reports, inbox, library, shop, packages, lesson_types, team, permissions,
homepage_settings, locations, translations, email_templates`.

| Rol | Beklenen izinler |
|---|---|
| owner | tüm 18 (FULL) |
| super_admin | tüm 18 (FULL) — DB'de owner ile birebir aynı |
| operations | dashboard, schools_view, schools_create_edit, schools_activate, inbox, library, shop, packages, lesson_types, homepage_settings, locations |
| finance | dashboard, schools_view, schools_platform_fee, payments, reports |
| tech_support | dashboard, inbox |
| analytics | dashboard, schools_view, reports |
| support | dashboard, inbox |

### 1.2 Senaryo Grupları ve Sonuçlar

| # | Grup | Sonuç |
|---|---|---|
| 1 | Kimlik doğrulama & dashboard rozeti | ✅ PASS (7/7 rol) |
| 2 | Sidebar/nav görünürlüğü (7 rol × 18 izin) | ✅ PASS (sidebar) / ⚠️ dashboard widget'ları hariç |
| 3 | Doğrudan URL erişimi (route guard) | ❌ FAIL — route guard yok |
| 4 | Backend API yetkilendirmesi | ❌ FAIL — granüler kontrol yok (okuma + yazma) |
| 5 | Permissions matrisi editörü (CRUD) | ✅ PASS (builtin/role_in_use koruması) — ama bkz. Grup 6 yetki yükseltme |
| 6 | Team yönetimi + yetki yükseltme | ❌ **CRITICAL FAIL** (4 ayrı escalation) |
| 7 | owner vs super_admin farkı | ✅ Beklendiği gibi — ikisi de DB'de eşdeğer, davranış aynı |
| 8 | Özel rol & uç durumlar | ✅ PASS |

#### Grup 1 — Kimlik doğrulama & dashboard rozeti ✅
7 QA hesabının tamamı (`owner, super_admin, operations, finance,
tech_support, analytics, support`) dev ortamında sorunsuz login oldu, sidebar
üstünde doğru isim/e-posta gösterildi, dashboard'da rol rozeti (`OWNER` vb.)
doğru göründü.

#### Grup 2 — Sidebar görünürlüğü ✅ (nav) / ⚠️ (dashboard widget'ları)
Her 7 rol tek tek login edilip sidebar linkleri `read_page` ile karşılaştırıldı.
**Sidebar filtrelemesi 7 rolde de beklenen izin setiyle birebir eşleşti** —
eksik yok, fazlalık yok:
- owner/super_admin: 16/16 sayfa
- operations: 10/10 (dashboard, schools, packages, lesson-types, inbox,
  library, shop, homepage-settings, brand-settings, locations)
- finance: 4/4 (dashboard, schools, payments, reports)
- analytics: 3/3 (dashboard, schools, reports)
- tech_support: 2/2 (dashboard, inbox)
- support: 2/2 (dashboard, inbox)

**⚠️ Bulgu (Orta önem):** HQ Dashboard'daki **"New School" butonu** ve
**"Recent Schools" widget'ı** (okul kartlarına tıklanabilir linkler + "View
All") **hiçbir izne bağlı değil** — `finance`, `tech_support`, `analytics`,
`support` gibi `schools_view`/`schools_create_edit` izni olmayan roller bile
bunları dashboard'da görüyor ve tıklayabiliyor.
`frontend/src/app/[locale]/hq/dashboard/page.tsx` içindeki bu widget'lar
permission check'siz render ediliyor.

#### Grup 3 — Doğrudan URL erişimi ❌
`support` hesabıyla (izinleri: yalnızca `dashboard`, `inbox`) sidebar'da
görünmeyen sayfalara doğrudan URL ile gidildi:
- `https://dev.../en/hq/permissions` → **sayfa tam olarak render oldu**,
  gerçek rol/izin matrisi görüntülendi (owner/super_admin/finance/…
  hepsinin izinleri).
- `https://dev.../en/hq/team` → **sayfa tam olarak render oldu**, gerçek HQ
  ekibi (C. Carlo, Hakan Timur dahil) tam listeyle görüntülendi, "Invite
  Member" formu açıldı ve **Role dropdown'unda "Owner" dahil her rol
  seçilebiliyordu** (form iptal edildi, gönderilmedi).

Sebep: `frontend/src/lib/api/guards.tsx`'teki `useRequireRole('hq')` sadece
"rol=hq mi?" kontrolü yapıyor; her `/hq/*` sayfası için ayrı bir izin kontrolü
yok. `HQLayout` sadece **sidebar'ı** izinlere göre filtreliyor, sayfa
render'ını değil.

#### Grup 4 — Backend API yetkilendirmesi ❌
`support` (izin: dashboard+inbox) ve `tech_support` (izin: dashboard+inbox)
token'larıyla ilgisiz uçlara istek atıldı:

| Uç (GET) | support | tech_support | Beklenen |
|---|---|---|---|
| `/api/hq/permissions/` | 200 | — | 403 |
| `/api/hq/team/` | 200 | — | 403 |
| `/api/hq/schools/` | 200 | 200 | 403 |
| `/api/hq/packages/` | 200 | 200 | 403 |
| `/api/hq/lesson-types/` | 200 | — | 403 |
| `/api/hq/library/` | 200 | — | 403 |
| `/api/hq/shop/` | 200 | — | 403 |
| `/api/hq/reports/` | 200 | — | 403 |
| `/api/hq/translations/` | — | 200 | 403 |
| `/api/hq/email-templates/` | — | 200 | 403 |
| `/api/hq/discount-codes/` | — | 200 | 403 |

**Yazma (write) testi de yapıldı:** `tech_support` token'ıyla
`POST /api/hq/packages/` çağrılarak gerçek bir HQ paketi **oluşturuldu**
(`201 Created`, id `15d458e4-…`) — hiçbir `packages` izni olmadan. Test
paketi hemen `DELETE` ile temizlendi (`204`, sonra `404` doğrulandı).

Sebep: `backend/accounts/permissions.py`'deki `IsHQ` sadece `user.role=='hq'`
kontrolü yapıyor. Okul tarafındaki `SchoolSectionGuardMiddleware`
(`backend/core/section_guard.py`) eşleniği HQ tarafında **yok**.
`backend/core/tests/test_hq_reads.py` da yalnızca "öğrenci vs HQ" ayrımını
test ediyor, HQ alt-rolleri arasında hiçbir ayrım test etmiyor — kodun kendisi
zaten bunu yapmıyor.

#### Grup 5 — Permissions matrisi editörü (yetkili kullanıcı ile CRUD) ✅
`owner` token'ıyla:
- Builtin rol (`support`, `finance`) silme denemesi → `400
  {"error":"builtin roles cannot be deleted"}` ✅ doğru davranış.
- Özel rol oluşturma (`POST /api/hq/permissions/` `{"label":"QA Priv
  Test",...}`) → `201`, key otomatik slugify edildi (`qa-priv-test`) ✅.
- Üyesi olan bir role silme denemesi (`role_in_use`) → `qa.hq.support`
  geçici olarak bu role atanıp silme denendi → `400
  {"error":"role_in_use","count":1}` ✅ doğru davranış. Sonra support eski
  rolüne geri alındı, üye sayısı 0 olunca silme `204` ile başarılı oldu ✅.

Kendi başına bu CRUD mantığı doğru çalışıyor — **fakat** bu uçların hangi
kullanıcı tarafından çağrılabildiği kontrol edilmiyor (bkz. Grup 6).

#### Grup 6 — Team yönetimi + Yetki Yükseltme ❌ **KRİTİK**
`HQMemberViewSet` ve `HQRoleViewSet`'te **çağıran kullanıcının kendi
`hq_sub_role`'üne göre hiçbir yetki kontrolü yok** (okul tarafındaki
owner/admin/staff hiyerarşisinin HQ eşleniği yok). Frontend'de
`callerSubRole==='owner'` kontrolü sadece buton/dropdown'ları gizliyor,
backend hiçbir şeyi reddetmiyor. 4 senaryo da **canlı olarak doğrulandı**:

1. **Kendini owner yapma (dev'de test edildi, geri alındı):**
   `support` hesabı `PATCH /api/hq/team/<kendi id>/ {"sub_role":"owner"}`
   çağırdı → `200`, `hq_sub_role` gerçekten `owner` oldu (`/api/auth/me/` ile
   doğrulandı). Hemen `support`'a geri alındı ve doğrulandı.
2. **Kendi rolünün izinlerini yükseltme (dev'de test edildi, geri alındı):**
   `support` hesabı kendi rolü olan `support`'un `permissions` dizisine
   `PATCH /api/hq/permissions/support/ {"permissions":["dashboard","inbox",
   "team","permissions"]}` ile `team` ve `permissions` ekledi → `200`, kabul
   edildi. Bu, o role sahip **her** kullanıcıyı kalıcı olarak etkiler (dev'de
   sadece QA hesabı vardı, hemen orijinal `["dashboard","inbox"]`'a geri
   alındı).
3. **Owner'ı silme (yalnızca local'de test edildi — dev'de geri dönüşü
   olmayan bir silme riski taşıdığından):** `support` hesabı
   `DELETE /api/hq/team/<owner id>/` çağırdı → `204 No Content`, owner HQ
   ekibinden tamamen silindi. `qa_platform seed` ile geri yüklendi ve
   doğrulandı.
4. **Kendini silme (yalnızca local'de test edildi):**
   `support` hesabı kendi `HQMember` kaydını `DELETE` ile sildi → `204`.
   Aynı şekilde geri yüklendi.

Ayrıca UI üzerinden `support` hesabıyla `/hq/team` sayfasında "Invite
Member" formu açılıp **Role dropdown'unda "Owner" seçilebildiği** görsel
olarak doğrulandı (form gönderilmedi, e-posta atılmadı).

Karşılaştırma: okul tarafında bu tam olarak korunuyor —
`backend/schools/views.py` `SchoolTeamView` içinde `only_owner_assigns_owner`,
`cannot_remove_self`, admin owner'ı silemez gibi kontroller var
(`backend/schools/tests/test_team_delete_permissions.py` ile test edilmiş).
**HQ tarafında bunların hiçbiri yok.**

#### Grup 7 — owner vs super_admin ✅ (beklenen davranış, tasarım notu)
İkisi de DB'de birebir aynı 18 izne sahip. `super_admin` token'ıyla: özel rol
oluşturma/silme ✅ başarılı, `owner` hesabının `HQMember.phone` alanını
`PATCH` etme ✅ başarılı (sonra geri alındı). Yani `super_admin`, koddaki
`canEdit = callerSubRole==='owner'||'super_admin'` mantığıyla tutarlı şekilde
owner ile eşdeğer çalışıyor — bu bir hata değil, ama Grup 6'daki backend
boşluğu nedeniyle **aslında `support` dahil her HQ rolü** bu eşdeğerliğe
kendini yükseltebiliyor.

#### Grup 8 — Özel rol & uç durumlar ✅
- Özel rol oluşturma/silme akışı (yukarıda) sorunsuz.
- `role_in_use` ve `builtin` silme koruması doğru çalışıyor.
- (Geçersiz/orphan `hq_sub_role` senaryosu kod incelemesiyle doğrulandı:
  `role_choice_form` orphan değeri "invalid" olarak gösteriyor, frontend nav
  boş listeye düşüyor — canlıda ayrıca test edilmedi, düşük öncelik.)

### 1.3 Ortam Temizliği
Dev ortamında oluşturulan tüm test verileri temizlendi: test paketi
(`15d458e4-…`) silindi, özel rol (`qa-priv-test`, `qa-sa-equiv-test`)
silindi, `qa.hq.support` ve `qa.hq.owner` orijinal `sub_role`/`phone`
değerlerine geri alındı. Local ortamdaki silme testleri `qa_platform seed`
ile tam geri yüklendi ve doğrulandı. Gerçek hesaplara (`c.carlo@…`,
`hakantimur55@…`) hiçbir yazma işlemi yapılmadı.

### 1.4 Sayfa Envanteri (owner ile, tam nav)
Dashboard, Schools, Team, Permissions, Packages, Lesson Types, Payments,
Inbox, Library, Shop, Reports, Homepage, Look & top bar (brand-settings),
Countries & Locations, Translations, Email Templates. (+ `/hq/debug`, nav'da
yok ama role="hq" olan herkese açık — bkz. Explore ajanı notu.)

### 1.5 Fonksiyonel Sağlık Kontrolü
Tüm `/api/hq/*` list endpoint'leri `owner` token'ıyla tek tek çağrıldı,
hepsi `200` döndü ve makul veri boyutu taşıdı: `schools/` (4 okul),
`packages/` (boş, `[]`), `lesson-types/` (12 tip), `library/` (3 içerik),
`shop/`, `translations/` (~395KB — çok sayıda çeviri anahtarı),
`email-templates/` (~119KB), `homepage-settings/`, `reports/`,
`discount-codes/` (boş). Hiçbir 500/404 görülmedi.

**Lesson Types sayfası (UI):** 12 kayıt doğru listeleniyor (kod, isim,
seviye, diller, aktif/pasif durumu, Edit/Copy/Deactivate/Delete aksiyonları).
`New` butonuna tıklama bir modal/form açmadı (tarayıcı render zaman aşımı mı
yoksa gerçek bir sorun mu net değil — doğrulanamadı, bir sonraki turda tekrar
denenmeli).

**i18n bulgusu — HQ paneli de dahil:** Dashboard başlığı düz `Title`,
Lesson Types sayfasındaki aksiyon linkleri `Action Edit`/`Action Copy`/
`Action Deactivate` olarak ham anahtar gösteriyor. Yani Bulgu #4/#9 aslında
**dört panelin de ortak sorunu** — HQ dahil.

**Not — tarayıcı kararlılığı:** Bu turda `computer:screenshot` çağrıları sık
sık "Screenshot timed out" hatası verdi (uzun oturum/yüksek sayfa yükü
olabilir); bu yüzden HQ'nun Shop/Translations/Email Templates/Homepage gibi
içerik-ağırlıklı sayfalarında School kadar derin CRUD denemesi (create/edit/
delete varyasyonları) bu oturumda tamamlanamadı. `get_page_text` ve API
sağlık kontrolleriyle devam edildi; kalan derin CRUD testi bir sonraki tur
için not edildi.

### 1.6 Derin Fonksiyonel Test Turu (Delta — ayrı QA ajanı, tam detay `QA_TEST_RESULTS_HQ_DELTA.md`)

**Tam CRUD döngüsü uçtan uca doğrulanan alanlar (UI + API):** Lesson Types
(create/edit/copy/deactivate/delete + delete-in-use koruması), Team
(invite→validate→approve→edit→remove), Permissions (özel rol
create/toggle/save/delete), HQ Packages (create/edit/deactivate/delete),
Shop ("Hidden from students" toggle, Table/Storefront görünümü, Discount
codes formu), Homepage/Brand Settings (no-op round-trip), Email Templates
editörü (dil sekmeleri, HTML/Preview, değişken ekleme), Translations
(arama, "Missing only" filtresi).

**Yeni bulgular:**
- 🟡 **Orta — i18n bulgusu çok daha geniş kapsamlı**: `/hq/translations`
  arama kutusuyla ölçüldü — `Label ` → **123 anahtar**, `Column ` → 18,
  `Status ` → 20, `Kpi ` → 25 (önceki turda bilinen `Col `→50, `Action `→7,
  `Label Description`→7'ye ek). **Kök neden `/hq/debug` sayfasında doğrudan
  kanıtlandı**: `messages.hq.dashboard` JSON'unda `"title": "Title"`,
  `"kpiActiveSchools": "Kpi Active Schools"` gibi EN değerleri **literal
  olarak anahtar adının insan-okunur hali** olarak duruyor — gerçek metin
  hiç yazılmamış. Şimdi doğrulanan sayfalar: Dashboard, Lesson Types,
  Packages, Shop, Payments, Reports, Homepage Settings, Library, Inbox
  (School/Teacher/Student ile birlikte artık **her 4 panel**).
- 🟡 Orta — "Export CSV" butonu "**Export C S V**" olarak render oluyor
  (Payments ve Reports) — buton fonksiyonel olarak çalışıyor (istemci
  tarafı CSV üretimi), sadece metin bozuk.
- 🟢 Düşük — Lesson Types formunda "Level" alanı yanlış çeviri anahtarına
  bağlı: "Entry" yerine "**Filter Entry**" gösteriyor (değer doğru, sadece
  görünen metin filtre bağlamından sızmış).
- 🟢 Düşük — **`/hq/debug`**: nav'da yok ama herhangi bir HQ rolü doğrudan
  URL ile erişebiliyor, tüm `messages.hq` çeviri ağacını ham JSON olarak
  döküyor. Hassas veri yok ama prod'a gitmemesi gereken bir dev-debug aracı
  — kaldırılması veya `NODE_ENV` ile korunması önerilir.
- 🟢 Düzeltme (bug değil): `qa-lesson-type` (kod: `qa-lesson-type`) HQ
  Lesson Types listesinde duran bir kayıt — bu bir **önceki QA turunun
  temizlenmemiş artığı değil**, `qa_platform.py` seed komutunun kasıtlı
  olarak oluşturduğu ve "QA Course"un kullandığı gerçek bir sabit fixture.
  Silinmemeli.

**Doğrulanan yanlış-pozitifler (ürün hatası değil, otomasyon/oturum
çakışması):** Lesson Types "New" butonu (önceki turda "form açılmadı"
denmişti — bu turda form açıldığı, sadece scroll gerektirdiği doğrulandı),
Packages "New Package" butonu, Reports "Teachers" sekmesi, Email Templates
dil/HTML sekmeleri, Translations "Missing only" — hepsi ya ekran görüntüsü
zamanlama sorunuydu ya da `button.click()` ile JS-dispatch gerektirdi;
gerçek kullanıcı tıklamasında sorun yok.

---

## 2. School Paneli

**Durum: devam ediyor** (rol/izin + çekirdek iş akışları test edildi;
Teachers/Compensation/Documents/Reports/Locations/Settings sayfaları henüz
detaylı test edilmedi)

### 2.1 Yetenek/İzin Envanteri

3 builtin `SchoolRole`: `owner` (Titolare), `admin` (Amministratore), `staff`.
17 izin anahtarı: `dashboard, locations, calendar, courses, lessons, teachers,
compensation, students, packages, payments, documents, inbox, reports,
settings, attendanceStatuses, manualCredits, team`.

| Rol | İzinler |
|---|---|
| owner | tüm 17 |
| admin | tüm 17 — **matriste owner ile birebir aynı**; owner/admin farkı yalnızca `SchoolTeamView`'in hard-code hiyerarşi mantığında var, matriste yok |
| staff | dashboard, calendar, courses, lessons, students, documents, inbox, manualCredits (8/17) |

**Önemli mimari fark (HQ'nun aksine iyi haber):** School tarafında gerçek bir
sunucu taraflı yetkilendirme var: `SchoolSectionGuardMiddleware`
(`backend/core/section_guard.py`) her `/api/school/<segment>/` isteğini
`SchoolRole.permissions`'a göre kontrol ediyor (`403 section_forbidden`), ve
frontend'de `SECTION_PATHS` (`SchoolLayout.tsx`) URL'e doğrudan gidilse bile
`/school/dashboard`'a geri yönlendiriyor. **Ama `profile` segmenti bu
haritanın dışında bırakılmış** — bkz. 2.2 Bulgu #1.

### 2.2 Rol/İzin Test Sonuçları

| Test | Sonuç |
|---|---|
| Middleware: staff `teachers/`, `closures/`, `locations/`, `compensation-plans/` GET (lookup-reader istisnası) | ✅ mevcut otomatik testlerle doğrulanmış (`test_section_guard.py`) |
| Middleware: staff `compensation-payments/`, `transactions/`, `team/` GET | ✅ 403 (mevcut testlerle doğrulanmış) |
| Middleware: staff POST'ta lookup-reader istisnası uygulanmıyor | ✅ mevcut testlerle doğrulanmış |
| Team DELETE hiyerarşisi (staff/admin/owner, kendini silme, çapraz-okul) | ✅ mevcut testlerle doğrulanmış (`test_team_delete_permissions.py`, 6 senaryo) |
| **`PATCH /api/school/profile/` — staff ile yetkisiz okul ayarı değiştirme** | ❌ **KRİTİK FAIL** — canlıda doğrulandı |
| **`POST /api/school/team/` — admin ile yetkisiz owner daveti** | ❌ **YÜKSEK FAIL** — canlıda doğrulandı |
| `POST /api/school/team/` — staff ile deneme (middleware kontrolü) | ✅ doğru şekilde 403 `section_forbidden` |

#### Bulgu #1 — `PATCH /api/school/profile/` izinsiz yazılabiliyor ❌ KRİTİK
`profile` URL segmenti `SECTION_BY_SEGMENT` haritasında yok → middleware'den
tamamen muaf ("altyapı, her zaman izinli" yorumu ile bilinçli bırakılmış).
`SchoolSerializer` `fields = "__all__"` kullanıyor, alan kısıtlaması yok.
Sonuç: **`settings` izni olmayan `staff` rolü bile `School` modelinin HERHANGİ
bir alanını değiştirebiliyor** — `platform_fee_percentage`,
`shop_commission_percentage`, `stripe_account_id`, `stripe_onboarding_complete`,
`active`, `owner`, `cancellation_policy_hours`, `min_booking_notice_hours` dahil.

**Canlıda doğrulandı (dev):** `qa.school.staff` ile
`PATCH /api/school/profile/ {"cancellation_policy_hours":999}` → `200`,
değer gerçekten 24'ten 999'a değişti. Hemen 24'e geri alındı ve doğrulandı.
Aynı yol teorik olarak `platform_fee_percentage=0` veya `active=false` için de
açık (finansal/operasyonel risk nedeniyle bunlar denenmedi).

Hem "Profile" hem "Settings" sayfaları aynı bu endpoint'i çağırıyor;
"Settings" sayfası frontend'de `SECTION_PATHS` ile korunuyor ama backend'de
karşılığı yok — sadece URL'i bilen/API'yi doğrudan çağıran biri için koruma
sıfır.

#### Bulgu #2 — `admin`, `owner` hiyerarşi kontrolünü `POST /team/` ile atlayabiliyor ❌ YÜKSEK
`SchoolTeamView.PATCH`'te `only_owner_assigns_owner` kontrolü var (yalnızca
mevcut owner başka birini owner yapabilir), ama **aynı kontrol `POST`
(davet) yolunda yok**. `admin` rolü owner ile aynı `team` iznine sahip olduğu
için, **yepyeni bir üyeyi doğrudan `school_sub_role: "owner"` ile davet
edebiliyor** — davet kabul edildiğinde ikinci bir owner doğar, hiçbir owner
onayı olmadan.

**Canlıda doğrulandı (dev):** `qa.school.admin` ile
`POST /api/school/team/ {"email":"qa.priv.esc.owner@qa-nounder40.test",
"school_sub_role":"owner"}` → `201`, `role_detail:"owner"` ile bekleyen davet
oluştu (henüz kabul edilmedi, gerçek üyelik değil — davet linkine tıklanıp
şifre belirlenmesi gerekiyor). Davet owner hesabıyla iptal edilip temizlendi
(`DELETE /api/school/team/ {"id":13}`). Frontend'de de davet formunun Role
dropdown'unda "Owner" seçeneği `admin` için gizlenmiyor (sadece *edit*
modalında filtreleniyor, *invite* formunda değil).

`staff` aynı isteği attığında middleware doğru şekilde `403
section_forbidden` döndürdü (staff'ta `team` izni yok) — sorun özellikle
`admin` seviyesinde.

### 2.3 Fonksiyonel Test Sonuçları (Courses / Lessons / Packages / Booking)

| # | Senaryo | Sonuç |
|---|---|---|
| 1 | Yeni kurs oluşturma (haftalık recurring, lesson type + öğretmen seçimi) | ✅ 17 haftalık ders doğru üretildi |
| 2 | Zorunlu alan validasyonu (tarih/saat boşken submit) | ✅ "Error Start Date Time" doğru gösterildi |
| 3 | Tekil ders düzenleme (tek bir haftanın saatini değiştirme) | ✅ yalnızca o hafta değişti, seri etkilenmedi; Edit Course'da "Schedule 1/2" olarak doğru ayrıştı |
| 4 | Kurs silme (17 dersli) | ⚠️ `204` dönüyor ama bkz. Bulgu #3b — dersler silinmiyor, sahipsiz kalıyor |
| 5 | Kredi paketi oluşturma (çoklu dil isim, validity, lesson-type kısıtlama) | ✅ |
| 6 | **Auto-renewing / "Subscription" paket** (`PACKAGE_TO_SUBSCRIPTION.md` — tek motor kararı) | ✅ doğru oluştu, "↻ Subscription · Monthly" rozeti göründü |
| 7 | Yarım kredi adımı — **Package.credits = 12.5** | ✅ doğru kaydedildi, `12.5 credits · 1 per lesson · €8.00 per credit` doğru hesaplandı |
| 8 | Yarım kredi adımı — **Course.credit_cost = 1.5** (yeni kurs formu + edit formu) | ❌ **BUG** — bkz. Bulgu #3 |
| 9 | Manuel kredi tanımlama (`POST /api/school/credits/grant/`) | ✅ öğrenciye 10 kredi doğru tanımlandı |
| 10 | Ders rezervasyonu (`POST /api/bookings/`) | ✅ kredi doğru düşüldü (10→8, sonra →7 üçüncü rezervasyonda) |
| 11 | **İptal — politika eşiğinin ALTINDA** (~13 saat kala) | ✅ `cancellation_type:"outside_policy"`, `credit_refunded:false` — kredi doğru yandı |
| 12 | **İptal — politika eşiğinin ÜSTÜNDE** (~61 saat kala) | ✅ `cancellation_type:"within_policy"`, `credit_refunded:true` — kredi doğru iade edildi |
| 13 | **No-show işaretleme** | ✅ kredi her koşulda yanıyor (iade yok), `booking_status:"no_show"` doğru |

**Domain kuralı doğrulaması (CLAUDE.md §4.4): "İptal politikası: eşik
üstündeyse iade, altındaysa yanar; no-show her zaman yakar."** → **tam
doğrulandı, hatasız çalışıyor.** Bu, platformun en kritik para/kredi mantığı
olduğu için önemli bir güvence.

#### Bulgu #3 — Course "Credits per single lesson" alanı yarım kredi değerini kaydetmiyor 🟡 ORTA
CLAUDE.md domain kuralı: "Krediler Decimal, yarım kredi adımlı." Backend bunu
doğru destekliyor (`Course.credit_cost` alanına doğrudan API'den `1.5`
gönderilince sorunsuz kaydediliyor, doğrulandı). **Ama** hem "New Course" hem
"Edit Course" frontend formundaki "Credits per single lesson" input'u
(step=0.5 olarak doğru ayarlanmış) kullanıcı `1.5` girip formu kaydettiğinde
değeri sessizce `1.0`'a yuvarlıyor. İki kez doğrulandı (yeni kurs oluştururken
ve mevcut kursu düzenlerken). Muhtemel sebep: formun state/submit
mantığındaki bir `parseInt`/yuvarlama adımı. **Not:** Aynı sorun `Package`
formunda YOK — paket kredisi (12.5) doğru kaydedildi, yani bug Course'a özgü.

#### Bulgu #3b — Kurs silme, derslerini silmiyor; "hayalet ders" bırakıyor 🔴 YÜKSEK
`DELETE /api/school/courses/{id}/` `204` döndürüyor ve kurs kaydını
kaldırıyor, **ama kursun ürettiği `Lesson` kayıtlarını silmiyor** — bunun
yerine `Lesson.course` alanını `NULL`'a düşürüyor (muhtemelen FK
`on_delete=SET_NULL`, `CASCADE` değil). Sonuç: silinen bir kursun **tüm
gelecekteki dersleri "sahipsiz" olarak yaşamaya devam ediyor** — hâlâ gerçek
tarih/saat/öğretmenle takvimde duruyor, öğretmenin dashboard'unda
("QA Lesson Type, Wednesday Sep 9 · 19:00–20:00" gibi) görünüyor, ve
muhtemelen öğrenciler tarafından hâlâ rezerve edilebiliyor (course=None
olsa da Lesson kaydı `lesson_type`/`teacher`/`max_capacity` alanlarını
koruyor).

**Canlıda doğrulandı:** Test kursu (17 ders) silindikten sonra
`GET /api/school/lessons/?date_after=...` ile 17 dersin hepsinin
`course: null` olarak hâlâ var olduğu görüldü; öğretmenin dashboard'unda
bir tanesi (Sep 9, 19:00) doğrudan gözlemlendi. 17 ders de tek tek
`DELETE /api/school/lessons/{id}/` ile manuel temizlendi (dev ortamı artık
temiz). **Gerçek okullarda bir kurs silindiğinde bu, okulun takviminde
kalıcı "hayalet dersler" birikmesine yol açar** — kullanıcı fark etmeden
haftalar/aylar boyunca sahipsiz derslerin öğretmen takviminde ve olası
öğrenci rezervasyonlarında kalması ciddi bir veri bütünlüğü sorunu.

### 2.4 UI/i18n Bulguları

#### Bulgu #4 — Çevrilmemiş/kırık etiketler (varsayılan `en` locale) 🟡 ORTA
"New Course", "Edit Course", "Packages", "Add Teacher" ve "Settings"
sayfalarında birden fazla alan etiketi ham i18n-anahtar biçiminde (çoğu
kırmızı renkte) görünüyor — gerçek çeviri metni yerine: `Label Description`,
`Label Notes`, `Label Lesson Type`, `Label Default Teacher`, `Label Email`,
`Label Phone`, `Col Credits`, `Col Total Price`, `Col Price Per Credit`,
`Col Valid For`, sayfa başlığı yerine düz `Title`, "Add" butonu yerine
`Add Btn`. En az 5 farklı sayfada görüldü — izole bir yazım hatası değil,
sistemik bir regresyon. Varsayılan locale (`en`, `NEXT_PUBLIC_APP_URL`
üstünden herkesin ilk gördüğü dil) etkilendiği için görünürlüğü yüksek.
CLAUDE.md'nin i18n bölümündeki "ICU tuzağı" uyarısıyla aynı aileden bir sorun
olabilir (anahtar dizide var ama render edilirken bulunamıyor olabilir) —
kaynağı `frontend/messages/en.json`'da ilgili anahtarların eksik/yanlış
isimlendirilmiş olması.

### 2.6 Diğer Sayfalar — Hızlı Fonksiyonel Kontrol
| Sayfa | Sonuç |
|---|---|
| Locations — yeni lokasyon ekleme | ✅ oluşturuldu, "Add Room" alt akışı görünür; API ile temizlendi |
| Documents | ✅ boş durum doğru render ediliyor (öğrenci/belge yok) |
| Teachers — liste + "Add Teacher" formu | ✅ liste doğru; davet formu açılıyor (gerçek e-posta gitmesin diye gönderilmedi) |
| Settings — Operational Rules / Required Documents / Closure Days bölümleri | ✅ render doğru (i18n etiket sorunu hariç, bkz. Bulgu #4) |

### 2.5 Ortam Temizliği
Dev ortamında oluşturulan test verileri temizlendi: test kursu (17 ders),
test paketi, bekleyen "owner" daveti, `cancellation_policy_hours` değeri
(999→24). Booking/kredi/iptal/no-show testleri **yalnızca local** ortamda
yapıldı (qa.student'ın dev'de gerçek bir okula — Danza Clásica Barcelona —
bağlı olduğu tespit edildiği için dev'de dokunulmadı); local veri tabanı bu
testler için kalıcı olarak değişti ama tamamen izole ve tek kullanıcılı bir
ortam olduğundan sorun teşkil etmiyor.

**Yan bulgu:** dev ortamındaki `qa.student` hesabı `qa-test-school`'a değil,
gerçek "Danza Clásica Barcelona" okuluna bağlı — muhtemelen önceki bir
oturumda oluşan veri kirliliği. `qa_platform seed`'in student-school
düzeltme mantığı (`if student.school_id != school.id: ...`) idempotent
olmasına rağmen bunu düzeltmemiş olabilir ya da seed sonrasında ayrı bir
işlemle değişmiş olabilir; dev ortamında tekrar `qa_platform seed`
çalıştırılması önerilir (bunu yapabilmek için sunucuya erişimim yok).

### 2.7 Derin Fonksiyonel Test Turu (Delta — ayrı QA ajanı, tam detay `QA_TEST_RESULTS_SCHOOL_DELTA.md`)

**Tam uçtan uca doğrulanan alanlar:** Teachers davet/edit/resend/remove
akışı, Compensation hesaplaması (School ve Teacher tarafı **birebir
uyuşuyor**), Manual credit UI (0.5 kredi hassasiyeti doğru), Documents
zorunluluğu × booking engeli (toggle açık/kapalı her iki yönde doğrulandı —
**bu turun en güçlü pozitif bulgusu**), Package deactivate/reactivate,
Location+Room iç içe yapısı ve silme, Calendar öğretmen filtresi + ders
detay popup'ı + "+Add class" kısayolu.

**Yeni bulgular:**
- 🟠 **Yüksek — Closure Days (kapanış günleri) kaydediliyor ama HİÇBİR
  yerde uygulanmıyor.** Bir okul "tatil/kapalı" günü tanımlayınca UI
  yetkili görünüyor ama `SchoolClosure` modeli `bookings/` veya `catalog/`
  (ders üretimi) kodunda **hiç referans edilmiyor** (tüm backend'de grep
  edildi). Canlı doğrulama: kapanış günü tanımlanan bir tarihte ders
  rezervasyonu **sorunsuz başarılı oldu**, kredi düşürüldü, hiçbir uyarı
  yok. O tarihte zaten planlanmış dersler de otomatik iptal edilmiyor.
- 🟠 **Yüksek → Orta — Package Edit/Duplicate, "tüm ders tiplerine açık"
  eski paketlerde kalıcı olarak bozuk.** Sonradan eklenen bir istemci-tarafı
  doğrulama ("en az bir ders tipi seç") eski `allowed_lesson_types: []`
  (= "tüm tipler") paketlerini **Save'i tamamen engelliyor** — hem Edit hem
  Duplicate. Tek çözüm yolu ders tipini elle seçmek, bu da paketin
  kapsamını istemeden daraltıyor. Gerçek "QA Credit Pack" üzerinde canlı
  doğrulandı.
- 🟢 Düşük — `PATCH /api/school/teachers/{id}/` e-posta benzersizlik
  kontrolü yapmıyor (kod incelemesi, canlı denenmedi — düşük güven).

**Netleştirme (bug değil):** `AttendanceStatus.burns_credit`, yoklama
işaretlenirken krediye **dokunmuyor** — bu görevin varsayımının aksine,
kasıtlı tasarım (`bookings/services.py::mark_attendance` docstring'i açık:
"kredi sadece iptal ile hareket eder, yoklama asla dokunmaz"). Özel bir
"Makeup Class" (`burns_credit:false`) durumu oluşturulup test edildi,
davranış tutarlı ve doğru bulundu — bu netleştirme CLAUDE.md'ye eklenmeye
değer olabilir ki gelecekte tekrar "bug" sanılmasın.

## 3. Teacher Paneli

**Durum: temel tur tamamlandı**

Sayfalar: Dashboard, Calendar, Attendance, Performance, Compensation,
Library, Inbox, Profile. Teacher'ın kendi izin matrisi yok (tek rol,
`Role.TEACHER`, granüler alt-rol kavramı yok) — okul/HQ'dan farklı olarak
basit bir rol.

| Test | Sonuç |
|---|---|
| Dashboard — haftalık ders programı, compensation plan özeti | ✅ doğru veriler (QA Course dersleri, "No plan assigned") |
| Attendance sayfası — yaklaşan dersler + "Mark" aksiyonu | ✅ liste doğru (i18n hariç, bkz. Bulgu #4) |
| Compensation sayfası — aylık özet, ders bazlı tablo | ✅ doğru (plan yokken €0.00) |
| Library (Metodo) — video/PDF filtreleri | ✅ çalışıyor, i18n sorunu yok |
| Profile — ad/email/telefon/bio güncelleme formu | ✅ render doğru, bu formda i18n etiket sorunu YOK (diğer formların aksine) |
| Performance sayfası | ✅ render doğru ama bkz. Bulgu #5 (yazım hatası) |
| **Rol izolasyonu**: teacher token ile `/api/hq/schools/`, `/api/school/team/`, `/api/school/profile/`, `/api/school/credits/grant/` | ✅ hepsi doğru şekilde `403` |

#### Bulgu #5 — "LESSONS TEAUGHT" yazım hatası 🟢 Düşük
`/teacher/performance` sayfasındaki KPI etiketi "LESSONS TAUGHT" olması
gerekirken "LESSONS TEAUGHT" yazıyor — i18n anahtar eksikliği değil, gerçek
bir yazım hatası (muhtemelen `frontend/messages/en.json` içinde).

**i18n bulgusu güncellemesi:** Bulgu #4'teki çevrilmemiş etiket sorunu Teacher
panelinde de var — `/teacher/attendance` sayfası başlığı düz `Title` olarak,
`/teacher/compensation` tablo başlığında `Section Plans` ham anahtar olarak
görünüyor. Ama Profile ve Library sayfalarında sorun yok — bu, sorunun
uygulama genelinde değil, **belirli mesaj anahtarlarına özgü** olduğunu
doğruluyor (bazı sayfalar/bileşenler etkilenmiş, bazıları değil).

### 3.1 Derin Fonksiyonel Test Turu (Delta — ayrı QA ajanı, tam detay `QA_TEST_RESULTS_TEACHER_DELTA.md`)

**Tam uçtan uca doğrulanan alanlar:** Gerçek kayıtlı öğrenciyle attendance
işaretleme (Present/Absent, kredi yanması, roster senkronu), compensation
matematiği (taban ücret + bonus eşiği/limiti doğru hesaplanıyor), Inbox
iki yönlü gerçek mesajlaşma (okul→öğretmen, öğretmen→okul, her ikisi de
gerçek tıklamayla), Profile düzenleme+geri alma, rol izolasyonu (tekrar
doğrulandı, regresyon yok).

**Yeni bulgular:**
- 🟠 **Yüksek — Öğretmen, henüz gerçekleşmemiş (gelecek tarihli) bir
  derse yoklama işaretleyebiliyor ve bu anında compensation'a yansıyor.**
  `TeacherAttendanceView.post`'ta `lesson.date`/`status` kontrolü yok.
  Canlı doğrulama: 2 gün sonrasına tarihli bir derse öğrenci rezerve
  edildi, öğretmen UI'dan "Presente" işaretledi → Teacher'ın Compensation
  sayfası **aynı gün** o ders için €25 borç gösterdi — ders hiç
  gerçekleşmeden. Performance sayfasındaki "lessons taught" ise doğru
  şekilde 0 kaldı (o `date__lt=today` filtreliyor) — yani iki sayfa
  birbiriyle çelişiyor ve parasal olan taraf (Compensation) yanlış. Teorik
  olarak bir öğretmen gelecek dersleri önceden işaretleyerek borç
  şişirebilir.
- 🟠 **Yüksek — Performance sayfasında "NO SHOW RATE" KPI'ı yüzde değil,
  ham sayı gösteriyor.** `frontend/.../teacher/performance/page.tsx:39`
  doğrudan `stats.no_show` (tam sayı) basıyor; "ATTENDANCE RATE" aynı
  satırda doğru şekilde `%` hesaplıyor. Canlıda "NO SHOW RATE: 1" olarak
  görünüyor (yüzde işareti yok, payda yok) — yanıltıcı.
- 🟡 Orta — Compensation dökümü tablosunda **gerçek bir kopya-yapıştır
  hatası**: iki sütun da `t('month')` kullanıyor, ikincisi aslında ders
  adını (`l.course`) gösteriyor ama başlığı "Month" yazıyor (i18n değil,
  kod hatası). Aynı satırdaki "Students" başlığı da hardcoded İngilizce
  (hiç `t()` içinden geçmiyor, diğer dillere hiç çevrilmeyecek).
- 🟡 Orta — Teacher Library'deki video/PDF içerikleri `example.test`
  (hiç çözümlenmeyen, RFC 2606 rezerve alan adı) URL'lerine işaret ediyor
  — video oynatıcı `MEDIA_ELEMENT_ERROR` veriyor, PDF linki DNS hatası
  veriyor. Muhtemelen QA seed verisi sorunu (kod değil), ama kullanıcıya
  hiç görünür hata mesajı gösterilmiyor (sessizce dönen/bozuk oynatıcı).
- 🟡 Orta — Öğretmen Inbox'tan **yeni bir konuşma başlatamıyor** — ne
  arayüzde bir "yeni mesaj" butonu var, ne de backend izin veriyor
  (`ConversationViewSet.perform_create`'de öğretmen için `school_teacher`
  dalı yok — sadece okul başlatabiliyor). Ayrıca backend'de var olan
  `teacher_support` (Öğretmen↔HQ) kanalının **frontend'de hiç
  implementasyonu yok** — öğretmenin HQ ile hiçbir destek kanalı yok.
- 🟢 Düşük — Yeni ham i18n örnekleri: Inbox'ta "Date Today" (olması
  gereken "Today") ve mesaj kutusu placeholder'ı literal "**Placeholder**".
- 🟢 Düşük — `_apply_marks()` fallback mantığı (status_id gönderilip
  status gönderilmediğinde) mantıksal olarak ters — şu an ölü kod
  (frontend her zaman ikisini de gönderiyor) ama gelecekte bir API
  tüketicisi için tuzak.

## 4. Student Paneli

**Durum: temel tur + kredi/booking/iptal mantığı tamamlandı** (satın alma
akışı Stripe anahtarları maskeli olduğu için test edilemedi — bilinen risk,
CLAUDE.md §9)

Sayfalar: Dashboard (Home), Calendar, My Lessons/Bookings, Buy Packages, My
Packages, Messages/Support, Profile (Profile/Documents/Address sekmeleri).

| Test | Sonuç |
|---|---|
| Dashboard — kredi/ders özeti | ✅ doğru (i18n hariç, "X Desc" bulguları) |
| My Packages — aktif paket, kalan ders, son kullanma tarihi | ✅ doğru gösteriliyor |
| My Classes (bookings) — Upcoming/Past/Cancelled sekmeleri | ✅ boş durum doğru |
| Buy Packages — paket kartları, fiyat/kredi hesapları | ✅ doğru (gerçek okul verisiyle, satın alma denenmedi) |
| Support — okul sohbeti + FAQ | ✅ mevcut sohbet geçmişi doğru görüntülendi (i18n hariç, "Faq Title") |
| Profile — Profile/Documents/Address sekmeleri | ✅ render doğru (i18n hariç, "Tab Profile"/"Tab Documents") |
| **Rol izolasyonu**: student token ile `/api/hq/schools/`, `/api/school/team/`, `/api/school/profile/` | ✅ hepsi doğru şekilde `403` |
| **Booking + kredi + iptal + no-show tam akışı** (local ortamda, bkz. §2.3) | ✅ tamamen hatasız |

**i18n bulgusu — kapsam genişletmesi:** Bulgu #4 artık 3 panelde
(School/Teacher/Student) doğrulanmış durumda. Student panelinde ek örnekler:
Dashboard'daki hızlı erişim kartlarının açıklamaları (`Book A Class Desc`,
`My Lessons Desc`, `My Access Desc`, `Profile Desc`), Support sayfasında
`Faq Title`, Profile sayfasında sekme adları `Tab Profile`/`Tab Documents`
(yalnızca "Address" sekmesi doğru çevrilmiş). **Güncelleme:** HQ panelinde
de aynı desen doğrulandı (§1.5) — bu artık dört panelin ortak, sistemik bir
i18n regresyonu.

### 4.1 Derin Fonksiyonel Test Turu (Delta — ayrı QA ajanı, tam detay `QA_TEST_RESULTS_STUDENT_DELTA.md`)

**Tam uçtan uca gerçek UI tıklamasıyla doğrulanan akışlar (ilk kez, önceki
tur API ile yapmıştı):** Booking (kart → "Book" → onay modalı → anında
kredi güncellemesi), iptal eşik-altı (kredi yanar, modal net uyarı
gösteriyor: "will not be refunded... outside its cancellation policy"),
iptal eşik-üstü (kredi iade edilir, modal net onay gösteriyor: "goes back
into your package... within the school's cancellation policy"), yetersiz
kredi ile booking denemesi (çökmüyor, satın almaya yönlendiriyor, "Yes Book
Now" hiç render edilmiyor), geçerli/geçersiz indirim kodu, Stripe sınırına
kadar checkout (graceful 400), okula gerçek mesaj gönderme (okul tarafında
API ile doğrulandı), FAQ akordiyon, Documents sekmesi (zorunlu/zorunlu
değil her iki durum), Address sekmesi kaydet+kalıcılık.

**Yeni bulgular:**
- 🟠 **Yüksek — Booking takvim widget'ı, seçili arayüz dili ne olursa
  olsun her zaman Türkçe render ediliyor.** `/student/book` sayfasında
  (İngilizce locale'de, sayfanın geri kalanı doğru İngilizce iken) ay adı
  "**Eylül 2026**" ve gün kısaltmaları "**PZT SAL ÇAR PER CUM CMT PAZ**"
  olarak görünüyor. Muhtemelen takvim kütüphanesi `next-intl`'in aktif
  locale'i yerine sabit `tr` ya da sistem varsayılanı kullanıyor. Her
  locale'de (en/it/es/fr/de) etkili — İngilizce/İspanyolca/Fransızca/
  Almanca kullanıcılar için takvim ay/gün adları anlaşılmaz kalıyor.
- 🟡 Orta — Waitlist'in öğrenci tarafında **hiç arayüzü yok**: dolu bir
  ders sadece "Full" yazan, disabled bir "Book" butonu gösteriyor, hiçbir
  waitlist seçeneği/modalı açılmıyor; kod tabanında `waitlist` kelimesi
  öğrenci tarafında hiç geçmiyor. Bu, CLAUDE.md'de zaten "bilinçli
  boşluk" olarak kayıtlı bir durumun **canlı/UI kanıtıdır** — yeni bir bug
  değil.
- 🟢 Düşük — Stripe checkout hatası (`school_not_connected`) kullanıcıya
  jenerik "API error 400" toast'ı olarak gösteriliyor, anlamlı bir mesaj
  yok.
- 🟢 Düşük — 14+ yeni ham i18n örneği (Book Button, Spots Left, Cancel
  Button, Tab Upcoming/Past/Cancelled, Tab Profile/Documents, Tx No
  Show/Refunded/Purchased, Package Default, mesaj kutusu placeholder'ı
  "Placeholder", Date Today, Language Hint) — Bulgu #9'un kapsamını
  School/Teacher/Student'ta artık 20+ sayfaya çıkarıyor.
- 🟢 Düşük (belirsiz/kanıtlanamadı) — Bazı butonlarda (Buy Now, indirim
  "Apply", FAQ akordiyon başlığı) koordinat/ref tabanlı otomasyon
  tıklaması ilk denemede tepkisiz kaldı, ama native `element.click()`
  her zaman çalıştı. Bunun test aracının tıklama simülasyonuyla mı yoksa
  uygulamanın `pointerdown`/`mousedown` bağımlı event handler deseniyle mi
  ilgili olduğu netleştirilemedi — gerçek fare/dokunmatik ile manuel
  doğrulama önerilir, kesin bir ürün hatası olarak işaretlenmedi.

**Gerçek okul verisi gözlemi (bug değil, veri hijyeni notu):** `qa.student`
hesabının bağlı olduğu gerçek "Danza Clásica Barcelona" okulunun satış
sayfasında aynı paket 3 kez "(copy)", "(copy) (copy)", "(copy) (copy) (copy)"
son ekleriyle çoğaltılmış görünüyor (Duplicate özelliği kullanılıp
yeniden adlandırılmamış) — bu bir kod hatası değil, okulun kendi veri
düzenlemesiyle ilgili, bilgi amaçlı not edildi.



---

## 5. Django Admin (`/admin/`)

**Durum: tamamlandı** (yalnızca **local** ortamda test edildi — Django
admin ham/kısıtlanmamış DB erişimi verdiği için paylaşılan dev ortamında
test edilmedi; tam detay `QA_TEST_RESULTS_ADMIN_DELTA.md`). 12 `admin.py`
dosyası, ~40 model, tamamı list view/filtre/arama/sıralama/add/edit/delete
+ bulk-delete döngüsüyle test edildi (hiçbir `ModelAdmin` `inlines` veya
özel `actions` tanımlamıyor — grep ile doğrulandı, N/A değil gerçekten yok).

### Yeni Bulgular

- 🟠 **Yüksek (sadece local dev tooling, prod/dev'i ETKİLEMİYOR)** —
  Django admin'e `http://localhost:8080/admin/` üzerinden **giriş
  yapılamıyor**: nginx CSRF Origin kontrolünü kırıyor. Kök neden:
  `nginx/nginx.conf:34`'te `proxy_set_header Host $host;` kullanılıyor —
  nginx'in `$host` değişkeni **portu atıyor**, Django `Host: localhost`
  görüyor ama tarayıcı `Origin: http://localhost:8080` gönderiyor →
  eşleşmiyor → her POST `403 CSRF verification failed`. Ajan bunu hem
  tarayıcıda hem ham `curl` ile doğruladı, `$host` → `$http_host` değişikliği
  ile düzeltip test turunu tamamladı, **sonra dosyayı orijinal haline geri
  aldı** (`git diff` ile temiz olduğu doğrulandı — hiçbir kalıcı değişiklik
  yok). **Ben ayrıca doğruladım**: bu hata **yalnızca `docker-compose.yml`
  (local)'ın kullandığı `nginx/nginx.conf`'ta var. Dev ortamı
  (`docker-compose.run.yml`) ve prod (`docker-compose.prod.yml`) ikisi de
  `nginx/nginx-app.conf`'u kullanıyor ve o dosyada zaten doğru
  `$http_http` ayarı mevcut** — yani bu üretimi/dev'i etkilemiyor, sadece
  local geliştirme ortamında Django admin'i devre dışı bırakıyor. Öneri:
  `nginx/nginx.conf`'ta aynı düzeltmeyi kalıcı yapmak (local dev deneyimi
  için), ve kullanılmayan `nginx/nginx-prod.conf`'un (hiçbir compose
  dosyasından referans edilmiyor, aynı hatayı taşıyor) kafa karışıklığını
  önlemek için silinmesini değerlendirmek.
- 🟡 Orta — `HQRole.permissions`/`SchoolRole.permissions` (Postgres
  `ArrayField`) admin widget'ı düz metin alanı, hiç yardım metni yok ve
  hatalı girişi (`["dashboard"]` gibi JSON-benzeri metin) **sessizce**
  kabul ediyor — virgülle ayrılmış beklerken tüm string'i (köşeli
  parantezlerle birlikte) tek bir öğe olarak kaydediyor. Sonuç: bir rol,
  hiçbir hata göstermeden geçersiz/işe yaramayan bir izin listesiyle
  kalabilir (section-guard hem fail-open hem fail-closed olabilir, admin'de
  hiçbir uyarı yok).
- 🟢 Düşük — `chat.Conversation` ve `schools.SchoolClosure` modellerinde
  `__str__` tanımlı değil — admin'de FK sütunları ve silme/kaydetme
  mesajları anlamsız `ModelName object (uuid)` olarak görünüyor (örn. bir
  "school closure" silerken hangi okulun hangi tarihini sildiğini göstermek
  yerine ham UUID gösteriyor).

### Doğrulanan, sağlam çalışan alanlar
- **`HQMemberAdmin`'in `role_choice_form`'u gerçekten canlı** — yeni bir
  `HQRole` oluşturulunca anında dropdown'da çıkıyor; rol silinince mevcut
  üye `"key — non in matrice"` fallback'ini doğru gösteriyor (mevcut
  `test_admin_role_choices.py` testiyle birebir örtüşüyor).
- **Translations admin ile i18n bulgusunun kök nedeni bağımsız olarak
  kanıtlandı**: `hq.packages.labelDescription` (locale=en) satırı admin'de
  `"Label Description"`'dan `"Description"`'a değiştirilip kaydedildi →
  canlı `GET /api/translations/?locale=en` **anında** yeni değeri döndürdü,
  cache/restart gerekmedi. Bu, sorunun **tamamen bir veri sorunu** olduğunu
  (kod/cache değil) bağımsız bir kanıtla teyit ediyor — aynı desende
  ~100+ satır daha var (`school.subscriptions.labelDescription`,
  `hq.library.labelDescription`, `hq.shop.labelDescription`,
  `hq.shop.placeholderDescription` vb.). Test sonunda orijinal placeholder
  değerine geri alındı (diğer 100+ örnekle tutarsız kalmasın diye).
- Django'nun kendi `is_staff`/izin sistemi uçtan uca doğru çalışıyor:
  kısıtlı bir staff kullanıcı (sadece `Can view school` izniyle) admin
  index'te **yalnızca** Schools'u görüyor, `User` listesine `403`, `School`
  ekleme sayfasına `403` alıyor.
- `School`/`HQRole`/`HQMember` silme onay sayfaları kademeli (cascade)
  etkiyi doğru ve şaşırtıcı olmayan şekilde özetliyor.
- Tüm ~40 list view mevcut satır sayılarıyla (11.310 `Translation`, 135
  `EmailTemplate`, 34 `Lesson` dahil) sorunsuz sayfalanıyor.

---

## Bulgular Özeti (önem sırasına göre, tüm paneller, iki tur birleştirilmiş)

### 🔴 Kritik

| # | Bulgu | Konum |
|---|---|---|
| 1 | Herhangi bir HQ rolü (`support` dahil) kendini `PATCH /api/hq/team/{id}/` ile `owner` yapabiliyor | `backend/accounts/hq_views.py` `HQMemberViewSet` |
| 2 | Herhangi bir HQ rolü kendi rolünün (veya başka herhangi bir rolün) izin matrisini `PATCH /api/hq/permissions/{key}/` ile değiştirebiliyor | `backend/accounts/hq_views.py` `HQRoleViewSet` |
| 3 | Herhangi bir HQ rolü `DELETE /api/hq/team/{id}/` ile owner dahil **herhangi bir** HQ üyesini silebiliyor, kendini de silebiliyor (self-lockout) | aynı `HQMemberViewSet` |
| 4 | School `staff` rolü (hiçbir `settings` izni yokken) `PATCH /api/school/profile/` ile okulun **herhangi bir** alanını değiştirebiliyor (iptal politikası, platform komisyonu, aktiflik, Stripe alanları dahil — `fields="__all__"`) | `backend/schools/views.py` `SchoolProfileView`/`SchoolSerializer`; `backend/core/section_guard.py` (`profile` segmenti haritada yok) |

### 🟠 Yüksek

| # | Bulgu | Konum |
|---|---|---|
| 5 | `/api/hq/*` uçlarının tamamı yalnızca "rol=hq" kontrolü yapıyor; `HQRole.permissions` matrisine göre granüler backend kontrolü hiç yok (okuma **ve** yazma) — okul tarafındaki `SchoolSectionGuardMiddleware` eşleniği yok | `backend/accounts/permissions.py` (`IsHQ`), tüm `/hq/*` view'ları |
| 6 | School `admin` rolü, `POST /api/school/team/` ile yeni bir üyeyi doğrudan `school_sub_role:"owner"` olarak davet edebiliyor — `PATCH`'teki `only_owner_assigns_owner` koruması `POST`'ta yok | `backend/schools/views.py` `SchoolTeamView.post` |
| 7 | Kurs silme (`DELETE /api/school/courses/{id}/`) kursun ürettiği `Lesson` kayıtlarını silmiyor, `course=NULL` bırakıyor — "hayalet dersler" takvimde/öğretmen panelinde kalıcı olarak birikiyor | `Lesson.course` FK'sı muhtemelen `on_delete=SET_NULL` |
| 8 | **(Yeni)** Closure Days (okul kapanış günleri) kaydediliyor ama booking veya ders üretiminde **hiç uygulanmıyor** — kapalı günde rezervasyon sorunsuz başarılı oluyor, planlanmış dersler otomatik iptal edilmiyor | `backend/schools/models.py` `SchoolClosure`; `bookings/services.py`, `catalog/` ders üretimi kontrolsüz |
| 9 | **(Yeni)** School Package Edit/Duplicate, "tüm ders tiplerine açık" (`allowed_lesson_types: []`) eski paketlerde sonradan eklenen bir istemci-tarafı doğrulama yüzünden **kalıcı olarak bozuk** — Save hiç geçmiyor, tek çözüm paketin kapsamını istemeden daraltmak | `frontend/src/components/PackagesManager.tsx` `formFrom()`/`handleSave()` |
| 10 | **(Yeni)** Öğretmen, henüz gerçekleşmemiş (gelecek tarihli) bir derse yoklama işaretleyebiliyor ve bu anında Compensation'a (ödenecek ücrete) yansıyor — ders hiç olmadan borç oluşuyor | `backend/bookings/attendance_views.py` `TeacherAttendanceView.post`; `backend/teachers/services.py` compensation hesaplaması tarih/durum kontrolü yapmıyor |
| 11 | **(Yeni)** Teacher Performance sayfasında "NO SHOW RATE" KPI'ı yüzde değil ham sayı gösteriyor (örn. "1", "%" işareti yok) — yanıltıcı | `frontend/.../teacher/performance/page.tsx:39` |
| 12 | **(Yeni)** Booking takvim widget'ı (`/student/book`), seçili arayüz dili ne olursa olsun ay/gün adlarını **her zaman Türkçe** render ediyor ("Eylül 2026", "PZT SAL...") — en/it/es/fr/de'nin hepsinde etkili | Muhtemelen `student/book` altındaki takvim/`date-fns` bileşeni, sabit `tr` locale |
| 13 | **(Yeni, sadece local dev — prod/dev'i etkilemiyor)** `nginx/nginx.conf`'taki `$host` kullanımı (port bilgisini atıyor) Django admin'e `localhost:8080` üzerinden girişi CSRF hatasıyla tamamen kırıyor; dev/prod'un kullandığı `nginx-app.conf` zaten doğru (`$http_host`) | `nginx/nginx.conf:34` — düzeltme: `$host` → `$http_host` |

### 🟡 Orta

| # | Bulgu | Konum |
|---|---|---|
| 13 | HQ sayfalarında route guard yok; sidebar'da gizlenen sayfalara (`/hq/permissions`, `/hq/team` vb.) URL ile doğrudan gidilince tam render oluyor | `frontend/src/lib/api/guards.tsx`, `HQLayout` |
| 14 | Course "Credits per single lesson" alanı yarım kredi değerini (1.5) formdan kaydederken sessizce tam sayıya yuvarlıyor (backend doğru destekliyor, Package'da sorun yok) | Course new/edit frontend formu |
| 15 | **Sistemik i18n bulgusu — dört panelin de ortak sorunu, kapsam iki turda net biçimde büyüdü.** Varsayılan `en` locale'de yüzlerce anahtarın değeri gerçek metin yerine kendi camelCase anahtar adının insan-okunur hali (`Label X`, `Col X`, `Action X`, `Column X`, `Status X`, `Kpi X`, `Tab X`, `Filter X`, `Badge X`, `Title`, `Add Btn`, `X Desc`, `Faq Title`, `Placeholder`, `Date Today` vb.) — İtalyanca/İspanyolca genelde doğru dolu. `/hq/translations` arama kutusuyla ölçülen desen sayıları: `Label ` → 123, `Col `/`Column ` → 68, `Kpi ` → 25, `Status ` → 20, `Action ` → 7. Kök neden `/hq/debug` sayfasında doğrudan kanıtlandı (bkz. Bulgu 22). En az 25 sayfa/bileşen etkilendi (HQ: Dashboard/Lesson Types/Packages/Shop/Payments/Reports/Homepage/Library/Inbox; School: Courses/Packages/Teachers/Settings; Teacher: Attendance/Compensation/Inbox; Student: Dashboard/Book/Bookings/Packages/Support/Profile). **Kod hatası değil, içerik yazım/QA görevi.** | `frontend/messages/en.json` / Translations DB'deki EN değerleri |
| 16 | **(Yeni)** HQ "Export CSV" butonu metni "**Export C S V**" olarak bozuk render oluyor (Payments + Reports) — fonksiyonel olarak buton çalışıyor | HQ Payments/Reports export butonu i18n formatlaması |
| 17 | **(Yeni)** Teacher Compensation dökümü tablosunda gerçek kopya-yapıştır hatası: iki sütun da "Month" başlıklı, ikincisi aslında ders adını gösteriyor; "Students" başlığı da hardcoded İngilizce (hiç çevrilmiyor) | `frontend/.../teacher/compensation/page.tsx:224-227` |
| 18 | **(Yeni)** Teacher Library'deki video/PDF içerikleri çözümlenmeyen `example.test` URL'lerine işaret ediyor — oynatma/açma sessizce başarısız oluyor, kullanıcıya görünür hata yok (muhtemelen QA seed verisi sorunu, uygulama kodu değil) | QA seed / dev fixture library verisi |
| 19 | **(Yeni)** Öğretmen Inbox'tan yeni konuşma başlatamıyor (ne UI'da buton var ne backend izin veriyor); backend'de var olan `teacher_support` (Öğretmen↔HQ) kanalının frontend'de hiç implementasyonu yok | `backend/chat/views.py` `ConversationViewSet.perform_create`; `frontend/.../teacher/inbox/` |
| 20b | **(Yeni)** Django admin'de `HQRole`/`SchoolRole.permissions` (ArrayField) alanı yardım metni olmadan düz metin kutusu; JSON-benzeri hatalı giriş (`["dashboard"]`) sessizce tek bir garbage öğe olarak kaydediliyor, hata yok | Django admin `permissions` widget'ı |
| 20 | **(Yeni)** Waitlist (`Course.waitlist_enabled`) öğrenci tarafında **hiç UI'ı yok** — dolu ders sadece disabled "Full" butonu gösteriyor. CLAUDE.md'de zaten bilinçli boşluk olarak kayıtlı; bu tur canlı/UI kanıtı sağladı, yeni bir bug değil | Öğrenci booking sayfası, kod tabanında `waitlist` hiç geçmiyor |

### 🟢 Düşük

| # | Bulgu | Konum |
|---|---|---|
| 21 | HQ Dashboard'daki "New School" butonu ve "Recent Schools" widget'ı izne bağlı değil | `frontend/src/app/[locale]/hq/dashboard/page.tsx` |
| 22 | **(Yeni)** `/hq/debug` — nav'da olmayan ama herhangi bir HQ rolünün doğrudan URL ile erişebildiği bir dev-debug sayfası; tüm `messages.hq` çeviri JSON'unu ham döküyor (hassas veri yok, ama prod'a gitmemeli) | `frontend/src/app/[locale]/hq/debug/` |
| 23 | **(Yeni)** HQ Lesson Types formunda "Level" dropdown'u yanlış çeviri anahtarına bağlı — "Entry" yerine "Filter Entry" gösteriyor (değer doğru, sadece metin) | HQ Lesson Types formu |
| 24 | **(Yeni)** `PATCH /api/school/teachers/{id}/` e-posta benzersizlik kontrolü yapmıyor — çakışma durumunda 400 yerine 500 (kod incelemesi, canlı doğrulanmadı) | `backend/teachers/views.py:414-419` |
| 25 | **(Yeni)** Stripe checkout hatası (`school_not_connected`) öğrenciye jenerik "API error 400" olarak gösteriliyor, anlamlı mesaj yok | Student Buy Packages checkout hata işleme |
| 26 | **(Yeni)** `_apply_marks()` fallback status-türetme mantığı ters (şu an ölü kod, frontend her zaman açık status gönderiyor) — gelecekte API tüketicisi için tuzak | `backend/bookings/attendance_views.py` |
| 26b | **(Yeni)** `chat.Conversation` ve `schools.SchoolClosure` modellerinde `__str__` yok — Django admin'de FK sütunları/mesajlar ham `ModelName object (uuid)` gösteriyor | Django admin, ilgili modeller |
| 27 | **(Yeni, belirsiz)** Bazı butonlarda (Buy Now, indirim Apply, FAQ akordiyon) otomasyon tıklaması ilk denemede tepkisiz kalıp `element.click()` ile çalıştı — test aracı sorunu mu yoksa uygulamanın event-handler deseni mi olduğu netleşmedi, gerçek fare/dokunmatikle manuel doğrulama önerilir | Çeşitli Student sayfaları |

### Netleştirmeler (bug değil, ama kayda değer)
- **`AttendanceStatus.burns_credit`** yoklama işaretlenirken krediye hiç
  dokunmuyor — kasıtlı tasarım (kredi sadece booking/iptalde hareket eder).
  Doğru çalıştığı canlı doğrulandı; CLAUDE.md'ye açıkça yazılması önerilir.
- **`qa-lesson-type`**, önceki turda "temizlenmemiş artık" sanılmıştı — aslında
  `qa_platform.py` seed komutunun kasıtlı oluşturduğu, "QA Course"un
  kullandığı gerçek bir fixture. Silinmemeli.
- Reports'taki ülke filtresi (`IT`/`Italia`/`Italy` karışık) ve okul
  paketlerindeki `(copy)` isim kirliliği — kod hatası değil, okul/veri giriş
  hijyeni.

**Not:** 1-3 ve 5 numaralı bulgular HQ tarafında aynı kök nedenin farklı
yüzleri: okul tarafındakine benzer bir **sunucu taraflı izin/hiyerarşi
kontrolü** (section-guard middleware + team-hiyerarşi kontrolleri) hiç
yazılmamış. 4 ve 6 numaralı bulgular ise School tarafında var olan bu iyi
mimarideki **iki spesifik boşluk** (bilinçli "altyapı" istisnası + POST/PATCH
asimetrisi). Düzeltme isteniyorsa öneri: HQ tarafına
`SchoolSectionGuardMiddleware`'e benzer bir `HQSectionGuardMiddleware` +
`HQMemberViewSet`/`HQRoleViewSet`'e `SchoolTeamView`'dekine benzer
caller-role kontrolleri eklemek; School tarafında `profile` segmentini
haritaya eklemek (veya serializer'a alan kısıtlaması koymak) ve
`SchoolTeamView.post`'a `only_owner_assigns_owner` kontrolünü taşımak.

**Olumlu bulgular (iki turda doğrulanan, sağlam çalışan alanlar):**
- Kredi/iptal/no-show iş mantığı (CLAUDE.md §4.4 — iptal politikası eşiği,
  no-show her zaman yakar) hem API hem gerçek UI tıklamasıyla **hatasız**
  doğrulandı; platformun en kritik finansal mantığı sağlam.
- Documents-zorunluluğu × booking engeli uçtan uca doğru çalışıyor.
- Compensation hesaplaması (School ve Teacher tarafı) matematik olarak
  birebir uyuşuyor.
- School tarafındaki team-hiyerarşi (owner/admin/staff, kendini silme
  koruması, çapraz-okul izolasyonu) ve section-guard middleware sağlam.
- Teacher/Student rol izolasyonu (HQ/School uçlarına erişim) her iki turda
  da hatasız `403`.

---

## Riepilogo dei Risultati (Italiano)

> Traduzione della tabella riassuntiva sopra, per gli stakeholder
> italofoni. Percorsi di file, nomi di codice e termini tecnici restano
> invariati (inglese), come da convenzione del progetto.

### 🔴 Critico

| # | Problema | Posizione |
|---|---|---|
| 1 | Qualsiasi ruolo HQ (anche `support`) può auto-promuoversi a `owner` con `PATCH /api/hq/team/{id}/` | `backend/accounts/hq_views.py` `HQMemberViewSet` |
| 2 | Qualsiasi ruolo HQ può modificare la matrice dei permessi del proprio ruolo (o di qualsiasi altro) con `PATCH /api/hq/permissions/{key}/` | `backend/accounts/hq_views.py` `HQRoleViewSet` |
| 3 | Qualsiasi ruolo HQ può eliminare **qualunque** membro HQ, incluso l'owner, con `DELETE /api/hq/team/{id}/` — può anche eliminare se stesso (self-lockout) | stesso `HQMemberViewSet` |
| 4 | Il ruolo `staff` di una scuola (senza alcun permesso `settings`) può modificare **qualsiasi** campo della scuola con `PATCH /api/school/profile/` (soglia di cancellazione, commissione piattaforma, attivo/inattivo, campi Stripe inclusi — `fields="__all__"`) | `backend/schools/views.py` `SchoolProfileView`/`SchoolSerializer`; `backend/core/section_guard.py` (il segmento `profile` non è nella mappa) |

### 🟠 Alto

| # | Problema | Posizione |
|---|---|---|
| 5 | Tutti gli endpoint `/api/hq/*` controllano solo "ruolo=hq"; non esiste alcun controllo granulare lato backend basato sulla matrice `HQRole.permissions` (né in lettura né in scrittura) — manca l'equivalente del `SchoolSectionGuardMiddleware` lato scuola | `backend/accounts/permissions.py` (`IsHQ`), tutte le view `/hq/*` |
| 6 | Il ruolo `admin` di una scuola può invitare un nuovo membro direttamente come `school_sub_role:"owner"` tramite `POST /api/school/team/` — la protezione `only_owner_assigns_owner` presente nel `PATCH` manca nel `POST` | `backend/schools/views.py` `SchoolTeamView.post` |
| 7 | L'eliminazione di un corso (`DELETE /api/school/courses/{id}/`) non elimina le `Lesson` generate, lascia `course=NULL` — "lezioni fantasma" che restano permanentemente nel calendario/pannello insegnante | FK `Lesson.course` probabilmente `on_delete=SET_NULL` |
| 8 | **(Nuovo)** I giorni di chiusura scuola (Closure Days) vengono salvati ma **non sono mai applicati** nella prenotazione o generazione lezioni — si può prenotare normalmente in un giorno di chiusura, le lezioni già pianificate non vengono cancellate automaticamente | `backend/schools/models.py` `SchoolClosure`; nessun controllo in `bookings/services.py` o nella generazione lezioni in `catalog/` |
| 9 | **(Nuovo)** Modifica/Duplica pacchetto scuola **permanentemente rotta** per i pacchetti legacy "validi per tutti i tipi di lezione" (`allowed_lesson_types: []`) — una validazione lato client aggiunta successivamente blocca il salvataggio; l'unica via d'uscita restringe involontariamente l'ambito del pacchetto | `frontend/src/components/PackagesManager.tsx` `formFrom()`/`handleSave()` |
| 10 | **(Nuovo)** Un insegnante può segnare la presenza per una lezione **futura** (non ancora avvenuta) e questo si riflette immediatamente nel compenso dovuto — si genera un debito prima che la lezione avvenga | `backend/bookings/attendance_views.py` `TeacherAttendanceView.post`; il calcolo compensi in `backend/teachers/services.py` non verifica data/stato |
| 11 | **(Nuovo)** Il KPI "NO SHOW RATE" nella pagina Performance dell'insegnante mostra un numero grezzo invece di una percentuale (es. "1", senza "%") — fuorviante | `frontend/.../teacher/performance/page.tsx:39` |
| 12 | **(Nuovo)** Il widget calendario di prenotazione (`/student/book`) mostra sempre mese/giorni **in turco**, indipendentemente dalla lingua dell'interfaccia selezionata ("Eylül 2026", "PZT SAL...") — riguarda tutte le lingue (en/it/es/fr/de) | Probabilmente il componente calendario/`date-fns` sotto `student/book`, locale `tr` fissa |
| 13 | **(Nuovo, solo ambiente locale di sviluppo — non tocca dev/prod)** In `nginx/nginx.conf` l'uso di `$host` (che perde la porta) rompe completamente il login a Django admin su `localhost:8080` con un errore CSRF; `nginx-app.conf`, usato da dev e prod, è già corretto (`$http_host`) | `nginx/nginx.conf:34` — correzione: `$host` → `$http_host` |

### 🟡 Medio

| # | Problema | Posizione |
|---|---|---|
| 14 | Nelle pagine HQ manca un controllo di accesso a livello di rotta; le pagine nascoste dalla sidebar (`/hq/permissions`, `/hq/team` ecc.) si aprono comunque per intero digitando l'URL direttamente | `frontend/src/lib/api/guards.tsx`, `HQLayout` |
| 15 | Il campo "Crediti per singola lezione" del Corso arrotonda silenziosamente un valore a mezzo credito (1.5) a un numero intero quando salvato dal form (il backend supporta correttamente i decimali, il Pacchetto non ha questo problema) | Form nuovo/modifica Corso, frontend |
| 16 | **Problema i18n sistemico — comune a tutti e quattro i pannelli, la portata è cresciuta chiaramente in due turni di test.** Nella lingua predefinita (`en`), centinaia di chiavi hanno come valore il nome grezzo della chiave stessa in forma leggibile invece di un testo reale (`Label X`, `Col X`, `Action X`, `Column X`, `Status X`, `Kpi X`, `Tab X`, `Filter X`, `Badge X`, `Title`, `Add Btn`, `X Desc`, `Faq Title`, `Placeholder`, `Date Today` ecc.) — italiano/spagnolo sono generalmente corretti. Conteggi misurati tramite la casella di ricerca di `/hq/translations`: `Label ` → 123, `Col `/`Column ` → 68, `Kpi ` → 25, `Status ` → 20, `Action ` → 7. La causa radice è stata dimostrata direttamente nella pagina `/hq/debug` (vedi problema 25). Interessate almeno 25 pagine/componenti. **Non è un bug di codice, ma un compito di redazione contenuti.** | `frontend/messages/en.json` / valori EN nel database Translations |
| 17 | **(Nuovo)** Il testo del pulsante "Export CSV" in HQ appare rotto come "**Export C S V**" (Payments e Reports) — il pulsante funziona correttamente | Formattazione i18n del pulsante export in HQ Payments/Reports |
| 18 | **(Nuovo)** La tabella di dettaglio Compensation dell'insegnante ha un vero bug di copia-incolla: due colonne intestate entrambe "Month", la seconda mostra in realtà il nome del corso; l'intestazione "Students" è testo inglese hardcoded (non si traduce mai) | `frontend/.../teacher/compensation/page.tsx:224-227` |
| 19 | **(Nuovo)** I contenuti video/PDF della Library insegnante puntano a URL `example.test` che non si risolvono — la riproduzione/apertura fallisce silenziosamente, nessun errore visibile all'utente (probabilmente un problema dei dati seed di QA, non del codice applicativo) | Dati fixture QA/dev della library |
| 20 | **(Nuovo)** L'insegnante non può avviare una nuova conversazione da Inbox (né un pulsante in UI, né il backend lo permette); il canale `teacher_support` (Insegnante↔HQ), pur esistendo nel backend, non ha alcuna implementazione frontend | `backend/chat/views.py` `ConversationViewSet.perform_create`; `frontend/.../teacher/inbox/` |
| 21 | **(Nuovo)** In Django admin, il campo `HQRole`/`SchoolRole.permissions` (ArrayField) è una casella di testo senza alcun testo di aiuto; un input errato in stile JSON (`["dashboard"]`) viene accettato silenziosamente come un unico elemento "spazzatura", senza errori | Widget `permissions` di Django admin |
| 22 | **(Nuovo)** La waitlist (`Course.waitlist_enabled`) non ha **alcuna interfaccia** lato studente — una lezione piena mostra solo un pulsante "Full" disabilitato. Già documentato in CLAUDE.md come lacuna consapevole; questo turno ne fornisce solo la conferma visiva/UI, non è un nuovo bug | Pagina di prenotazione studente, la parola `waitlist` non compare mai nel codice lato studente |

### 🟢 Basso

| # | Problema | Posizione |
|---|---|---|
| 23 | Il pulsante "New School" e il widget "Recent Schools" nella Dashboard HQ non sono vincolati ad alcun permesso | `frontend/src/app/[locale]/hq/dashboard/page.tsx` |
| 24 | **(Nuovo)** `/hq/debug` — pagina di debug per sviluppatori non presente nel menu ma raggiungibile da qualsiasi ruolo HQ via URL diretto; espone l'intero albero JSON delle traduzioni `messages.hq` (nessun dato sensibile, ma non dovrebbe mai arrivare in produzione) | `frontend/src/app/[locale]/hq/debug/` |
| 25 | **(Nuovo)** Nel form Lesson Types di HQ, il menu a tendina "Level" è collegato alla chiave di traduzione sbagliata — mostra "Filter Entry" invece di "Entry" (il valore salvato è corretto, solo il testo è sbagliato) | Form Lesson Types HQ |
| 26 | **(Nuovo)** `PATCH /api/school/teachers/{id}/` non verifica l'unicità dell'email — in caso di conflitto darebbe un errore 500 invece di un 400 pulito (solo lettura del codice, non riprodotto dal vivo) | `backend/teachers/views.py:414-419` |
| 27 | **(Nuovo)** L'errore di checkout Stripe (`school_not_connected`) viene mostrato allo studente come un generico "API error 400", senza un messaggio comprensibile | Gestione errori checkout Buy Packages, lato studente |
| 28 | **(Nuovo)** La logica di fallback di `_apply_marks()` per derivare lo stato è invertita (attualmente codice morto, il frontend invia sempre uno stato esplicito) — una trappola latente per un futuro consumatore dell'API | `backend/bookings/attendance_views.py` |
| 29 | **(Nuovo)** I modelli `chat.Conversation` e `schools.SchoolClosure` non hanno `__str__` — in Django admin le colonne FK e i messaggi mostrano un grezzo `ModelName object (uuid)` | Django admin, modelli indicati |
| 30 | **(Nuovo, non confermato)** Alcuni pulsanti (Buy Now, "Apply" del codice sconto, accordion FAQ) non hanno reagito al primo tentativo di click automatizzato, ma hanno funzionato con `element.click()` diretto — non è chiaro se sia un limite dello strumento di test o un pattern di gestione eventi dell'app; si raccomanda una verifica manuale con mouse/touch reale | Varie pagine dello Studente |

### Chiarimenti (non sono bug, ma degni di nota)
- **`AttendanceStatus.burns_credit`** non tocca mai il credito al momento
  della marcatura presenza — è una scelta di design intenzionale (il
  credito si muove solo con prenotazione/cancellazione). Comportamento
  verificato corretto dal vivo; si raccomanda di renderlo esplicito in
  CLAUDE.md.
- **`qa-lesson-type`**: nel turno precedente si pensava fosse un residuo
  di test non ripulito — in realtà è una fixture reale creata
  intenzionalmente dal comando seed `qa_platform.py` e usata da "QA
  Course". Non va eliminata.
- Il filtro paese nei Reports (`IT`/`Italia`/`Italy` mescolati) e i nomi
  duplicati "(copy)" nei pacchetti di alcune scuole reali — non sono bug
  di codice, ma questioni di igiene dei dati/inserimento da parte delle
  scuole.

**Nota:** i problemi 1-3 e 5 sono facce diverse della stessa causa
radice lato HQ: manca completamente un **controllo di autorizzazione/
gerarchia lato server** paragonabile a quello lato scuola (middleware di
section-guard + controlli di gerarchia sul team). I problemi 4 e 6 sono
invece due lacune specifiche nell'architettura, altrimenti valida, lato
scuola (un'eccezione "infrastrutturale" intenzionale + un'asimmetria
POST/PATCH). Se si desidera una correzione: lato HQ, aggiungere un
`HQSectionGuardMiddleware` simile a `SchoolSectionGuardMiddleware` e
controlli di ruolo-chiamante in `HQMemberViewSet`/`HQRoleViewSet` simili
a quelli di `SchoolTeamView`; lato scuola, aggiungere il segmento
`profile` alla mappa (o una lista di campi consentiti nel serializer) e
spostare il controllo `only_owner_assigns_owner` anche su
`SchoolTeamView.post`.

**Riscontri positivi (confermati in entrambi i turni, aree solide):**
- La logica di credito/cancellazione/no-show (CLAUDE.md §4.4 — soglia
  della politica di cancellazione, il no-show brucia sempre il credito) è
  stata verificata **senza errori** sia via API sia con click reali
  sull'interfaccia; la logica finanziaria più critica della piattaforma è
  solida.
- Il blocco della prenotazione per documenti mancanti funziona
  correttamente end-to-end.
- Il calcolo dei compensi (lato Scuola e lato Insegnante) coincide
  esattamente.
- La gerarchia del team lato scuola (owner/admin/staff, protezione
  dall'auto-rimozione, isolamento tra scuole diverse) e il middleware di
  section-guard sono solidi.
- L'isolamento dei ruoli Insegnante/Studente (accesso agli endpoint
  HQ/Scuola) ha dato `403` corretto in entrambi i turni di test.

---

## Ek — Orta #16 (i18n) tamamlandı (2026-09-06)

Worktree `agent-a2568c3a15c87a35f`'ten devralınıp tamamlandı: PR
[#49](https://github.com/ExecutionAI-net/nounder40/pull/49) → `develop`,
PR [#50](https://github.com/ExecutionAI-net/nounder40/pull/50) → `main`
(sync, develop'ta o sırada birikmiş başka commit'leri de taşıdı). Detay
§0'daki "Fixlenip merge edilenler" bölümünde.

**Yeni bir sonraki fix turu adayı (henüz atanmadı):** doğrulama sırasında,
bu diff'in hiç dokunmadığı ayrı bir grup ham/placeholder etiket daha
bulundu — `en.json`'da hâlâ duruyor, `it/es/fr/de.json`'da da aynı şekilde
kelime kelime çevrilmiş halleriyle duruyor. Örnekler: `hq.permissions.role*Desc`
(`"Role Owner Desc"` vb.), `hq.shop.formTitle` (`"Form Title"`),
`school.courses.*.freqSingle/freqWeekly/freqBiweekly/freqIntensive`
(`"Freq Single"` vb.), `auth.setup.confirmPasswordLabel`
(`"Confirm Password Label"`), `school.reports.sc*` (`"Sc Active Packages"`
vb.), `school.team.inviteTitle`, `student.buy.interval*`
(`"Interval Month"` vb.), `teacher.performance.lessonsTeaught` (İngilizce
yazım hatası da var: "Teaught" → "Taught" olmalı). Kabaca 40-50 anahtar,
5 dosyanın hepsinde. Bir sonraki fix turunda ayrı bir madde olarak ele
alınabilir — bu PR'ın kapsamına bilinçli olarak dahil edilmedi (review'u
büyütmemek için).
