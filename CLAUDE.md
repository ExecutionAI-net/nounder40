# No Under 40 — Agent Kılavuzu

Bu dosya **çalışma kurallarıdır**, ürün spesifikasyonu değildir. Her yeni
oturumda bilinmesi gereken minimum bilgiyi içerir.

| İhtiyaç | Dosya |
|---|---|
| Gerçek mimari, API yüzeyi, veri modeli | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Geçiş planı ve güncel durum (**tek doğru yol haritası**) | [`REFACTOR_MONOREPO_PLAN.md`](REFACTOR_MONOREPO_PLAN.md) |
| Tek motor kararı (paket = abonelik) | [`PACKAGE_TO_SUBSCRIPTION.md`](PACKAGE_TO_SUBSCRIPTION.md) |
| Drop-in booking (henüz **teklif**) | [`DROP_IN_BOOKING.md`](DROP_IN_BOOKING.md) |
| Temizlik raporu / açık güvenlik maddeleri | [`CLEANUP_REPORT.md`](CLEANUP_REPORT.md) |
| ETL runbook (Supabase → Django veri göçü) | [`docs/etl/README.md`](docs/etl/README.md) |
| **ARŞİV** — eski Supabase dönemi spec'i | [`docs/archive/CLAUDE_LEGACY_SUPABASE.md`](docs/archive/CLAUDE_LEGACY_SUPABASE.md) |

> ⚠️ Arşiv dosyasındaki **mimari bilgiler geçersizdir** (Supabase Auth /
> Realtime / Storage / RLS, Edge Functions, Next.js API Routes, Vercel).
> Yalnızca ürün ve iş mantığı için tarihsel referanstır. Mimari soruları
> `docs/ARCHITECTURE.md`'den cevaplayın.

---

## 1. Proje bir bakışta

Klasik dans okulları ağı için çok kiracılı SaaS. Rol hiyerarşisi:
**HQ → School → Teacher → Student**. Öğrenciler kredi/paket satın alır, ders
rezerve eder; öğretmen yoklama alır; para Stripe Connect ile okul ile HQ
arasında bölüşülür.

**Güncel mimari: Django REST backend + Next.js frontend, monorepo, Docker Compose.**

```
nginx :80
  /            → frontend   (Next.js 15, React 19, Tailwind 4)
  /api/*       → django     (Django 5.2 + DRF, SimpleJWT)
  /ws/*        → django     (Channels / ASGI, daphne)
  /media/*     → public statik + private X-Accel-Redirect
arkada: postgres:16 · redis:7 · celery worker · celery beat
```

Supabase **kullanılmıyor**. `supabase/migrations/` yalnızca ETL'in kaynak
şeması olarak duruyor; kod tabanında `supabase` geçen isimler göç
artefaktlarıdır (ETL komutu, bcrypt onarım migration'ları, yorumlar).

---

## 2. Çalışma ortamı

Her şey container içinde çalışır. Host'ta `python` / `npm` çalıştırmayın.

```bash
make up
```

```bash
make migrate
```

```bash
make test
```

```bash
make lint
```

`make up` yedi container'ı ayağa kaldırır ve her açılışta
`makemigrations --noinput && migrate --noinput` çalıştırır. Diğerleri:
`make logs s=django`, `make backend-sh`, `make frontend-sh`, `make dbshell`.

Faydalı adresler: `http://localhost`, `http://localhost/admin/`,
`http://localhost/api/docs/`, `http://localhost/api/health/`.

Ortam değişkenleri `.env` (şablon `.env.example`), prod için `.env.prod`.

---

## 3. Mimari invariant'lar

Bunlar tercih değil, **kırılınca sessizce bozulan** kurallardır. Çoğu geçmişte
gerçekten yaşanmış hatalardır (bkz. `REFACTOR_MONOREPO_PLAN.md`).

1. **JWT localStorage'da.** Bu yüzden auth gerektiren hiçbir sayfa Server
   Component olamaz — sunucu token'ı okuyamaz. Panel sayfaları Client
   Component'tir, koruma `lib/api/guards.tsx` ile yapılır.
2. **`middleware.ts` sadece i18n'dir.** Rota koruması oraya taşınmaz.
3. **Frontend'de çıplak `fetch()` yok.** Her istek `lib/api/client.ts`
   üzerinden gider; Authorization header ve refresh mantığı oradadır.
4. **Private dosyalar `?token=` ile açılır.** `<img src>` ve `<a href>` header
   taşıyamaz; `QueryParamJWTAuthentication` bunun içindir. `/media/private/`
   yolu istemciye doğrudan verilmez.
5. **Prod `daphne config.asgi:application` ile koşar.** gunicorn/WSGI'ye
   dönmek Channels WebSocket'ini (chat + calendar) sessizce kırar.
6. **DRF `fields="__all__"` ham FK adı döndürür** — `school`, `lesson_type`,
   `teacher`; `school_id` değil. Supabase dönemi `_id` alışkanlığı frontend'de
   sessiz `undefined` üretir.
7. **`SchoolScopedModelViewSet.create()`**: `school` alanı **validasyondan
   önce** enjekte edilmeli, yoksa `school` içeren `UniqueConstraint`'li
   modellerde DRF onu zorunlu alan sanar.
8. **Channels broadcast payload'ı JSON-safe olmalı** (UUID → `str`), aksi
   halde `channels_redis` msgpack serializer'ı patlar.
9. **Realtime yalnızca Django Channels'tır** (`catalog/consumers.py`,
   `chat/consumers.py`, istemci `lib/ws.ts`). Yeni realtime kanalı bu desene
   eklenir.
