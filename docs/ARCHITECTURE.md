# No Under 40 — Mimari Referansı

**Durum:** Ağustos 2026 · monorepo + Django REST (Supabase sonrası)
**Kapsam:** gerçekte çalışan mimarinin teknik referansı.

Çalışma kuralları için kök [`CLAUDE.md`](../CLAUDE.md), geçişin fazları ve
kalan işler için [`REFACTOR_MONOREPO_PLAN.md`](../REFACTOR_MONOREPO_PLAN.md).

> Eski Supabase dönemi spesifikasyonu
> [`docs/archive/CLAUDE_LEGACY_SUPABASE.md`](archive/CLAUDE_LEGACY_SUPABASE.md)
> içinde arşivlenmiştir; oradaki mimari bilgiler geçersizdir.

---

## 1. Sistem topolojisi

```
                       ┌──────────── nginx :80 ────────────┐
   Browser ───────────▶│  /             → frontend :3000   │
                       │  /api/*        → django  :8000    │
                       │  /ws/*         → django (ASGI)    │
                       │  /admin/       → django           │
                       │  /media/public/→ django (statik)  │
                       │  /internal-media/ → X-Accel only  │
                       └──────┬──────────────┬─────────────┘
                              │              │
                    ┌─────────▼───┐   ┌──────▼───────┐
                    │ frontend    │   │ django       │
                    │ Next.js 15  │   │ DRF + Channels│
                    └─────────────┘   └───┬───────┬──┘
                                          │       │
                              ┌───────────▼─┐ ┌───▼──────┐
                              │ postgres:16 │ │ redis:7  │
                              └─────────────┘ └───┬──────┘
                                                  │
                                    ┌─────────────┴──────────────┐
                                    │ celery worker · celery beat│
                                    └────────────────────────────┘
```

Compose dosyaları:

| Dosya | Amaç |
|---|---|
| `docker-compose.yml` | Lokal geliştirme (`make up`) — 7 servis, bind mount, hot reload |
| `docker-compose.prod.yml` | Prod stack (`make up-prod`) — TLS'li `nginx/nginx-prod.conf` |
| `docker-compose.run.yml` | EC2'de ECR imajlarını çalıştıran deploy compose'u |

---

## 2. Backend (Django 5.2 + DRF)

### 2.1 Ayarlar

`config/settings/{base,development,production}.py`, `python-decouple` ile
ortam değişkeninden okur. `daphne` INSTALLED_APPS'te **ilk sırada** durur —
`runserver`'ı dev'de ASGI/Channels farkındalığına geçiren şey budur.

Prod giriş noktası: `daphne config.asgi:application`. WSGI'ye dönmek Channels
WebSocket trafiğini taşıyamaz.

### 2.2 Uygulamalar

| App | Sorumluluk | Öne çıkan modeller |
|---|---|---|
| `core` | Ortak base model'ler, storage, viewset karışımları, WS/query-param auth | `UUIDModel`, `TimeStampedModel` |
| `accounts` | Kimlik, roller, davetler | `User`, `HQMember`, `HQRole`, `PendingInvitation` |
| `schools` | Okul, konum, oda, üyelik, kapanış, belge tipleri | `School`, `SchoolLocation`, `SchoolRoom`, `SchoolRole`, `SchoolMembership`, `SchoolStudent`, `SchoolClosure`, `SchoolDocumentType` |
| `catalog` | Metodo kataloğu, kurslar, dersler, paketler, yoklama durumları, iCal, calendar WS | `LessonType`, `Course`, `Lesson`, `Package`, `SubscriptionCatalog`, `AttendanceStatus` |
| `students` | Öğrenci profili, cüzdan, belgeler | `Student`, `StudentPackage`, `StudentSubscription`, `StudentDocument`, `ManualCreditGrant` |
| `teachers` | Öğretmen, tazminat planları ve ödemeleri | `Teacher`, `CompensationPlan`, `CompensationPlanRate`, `TeacherSchool`, `TeacherCompensationPayment` |
| `bookings` | Rezervasyon motoru ve yoklama | `Booking`, `Attendance` |
| `commerce` | Stripe, işlemler, indirim kodları, shop | `Transaction`, `DiscountCode`, `ShopProduct`, `ShopProductVariant`, `ShopOrder`, `ShopSale` |
| `chat` | Konuşmalar, mesajlar, hızlı yanıtlar, chat WS | `Conversation`, `Message`, `QuickReplyTemplate` |
| `library` | Metodo Library içerikleri ve izleme ilerlemesi | `LibraryContent`, `VideoProgress` |
| `notifications` | Bildirimler, e-posta şablonları, Celery task'ları, ZeptoMail | `Notification`, `EmailTemplate`, `EmailSetting` |
| `geography` | HQ ülke/şehir listesi | `HQCountry`, `HQCity` |
| `translations` | UI-copy sözlüğü ve platform ayarları | `Translation`, `PlatformSetting` |

