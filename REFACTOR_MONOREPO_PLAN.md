# No Under 40 — Monorepo + Django Refactor Planı

**Durum:** ✅ Faz 0 tamamlandı (`make up` çalışıyor) — sırada Faz 1 (modeller)
**Branch:** `feature/monorepo-django`
**Referans mimari:** `/Users/ms/Documents/Projects/dreemli/dreemli_project`

---

## 0. Kilitlenen Kararlar

| Konu | Karar |
|---|---|
| Frontend | UI/UX **birebir korunur**; sadece **veri katmanı** Supabase client → Django API'ye taşınır |
| Backend | **Django 5 + DRF** |
| Database | **PostgreSQL container** (Supabase tamamen kaldırılır) |
| Reverse proxy | **nginx container** |
| Auth | **SimpleJWT Bearer (localStorage)** + allauth Google OAuth (dreemli tarzı) |
| Realtime | **Django Channels (WebSocket)** + Redis channel layer |
| Şema/Veri | **İdiomatik Django şeması** + son fazda ayrı **ETL taşıma script'i** |
| Yapı | **Monorepo**, `docker-compose` ile orkestre |

### JWT seçiminin önemli sonucu
Şu an **server component** içinde `supabase.auth.getUser()` ile sunucu tarafında auth kontrolü yapan sayfalar (layout'lar, dashboard'lar) **client-side guard'a** çevrilecek — çünkü localStorage'daki token sunucudan okunamaz. Görünüm aynı kalır; bu dosyalar client davranışına geçer. Rota koruması **Next middleware (cookie)** yerine **client guard + API'de JWT zorunluluğu**na taşınır. Middleware yalnızca i18n için kalır.

---

## 1. Hedef Mimari

```
                      ┌──────────── nginx (container) ────────────┐
   Browser  ─────────▶│  /            → frontend (Next.js :3000)   │
                      │  /api/*       → django (DRF :8000)         │
                      │  /ws/*        → django (Channels/ASGI)     │
                      │  /media/pub/* → statik (public assets)     │
                      │  /media/priv/* → X-Accel (korumalı)        │
                      └───────┬───────────────┬───────────────────┘
                              │               │
                   ┌──────────▼───┐    ┌──────▼──────┐
                   │ frontend     │    │ django      │──┐
                   │ (Next.js UI) │    │ DRF + ASGI  │  │ Celery worker + beat
                   └──────────────┘    └──────┬──────┘  │ (reminder cron)
                                              │         │
                                   ┌──────────▼──┐  ┌───▼────┐
                                   │ postgres    │  │ redis  │ (cache/channels/celery)
                                   └─────────────┘  └────────┘
```

- Frontend server component'leri Docker içinden Django'ya `API_URL=http://django:8000` ile, tarayıcı `NEXT_PUBLIC_API_URL` ile ulaşır.
- Tüm `/api/*` yolları nginx üzerinden Django'ya gider → **mevcut frontend fetch sözleşmesi korunur**, sayfaların çoğu değişmez.

---

## 2. Monorepo Klasör Yapısı

```
danza-classica/
├── frontend/                     # mevcut Next.js (git mv ile taşınır, geçmiş korunur)
│   ├── src/app/[locale]/...       # UI sayfaları (değişmez)
│   ├── src/components/            # (değişmez, chat/calendar realtime hariç)
│   ├── src/lib/api/               # YENİ: Django API client + auth-context (JWT)
│   ├── src/lib/ws/                # YENİ: WebSocket client (Channels)
│   ├── messages/  public/  next.config.ts
│   ├── Dockerfile                 # multi-stage (dev/prod)
│   └── package.json               # @supabase/* kaldırılır
│
├── backend/                       # YENİ Django projesi
│   ├── config/                    # settings/(base,dev,prod), urls, asgi, wsgi, celery
│   ├── accounts/                  # User, hq_members, hq_roles, invitations, auth, JWT, Google
│   ├── schools/                   # schools, locations, rooms, memberships, students(link), closures, doc_types
│   ├── catalog/                   # lesson_types, courses, lessons, packages, subscriptions_catalog, attendance_statuses
│   ├── students/                  # students, student_packages, student_subscriptions, documents, credit_grants
│   ├── teachers/                  # teachers, teacher_schools, compensation_plans(+rates), comp_payments
│   ├── bookings/                  # bookings, attendance
│   ├── commerce/                  # transactions, discount_codes, shop_products(+variants), shop_orders, shop_sales, stripe
│   ├── chat/                      # conversations, messages, quick_replies + Channels consumers
│   ├── library/                   # library_content, video_progress
│   ├── notifications/             # notifications, email_templates, email_settings, zepto
│   ├── geography/                 # hq_countries, hq_cities
│   ├── i18n/                      # translations (dinamik DB çevirileri) + platform_settings
│   ├── core/                      # ortak: base model, permissions, storage, pagination
│   ├── requirements.txt  Dockerfile  manage.py  startup.sh
│
├── nginx/
│   ├── nginx.conf
│   └── conf.d/default.conf        # dev; prod için ayrı
├── docker-compose.yml             # dev
├── docker-compose.prod.yml
├── Makefile                       # `make up` → tüm container'lar
├── .env.example
└── REFACTOR_MONOREPO_PLAN.md
```