10. **`frontend/src/app/api/` altına route eklenmez.** nginx `/api/`'yi
    doğrudan Django'ya yönlendirir; oradaki route'lar erişilemez olur.

---

## 4. Domain kuralları (değiştirilemez)

1. **Tek motor: paketler ve krediler.** "Subscription" ayrı bir mekanizma
   değil, *recurring package*'ın görünen adıdır. İkinci bir düşüm, iade veya
   raporlama yolu **açılmaz**. (`PACKAGE_TO_SUBSCRIPTION.md`)
2. **Krediler `Decimal`**, yarım kredi adımlı. Asla `float` / `int` değil.
3. **Cüzdanlar okul bazlıdır** (`SchoolStudent`). Öğrenci her okulda ayrı
   bakiye taşır.
4. **İptal politikası**: ders saatine kalan süre okul eşiğinin
   (`School.cancellation_policy_hours`) üstündeyse kredi iade edilir, altındaysa
   yanar. No-show her zaman yakar.
5. **Yapılandırılabilir matrisler koda gömülmez.** Rol/izin ve iş kuralları
   veritabanından okunur: `HQRole`, `SchoolRole` (HQ tanımlar, okul salt-okur),
   `AttendanceStatus` (`burns_credit`), `SchoolDocumentType`. Sabit rol listesi
   veya sabit "present/no_show" varsayımı yazmayın.
6. **Para akışı**: platform payı Stripe `application_fee_amount` ile; shop'ta
   ayrıca okul + referrer komisyonu (`School.shop_commission_percentage`).
7. **E-postalar her zaman Celery task ile** ve **transaction commit
   sonrasında** kuyruğa girer (`notifications/tasks.py`). Atomic blok içinde
   `.delay()` çağırmak rollback durumunda hayalet e-posta gönderir.

---

## 5. i18n

- Beş locale: `en` (varsayılan), `it`, `es`, `fr`, `de` —
  `frontend/src/i18n/routing.ts`.
- Kullanıcıya görünen **her** string `next-intl` üzerinden; sözlükler
  `frontend/messages/<locale>.json`. Yeni anahtar eklenirken beş dosyanın
  hepsi güncellenir.
- **ICU tuzağı**: mesaj metninde süslü parantez ve açılı parantez parse hatası
  verir (bir sekme başlığındaki kapanış etiketi bunu bir kez kırdı). Kaçırın
  veya yeniden ifade edin.
- İçerik ayrıca DB'de çok dilli: `name_it` / `name_en` / `name_fr` / `name_es`
  kolonları.

---

## 6. Kod konvansiyonları

**Backend** — app başına `models.py`, `serializers.py`, `views.py`; karmaşık iş
mantığı `services.py`'ye (referans örnek: `bookings/services.py`). Rol bazlı
route modülleri `config/api_hq.py`, `api_school.py`, `api_student.py`,
`api_teacher.py`, `api_chat.py`.