### 2.3 API yüzeyi

Her şey `/api/` altında; nginx bu ön eki doğrudan Django'ya yönlendirir.

```
/api/auth/…                     register, login, refresh, logout, me, google, complete-invite
/api/hq/…                       config/api_hq.py
/api/school/…                   config/api_school.py   (aktif okula scope'lu)
/api/student/…                  config/api_student.py  (kendi profiline scope'lu)
/api/teacher/…                  config/api_teacher.py  (kendi profiline scope'lu)
/api/chat/…                     config/api_chat.py
/api/bookings/ , /multiple/ , /<id>/
/api/documents/upload/ , /<id>/ , /<id>/file/
/api/stripe/checkout|invoices|portal|verify-session|onboard|onboard/status|refund
/api/webhooks/stripe/
/api/locations/ , /schools/public/ , /translations/ , /platform-stats/
/api/calendar/<school_uuid>.ics          iCal (public, id erişim anahtarıdır)
/api/calendar/student/<token>.ics        iCal (öğrenciye özel token)
/api/health/ , /api/schema/ , /api/docs/ , /admin/
```

Router + APIView karışımı kullanılır. Basit CRUD `DefaultRouter` ile
ModelViewSet'e bağlanır; kurs/ders sihirbazı gibi karmaşık mantık ayrı
APIView path'lerindedir (`courses-overview/`, `courses-create/`,
`courses-reorder/`, `courses/<pk>/full/`, `classes/…`) — router'ın detay
regex'iyle çakışmasınlar diye.

### 2.4 Kimlik ve yetki

- **SimpleJWT Bearer.** Token'lar frontend'de `localStorage`'da tutulur.
- Google girişi `id_token` doğrulamasıyla (`google-auth`).
- Davet akışı: `PendingInvitation` → e-posta → `setup-account` →
  `complete-invite`.
- `User.role` birincil rol, `User.roles[]` çoklu rol seti; `active_school`
  okul rolündeki kullanıcının seçili okulu (`SchoolMembership` ile çoklu okul).
- **Çok kiracılılık RLS ile değil, DRF ile**: `SchoolScopedModelViewSet` her
  queryset'i aktif okula daraltır ve create sırasında `school`'u enjekte eder.
- İzin matrisleri veritabanındadır: `hq_roles` ve `school_roles` tabloları
  (`permissions` ArrayField). `school_roles` yalnızca HQ tarafından düzenlenir.
- Bölüm bazlı koruma: `core/section_guard.py`.

Bilinen davranışlar:

- `fields="__all__"` kullanan serializer'lar FK'yi ham adıyla döndürür
  (`school`, `lesson_type`), `_id` sonekiyle değil.
- Header taşıyamayan istekler (img/href, WebSocket) için
  `core/query_token_auth.py` ve `core/ws_auth.py` `?token=` desteği verir.

### 2.5 Realtime (Django Channels)

- Channel layer: Redis (`channels_redis`).
- Consumer'lar: `chat/consumers.py`, `catalog/consumers.py`;
  routing `*/routing.py`, birleşimi `config/asgi.py`.
- İstemci: `frontend/src/lib/ws.ts`, `/ws/…?token=<jwt>` ile bağlanır.
- Broadcast payload'ı JSON'a çevrilerek gönderilir; ham `UUID` msgpack
  serializer'ını kırar.