### Makefile — `make up` ile tek komut

Kök dizinde bir `Makefile` bulunur; **`make up`** lokalde tüm servisleri (postgres, redis, django, celery, celery-beat, frontend, **nginx**) ayağa kaldırır. Başlıca hedefler:

| Komut | İş |
|---|---|
| `make up` | Tüm container'ları başlat (`docker compose up -d`) |
| `make down` | Tüm container'ları durdur |
| `make build` | İmajları build et |
| `make logs` | Tüm servislerin loglarını izle |
| `make ps` | Çalışan servisleri listele |
| `make migrate` | Django makemigrations + migrate |
| `make superuser` | Django superuser oluştur |
| `make seed` | Temel/seed veriyi yükle |
| `make lint` / `make test` | Backend (ruff/pytest) + frontend (eslint/tsc) |

`make up` sonrası tek gereken: uygulamaya nginx üzerinden tek porttan (ör. `http://localhost`) erişim.

---

## 3. Veri Modeli — 46 Tablo → 11 Django App

Mevcut `supabase/migrations/*` içindeki ~46 tablo idiomatik Django modellerine çevrilir. App haritası:

| App | Tablolar |
|---|---|
| **accounts** | `profiles`→**User**, `hq_members`, `hq_roles`, `pending_invitations` |
| **schools** | `schools`, `school_locations`, `school_rooms`, `school_memberships`, `school_students`, `school_closures`, `school_document_types` |
| **catalog** | `lesson_types`, `courses`, `lessons`, `packages`, `subscriptions_catalog`, `attendance_statuses` |
| **students** | `students`, `student_packages`, `student_subscriptions`, `student_documents`, `manual_credit_grants` |
| **teachers** | `teachers`, `teacher_schools`, `compensation_plans`, `compensation_plan_rates`, `teacher_compensation_payments` |
| **bookings** | `bookings`, `attendance` |
| **commerce** | `transactions`, `discount_codes`, `shop_products`, `shop_product_variants`, `shop_orders`, `shop_sales` |
| **chat** | `conversations`, `messages`, `quick_reply_templates` |
| **library** | `library_content`, `video_progress` |
| **notifications** | `notifications`, `email_templates`, `email_settings` |
| **geography / i18n** | `hq_countries`, `hq_cities`, `translations`, `platform_settings` |

Notlar:
- **User modeli**: UUID PK, email ile login, `role` alanı; Supabase `auth.users` + `profiles` birleştirilir. Multi-role/RoleSwitcher davranışı `school_memberships`/rol alanıyla korunur.
- Enum'lar Django `choices`, çok dilli alanlar mevcut `*_it/_en/_fr/_es` kolonları (veya JSON) olarak taşınır.
- Django **admin** her model için ücretsiz yönetim paneli verir (operasyon kolaylığı).

---

## 4. RLS → DRF İzin Katmanı (güvenlik-kritik)

Supabase'de güvenlik **DB seviyesinde RLS** ile. Django'da bu, **DRF permission sınıfları + queryset scoping** ile yeniden kurulur:

- Her endpoint'te `get_queryset()` tenant'a göre filtrelenir (ör. school kullanıcısı yalnızca kendi `school_id` kayıtlarını görür).
- Rol bazlı izinler (HQ alt rolleri, School Admin/Staff, Teacher, Student) permission sınıflarına çevrilir — mevcut `src/lib/hq-permissions.ts` mantığı referans.
- Chat izin matrisi (HQ↔School, School↔Student) permission + queryset ile zorlanır.
- **Kabul kriteri:** çapraz-tenant erişim (başka okulun verisi) testlerle engellenmiş olacak. Bu faz güvenlik açısından en hassas kısım; ayrı izolasyon testleri yazılır.

---

## 5. Realtime — Django Channels

- ASGI (daphne/uvicorn), Redis channel layer.
- **chat**: `ChatConsumer` (conversation kanalı) — anlık mesaj, typing, read receipt.
- **calendar**: ders değişikliklerinde ilgili okul/öğretmen kanalına broadcast.
- nginx `/ws/` → Django ASGI proxy (Upgrade header).
- Frontend: `src/lib/ws/` altında Supabase realtime yerine yerel WebSocket client; etkilenen 4 dosya (`school/calendar/CalendarClient.tsx`, `teacher/calendar/page.tsx`, `components/chat/ChatWindow.tsx`, `setup-account/page.tsx`) buna bağlanır.

---

## 6. Storage (varsayılan: yerel media + nginx)