**Frontend** — sayfa dizini `app/[locale]/<rol>/<sayfa>/page.tsx`; büyük
sayfalar ayrı bir `XClient.tsx` kullanır. Paylaşılan parçalar `components/`,
yardımcılar `lib/`.

**Yorum dili** İtalyanca / İngilizce karışık — düzenlediğiniz dosyanın diline
uyun, toplu çeviri yapmayın.

---

## 7. Git & deploy

- **`develop` ana branch'tir** (`main` değil). PR hedefi `develop`.
- ⚠️ **`develop`'a push → EC2'ye otomatik deploy** (`.github/workflows/ci.yml`,
  ECR + `docker-compose.run.yml`, Slack bildirimli).
- Commit formatı: `feat(scope): …`, `fix(scope): …`, `i18n(scope): …`.
- Kullanıcı açıkça istemedikçe commit veya push yapılmaz.

---

## 8. Test

`pytest` container içinde (`make test`). Kapsam **çok düşük**: yalnızca
`bookings/tests/`, `commerce/tests/`, `core/tests/`. Yeni iş mantığı için
(özellikle kredi, booking, ödeme) test yazın — mevcut boşluk gerekçe değildir.

---

## 9. Açık riskler ve yapılmayacaklar

**Açık riskler**

- `.env`'deki Stripe anahtarları maskeli (bullet karakterli) → canlı Stripe
  çağrıları (checkout / onboard / refund) çalışmıyor. Webhook iş mantığı sağlam.
- Eski Supabase service-role key git geçmişinde duruyor, **rotate edilmedi**
  (`CLEANUP_REPORT.md`).
- Faz 8'in canlı kesmesi (gerçek Supabase prod verisi + storage byte transferi)
  yapılmadı.
- Paralel abonelik motoru (`subscriptions_catalog` / `student_subscriptions`)
  hâlâ şemada; silinmesi Hakan ile koordine edilecek.

**Yapılmayacaklar**

- Supabase'e geri dönen kod eklemek.
- İkinci bir kredi/abonelik motoru kurmak.
- `frontend/src/app/api/` altına route eklemek.
- Sırları repoya yazmak (`.env*` ignore'da, yalnızca `*.example` izlenir).

---

## 10. Uygulanmamış spec özellikleri — bilinçli boşluklar

Aşağıdakiler arşiv spec'inde tarif edilir ama **kasıtlı olarak
uygulanmamıştır**. Bunlar **bug değildir**; bir görev açıkça istemedikçe
"eksik" diye geliştirmeye başlamayın.

| Özellik | Arşiv spec | Durum |
|---|---|---|
| HQ Network Map (interaktif harita) | §6.5 | Sayfa yok |
| HQ Alert Center & otomasyon kuralları | §6.6 | Yok |
| Special Event / Workshop onay akışı | §6.8 | Kodda hiç yok |
| PWA Push notification | §16, §22 | `next-pwa` yok, service worker yok, web-push yok; sadece `manifest.json` var |
| Öğrenci video kursu vitrini / satın alma | §9.7, §17.4 | `LibraryContent.student_access` alanı var, öğrenci sayfası yok |
| Öğrenci Notification Center | §9.10 | `notifications` tablosu var, sayfa kaldırıldı |
| Waitlist motoru | §7.3 | `Course.waitlist_enabled` alanı var, motor yok |
| PayPal / Satispay / Revolut entegrasyonu | §13.4 | Sadece Stripe otomatik; diğerleri manuel etiket (`cash`, `bank_transfer`, `card`) |
| Ayrı "Subscriptions" ürünü | §7.9, §9.5, §10.2 | **Bilinçli olarak emekliye ayrıldı** — tek motor kararı |
| Drop-in booking (tek ders satın al) | — | `DROP_IN_BOOKING.md`'de **teklif** aşamasında, uygulanmadı |

Ayrıca spec'te **olmayan ama kodda var olan** parçalar: `geography`
(ülke/şehir), `translations` (UI-copy CRUD + AI çeviri), HQ brand-settings /
homepage-settings / permissions / debug sayfaları, HQ'ya ait paketler
(`Package.school = null`), çoklu rol (`User.roles[]` + RoleSwitcher),
`PendingInvitation` davet akışı, öğretmen chat'i (`school_teacher`,
`teacher_support`). Detay: `docs/ARCHITECTURE.md`.