### 2.6 Storage

Supabase Storage yok. `core/storage.py` iki ağaç yönetir:

- `media/public/…` — nginx doğrudan servis eder (logo, ürün görselleri).
- `media/private/…` — **hiçbir URL route'u yoktur**. İzni doğrulayan Django
  view'ı `X-Accel-Redirect` ile nginx'in `internal` `/internal-media/`
  location'ına yönlendirir (belgeler, chat ekleri). Tahmin edilen yol 404 döner.

### 2.7 Arka plan işleri

Celery worker + `django_celery_beat` (DatabaseScheduler). Periyodik görevler
migration ile seed'lenir (`notifications/migrations/0003_seed_periodic_tasks.py`):

| Task | Ritim |
|---|---|
| `lesson_reminder_task` | saatlik |
| `document_expiry_reminder_task` | günlük |
| `sync_document_statuses_task` | günlük |
| `absent_student_winback_task` | günlük (30 / 90 gün) |
| `weekly_kpi_report_task` | haftalık |

E-posta gönderimi ZeptoMail üzerinden (`notifications/zepto_client.py`), her
zaman `send_transactional_email_task` ile **commit sonrası** kuyruğa girer.

---

## 3. Frontend (Next.js 15 + React 19)

### 3.1 Yapı

```
frontend/src/
  app/[locale]/
    (auth)/login · register · reset-password · select-role · setup-account
    hq/…       17 sayfa
    school/…   20+ sayfa
    teacher/…   9 sayfa
    student/…   8 sayfa
  components/   ui · layouts · chat · school · shop · students
  lib/          api/ (client, tokens, auth-context, guards) + yardımcılar
  i18n/         routing.ts · request.ts
  middleware.ts (yalnızca i18n)
```

### 3.2 Veri katmanı

- Tek giriş noktası `lib/api/client.ts`: base URL çözümü, Authorization
  header, 401'de refresh, hata normalizasyonu.
- Token yönetimi `lib/api/tokens.ts`, oturum bağlamı `lib/api/auth-context.tsx`.
- Rota koruması `lib/api/guards.tsx` (client-side). JWT `localStorage`'da
  olduğu için Server Component'ten okunamaz — bu yüzden panel sayfaları
  Client Component'tir.
- `frontend/src/app/api/` **yoktur**; nginx `/api/`'yi Django'ya verir.

### 3.3 i18n

`next-intl`, beş locale (`en` varsayılan, `it`, `es`, `fr`, `de`), sözlükler
`frontend/messages/<locale>.json` içinde build zamanında bundle edilir.
Middleware cookie (`user_locale`) → `Accept-Language` sırasıyla tercih tespiti
yapar. HQ > Translations ekranı DB'deki UI-copy kayıtlarını ve AI çeviri
yardımcısını yönetir; bundle edilmiş dosyalar her zaman güvenli taban çizgisidir.
`npm run sync-translations` script'i DB'ye doğrudan `pg` ile bağlanır.

### 3.4 PWA durumu

`public/manifest.json` ve `InstallPWAPrompt` bileşeni var. **`next-pwa`,
service worker ve web-push yoktur**; `CacheReset.tsx` aksine eski service
worker kayıtlarını temizler. Offline desteklenmez.

---

## 4. İş mantığı çekirdeği

### 4.1 Kredi motoru — tek yol

`PACKAGE_TO_SUBSCRIPTION.md` kararı gereği tek motor vardır: **paket + kredi**.
Recurring paket, vitrinde "Subscription" adıyla gösterilir ama aynı düşüm,
iade ve raporlama yolunu kullanır.

`Package` üzerindeki kısıt boyutları:

| Alan | Anlamı |
|---|---|
| `allowed_lesson_types` | İzinli ders tipleri (boş liste = hepsi) |
| `lesson_type_restriction` | Eski tek değerli kısıt — yalnızca fallback |
| `mode_filter` | `all` / `online` / `in_person` |
| `weekly_booking_cap` | Takvim haftası başına rezervasyon tavanı |
| `is_unlimited` | Yalnızca görünüm; gerçek sınır expiry + haftalık tavan |
| `validity_days` + `validity_unit` | Gün veya takvim-duyarlı ay |
| `is_recurring`, `recurring_interval`, `credits_rollover` | Stripe recurring davranışı |