3 bucket taşınır:
- `documents`, `chat-attachments` → **private**: Django media volume; erişim yetki kontrolü yapan Django view + **nginx X-Accel-Redirect** (yetkisiz erişime kapalı). Tıbbi sertifikalar gibi hassas dosyalar korunur.
- `school-assets` → **public**: nginx doğrudan servis eder.
- `django-storages` S3 için hazır bırakılır (ileride MinIO/S3'e geçiş kolay).
- (Opsiyonel) ClamAV container ile yükleme taraması — dreemli'deki gibi.

---

## 7. Entegrasyonlar

- **Stripe**: checkout / webhook / onboard / refund / portal Django'ya taşınır. Webhook yolu `/api/webhooks/stripe` korunur (nginx→Django). Connect fee-split mantığı aynen.
- **ZeptoMail**: Django email backend + DB'deki `email_templates` (çok dilli) ile. Mevcut `src/lib/zepto.ts` + `email-templates.ts` mantığı Django'ya taşınır.
- **Cron** (`expiry-reminder`, `lesson-reminder-1day`, `lesson-reminder-2hour`, `ping`) → **Celery Beat** periyodik görevleri.
- **i18n**: Frontend `next-intl` (statik `messages/`) **aynen kalır**. Dinamik DB çevirileri (`translations` tablosu, HQ çeviri editörü) Django endpoint'lerinden servis edilir; `next.config` CSP'de `*.supabase.co` kaldırılır.

---

## 8. Frontend'te Ne Değişir / Ne Değişmez

**Değişmez (çoğunluk):** `fetch('/api/...')` çağıran tüm sayfalar — nginx aynı yolu Django'ya götürür. Görsel/UX birebir korunur.

**Değişir (~34 dosya, doğrudan Supabase kullananlar):**
1. **Auth** (login, register, reset-password, setup-account, select-role, layouts, RoleSwitcher, LocaleSwitcher): JWT Bearer + `auth-context`. Server-side auth kontrolleri client guard'a çevrilir.
2. **Doğrudan `.from()` client sorguları** (145 çağrı, ~30 dosya: calendar, courses, book, buy, packages, shop, profile, support, inbox): karşılık Django endpoint'i + `fetch`. Çoğu endpoint zaten var; eksikler eklenir.
3. **Realtime** (4 dosya): WebSocket client.
4. **Storage** doğrudan erişimleri: API üzerinden.
5. `src/lib/supabase/*` silinir; `@supabase/ssr`, `@supabase/supabase-js` bağımlılıkları kaldırılır.

---

## 9. Uygulama Fazları

> Her faz **kendi içinde çalışır ve doğrulanabilir**. Faz sonundaki "Bitti when" checkpoint geçmeden sonraki faza geçilmez.

### Faz 0 — Monorepo iskeleti & DevOps
- `feature/monorepo-django` branch; mevcut Next.js → `frontend/` (`git mv`, geçmiş korunur).
- Boş Django projesi + 11 app iskeleti; `nginx/`, `docker-compose.yml`, `.env.example`, **`Makefile`**.
- Postgres + Redis + Django(boş) + celery + frontend + nginx container'ları **`make up`** ile ayağa kalkar.
- **Bitti when:** `make up` → tüm servisler healthy; nginx tek porttan frontend'i sunuyor; Django `/api/health/` ve `/admin/` çalışıyor.

### Faz 1 — Veri modeli (models + migrations + admin)
- 46 tablo → 11 app modellerine; custom User; ilişkiler/indexler/choices; admin kaydı; temel fixture'lar.
- **Bitti when:** `migrate` temiz; admin'de tüm modeller CRUD.

### Faz 2 — Auth (accounts) + JWT + Google
- register / login / refresh / logout / password-reset / complete-profile / my-role; allauth Google → token; DRF permission temeli.
- **Bitti when:** register→login→refresh→profile akışı çalışır; Google login token döner.

### Faz 3 — Çekirdek API'ler (DRF) + RLS→permission
- Her Supabase API route'una karşılık DRF endpoint (aynı yol). Modül modül: schools, catalog, students/documents, teachers/compensation, bookings/attendance/credits, commerce/shop, library, notifications, translations, chat REST.
- Tenant izolasyonu (RLS çevirisi) + izolasyon testleri.
- **Bitti when:** endpoint'ler mevcut fetch sözleşmesiyle uyumlu; çapraz-tenant testleri geçiyor.

### Faz 4 — Storage & dosyalar
- Private (documents/chat) korumalı serve (X-Accel), public (school-assets) nginx; upload endpoint'leri; (ops.) ClamAV.
- **Bitti when:** belge/resim yükle-indir çalışır; private dosyalar yetkisiz erişime kapalı.

### Faz 5 — Realtime (Channels)
- ASGI + Redis channel layer; chat consumer; calendar broadcast; nginx `/ws/`; frontend WS client.
- **Bitti when:** chat anlık; takvim değişiklikleri anlık yansıyor.

### Faz 6 — Stripe + ZeptoMail + Cron (Celery Beat)
- Stripe checkout/webhook/onboard/refund/portal; ZeptoMail backend + DB template'leri; reminder cron'ları Celery Beat'e.
- **Bitti when:** test ödeme → webhook → kredi/abonelik güncelleniyor; reminder job'ları çalışıyor.

### Faz 7 — Frontend veri katmanı geçişi
- `src/lib/api/*` (Django client + JWT auth-context); ~34 doğrudan-Supabase dosyası taşınır; server-component auth → client guard; middleware sadece i18n; Supabase paketleri kaldırılır.
- **Bitti when:** uygulama Supabase'siz uçtan uca çalışır; UI birebir aynı.

### Faz 8 — Veri taşıma (ETL) + prod
- Supabase Postgres → yeni Postgres ETL script (idiomatik şema eşleme + storage dosya transferi); `docker-compose.prod`, nginx-prod, gunicorn/daphne, env; regresyon QA (roller × akışlar).
- **Bitti when:** prod compose ayakta; veri taşındı; kritik akışlar yeşil.

---

## 10. Riskler & Varsayımlar

**Riskler**
- **RLS → permission çevirisi**: en yüksek güvenlik riski; eksik scoping veri sızıntısı yaratır → izolasyon testleri zorunlu.
- **Server→client auth geçişi**: JWT seçiminin doğrudan sonucu; SEO/SSR gerektiren korumalı sayfa yok varsayımıyla sorunsuz.
- **Realtime paritesi**: Channels + Redis operasyonel yük getirir.
- **Veri taşıma**: UUID/ilişki bütünlüğü ETL'de dikkat ister.

**Varsayılan kabuller (aksini belirtmezsen bunlarla ilerlerim)**
- Storage: **yerel media volume + nginx** (S3/MinIO ileride opsiyon).
- Cron: **Celery Beat** (harici scheduler değil).
- ZeptoMail ve Stripe hesapları/anahtarları **aynen** kullanılır (yalnızca `.env`).
- next-intl statik çeviriler frontend'te kalır.
- ETL/veri taşıma **son faz**; geliştirme boyunca boş/seed DB ile çalışılır.
- Tek `docker-compose` ile lokal geliştirme; prod için ayrı compose + nginx.