Krediler `Decimal`, yarım adım destekler (`credits`, `credit_cost`,
`credits_deducted`).

### 4.2 Rezervasyon (`bookings/services.py`)

Doğrulama zinciri: ders durumu ve kapasite → minimum bildirim süresi →
paket uygunluğu (tip + mod + haftalık tavan + geçerlilik) → gerekli belgeler
(`School.block_booking_on_documents`) → düşüm.

İptal: derse kalan süre `School.cancellation_policy_hours` eşiğinin
üstündeyse iade, altındaysa yakma. `Booking.cancellation_type` ve
`credit_refunded` bu sonucu kaydeder.

### 4.3 Yoklama

Öğretmen `/api/teacher/attendance/<lesson_id>/`, okul
`/api/school/attendance/<lesson_id>/` üzerinden işaretler. Sonuç kümesi
sabit değildir: okul `AttendanceStatus` kayıtları tanımlar, `burns_credit`
bayrağı kredinin yanıp yanmayacağını belirler. `Attendance.status_ref` bu
kayda işaret eder, eski `status` alanı geriye dönük uyumluluk içindir.

### 4.4 Ödemeler

Stripe Connect (Express). Platform payı `application_fee_amount` ile ayrılır
(`School.platform_fee_percentage`). Webhook `commerce/webhooks.py` içinde
sekiz olayı işler; recurring paketler için `customer.subscription.*`
handler'ları da `StudentPackage` üzerinde çalışır.

Manuel yöntemler (`cash`, `bank_transfer`, `card`, `paypal` etiketi) yalnızca
kayıt amaçlıdır — PayPal / Satispay / Revolut entegrasyonu yoktur.

Shop tarafında satır bazlı `ShopSale`: stok düşümü row-lock altında, indirim
orantılı dağıtılır, okul ve referrer komisyonu ayrı hesaplanır.

### 4.5 Chat

`Conversation.type` dört değer alır: `hq_school`, `school_student`,
`school_teacher`, `teacher_support`. Görünürlük `chat/views.visible_conversations`
içinde hesaplanır. `is_internal` mesajlar yalnızca personel tarafından görülür
ve okunmamış sayacına öğrenci için girmez.

---

## 5. Deploy

- `develop`'a push → `.github/workflows/ci.yml`: ECR'ye backend/frontend imajı
  push edilir, EC2'de `docker-compose.run.yml` ile çalıştırılır, Slack'e
  bildirim gider.
- Prod nginx: `nginx/nginx-prod.conf` (TLS, HSTS, rate limit). Güvenlik
  header'ları nginx / Next.js / Django arasında tekilleştirilmiştir.
- `frontend/vercel.json` Vercel döneminden kalan ölü bir artefakttır.

---

## 6. Veri göçü (ETL)

`backend/core/management/commands/etl_from_supabase.py` — introspection tabanlı,
kolon-kesişimli kopyalama. Özel durumlar: `auth.users` + `profiles` →
`accounts_user` join ve bcrypt şifre göçü, `hq_members.id` → `user_id`,
`schools.user_id` → `owner_id`, `_id` soneki düşürme fallback'i, composite →
auto id, döngüsel FK için `SET CONSTRAINTS ALL DEFERRED`.

Runbook ve fixture'lar `docs/etl/`. Testler `backend/core/tests/test_etl_mapping.py`.

**Kalan:** gerçek prod DSN'iyle kesme ve storage bucket byte transferi.

---

## 7. Uygulanmamış alanlar

Arşiv spec'inde tarif edilip **bilinçli olarak uygulanmayan** özelliklerin
listesi kök [`CLAUDE.md`](../CLAUDE.md) §10'dadır. Bunlar eksik iş değil,
kapsam dışı bırakılmış maddelerdir.
