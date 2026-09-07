> Round-2 live regression, 2026-09-07 — per-panel detail report written by the crosscut QA agent. Entry point: [QA_REGRESSION_ROUND2_SUMMARY.md](QA_REGRESSION_ROUND2_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…` or `$SP/reports/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round2-screenshots/](docs/qa/round2-screenshots/).

# QA Regression Round 2 — Cross-cutting agent report

**Agent:** cross-cutting (authorization matrix, cross-tenant isolation, public surface, auth flows, automated i18n crawl)
**Profile:** `xcut-agent` · inbox prefix `qa-r2-x-` · screenshot prefix `x-`
**Tenants:** QA R2 School E1 (`42737a96-32c0-4798-baaa-275425363da4`, admin `qa-r2-school-e1@uberip.com`) and QA R2 School E2 (`47010765-5c77-42e7-bd66-0de0e0b08606`, admin `qa-r2-school-e2@uberip.com`).
**Environment:** live `https://dev.danzaclassicanounder40.com`, develop @ 8153889.
**Time window (UTC):** 2026-09-07 ~10:12 → ~10:45.
**Method:** built the full fixture set in each tenant via the real API/UI flows; ran a 2,133-combination authorization/isolation matrix (10 tokens × ~215 endpoint variants, raw results in `crosscut-matrix.json`, condensed table `crosscut-matrix-condensed.md`, anomalies `crosscut-matrix-anomalies.json`); WebSocket isolation probe (node `ws`); auth-flow suite; public-surface header/CORS/media/404 sweep; garbage-param 5xx hunt; Playwright i18n crawl (4 roles × page routes × 5 locales × desktop+mobile = 616 dumps + screenshots) + static comparison of the 5 message files. Every UI observation cross-verified with an independent curl+JWT call.

> **Coordinator throttle notice (received mid-run):** complied. Tokens are cached and refreshed (not re-logged); exactly **2 registrations** used (E1/E2 students), multi-role done via invite-as-teacher (no extra registration), **1 password-reset** used (token-reuse test). Ledger updated at `$SP/reports/REGISTRATION_LEDGER.md`. Login-limit test was **not** run to avoid locking out other agents (limit inferred from settings: 10/min); register 5/h and reset 5/h confirmed live via observed 429 (see Auth flows). X-Forwarded-For throttle-key check done with one request (no bypass — see F-below).

---

## 1. Verdict

Tenant isolation between schools is **fundamentally solid** — every E2 token against an E1 object returned 401/403/404, `?school=E1` is correctly ignored for non-HQ callers, the private-document endpoint and WebSocket channels are correctly gated, and all prior-round HQ escalation fixes still hold on `/api/hq/`. However this round found **three distinct authorization gaps** (a cross-role chat-inbox leak reachable by every teacher, a cross-tenant room write, and a total absence of HQ-role enforcement on `/api/school/*`) plus a **systemic unhandled-500 input-validation gap that reaches unauthenticated public endpoints**. None leak stack traces (DEBUG is off), and no money/credit corruption was found in this panel.

Counts: **High 4 · Medium 3 · Low 9** (plus a large "verified good" list).

---

## 2. Authorization / isolation matrix (core deliverable)

Full raw results: [`crosscut-matrix.json`](crosscut-matrix.json) (2,133 rows). Condensed view: [`crosscut-matrix-condensed.md`](crosscut-matrix-condensed.md). Status distribution: 403×914, 200×608, 404×211, 401×203, 400×159, 201×12, 205×10, 204×9, 405×5, 500×2.

Representative rows (E1 object ids probed with every token; `·` = combination not run):

| method · endpoint | anon | hq_owner | hq_support | e1_admin | e1_staff | e1_teacher | e1_student | e2_admin | e2_teacher | e2_student |
|---|---|---|---|---|---|---|---|---|---|---|
| GET /auth/me/ | 401 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| GET /hq/team/ | 401 | 200 | **403** | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| POST /hq/packages/ | 401 | · | **403** | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /hq/brand-settings/ | 401 | 200 | 403 | **200** | **200** | **200** | **200** | **200** | **200** | **200** |
| GET /school/students/ | 401 | 400 | 400 | 200 | 200 | 403 | 403 | 200(own) | 403 | 403 |
| PATCH /school/profile/ (probe) | 401 | · | 400 | · | 403 | 403 | 403 | · | 403 | 403 |
| POST /school/rooms/ (location=E1) | 401 | · | **201** | · | 403 | 403 | 403 | **201** | 403 | 403 |
| DELETE /school/closures/{E1} | 401 | · | **204** | · | 403 | 403 | 403 | 404 | 403 | 403 |
| POST /school/credits/grant/ {E1 stu} | 401 | · | 400 | · | · | 403 | 403 | 404 | 403 | 403 |
| GET /school/courses/{E1}/ | 401 | 200 | 200 | 200 | 200 | 403 | 403 | 404 | 403 | 403 |
| PATCH /school/courses/{E1}/ (probe) | 401 | · | **200** | · | 200 | 403 | 403 | 404 | 403 | 403 |
| GET /teacher/profile/ | 401 | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 200 | 403 |
| POST /teacher/attendance/{E1 lsn}/ | 401 | 403 | 403 | 403 | 403 | 400 | 403 | 403 | **404** | 403 |
| GET /student/profile/ | 401 | 403 | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 200 |
| POST /bookings/ {E1 lesson} | 401 | 403 | 403 | 403 | 403 | 403 | · | 403 | 403 | **404/no_valid_access** |
| GET /chat/conversations/{E1 stu-conv}/ | 401 | 200 | 200 | 200 | 200 | **200** | 200 | 404 | 404 | 404 |
| DELETE /chat/conversations/{E1 stu-conv}/ | 401 | · | 404 | · | · | **204** | 404 | 404 | 404 | 404 |
| GET /documents/{E1 doc}/ | 401 | 200 | 200 | 200 | 200 | 403 | 200 | 403 | 403 | 403 |
| GET /documents/{E1 doc}/file/?token= | · | — | — | — | — | — | owner 200 | **403** | **403** | **403** |
| GET /calendar/{E1}.ics | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |

Bold cells are findings (detailed below). Everything else is expected. **Cross-tenant reads/writes with E2 tokens against E1 objects returned 401/403/404 in every case** except the two write bugs (X-R2-02, X-R2-03).

`?school=<E1>` appended by a non-HQ caller: correctly **ignored** — an E2 admin still receives its own E2 rows (never E1's); E2 teacher/student get `not_a_school_member` (403). HQ with `?school=<E1>` is correctly honoured (drill-down). Verified across 15 scoped endpoints.

WebSocket isolation (`crosscut-matrix` companion, `ws` probe): no token → close 4401; garbage token → 4401; E2 token on E1 school/teacher/chat channel → close **4403**; E1 teacher (no staff grant) on E1 school-calendar → 4403; E1 admin/staff and HQ on E1 school-calendar → accepted; owning teacher/student/HQ on their channel → accepted. Only anomaly: unknown WS path `/ws/nope/` → HTTP **500** (see L-8). Consumers' `_can_access` (catalog/chat) enforce the same matrix correctly.

---

## 3. Findings

### HIGH

**X-R2-01 (High) — A plain teacher can read, write and DELETE every school↔student and HQ↔school conversation at her school (cross-role PII leak + destructive).**
- Where: `GET/POST/PATCH/DELETE /api/chat/conversations/{id}/…`; root cause `backend/chat/views.py` `_role_context()` + `visible_conversations()`.
- Repro (clean, fresh token): E1 teacher (`role=teacher`, `active_school=None`, no staff grant) → `GET /chat/conversations/` returns the school's HQ↔school conversation, her own teacher↔school conversation, **and the school↔student conversation** including `student_name`, `student_email`, and the private message bodies (`"QA R2 X E1 PRIVATE student->school msg"`, `"…school reply (private)"`). She can `GET …/{conv}/messages/` (200, full private content), `POST` a message into it (201), `PATCH` it (200), and `DELETE` it (204 — confirmed in the matrix; the probe actually deleted the student's conversation).
- Root cause: for a teacher whose `active_school_id` is null, `_role_context()` resolves `school_id` to her single school; `visible_conversations()` then returns **all** conversations with `school_id == that school`, not just conversations where `teacher == her`. Chat is under `/api/chat/`, so `core.section_guard` never applies.
- Expected vs actual: `config/api_chat.py` documents the matrix as "HQ↔School / School↔Student / Teacher↔HQ(support)"; a teacher must not see school↔student or HQ↔school. Actual: she sees and can destroy them.
- Control (isolation intact): E2 teacher on the same E1 conversation → **404** (cross-tenant holds; this is cross-**role** within one school).
- Impact: every student's identity + private support messages are exposed to any teacher at the school, and any teacher can silently delete those threads. Broadly reachable — a normal single-school teacher qualifies. NEW.

**X-R2-02 (High) — Cross-tenant write: a school admin can create a `SchoolRoom` under another school's location.**
- Where: `POST /api/school/rooms/`; root cause `schools/serializers.py::SchoolRoomSerializer` (`fields="__all__"`, `location` is an unscoped `PrimaryKeyRelatedField`) + `core/viewsets.py::SchoolScopedModelViewSet.create()` which **skips school injection when `school_field` contains `__`** (rooms use `school_field="location__school"`), so nothing checks the location belongs to the caller.
- Repro (clean): E2 admin `POST /school/rooms/` with `location` = an E1 location id → **201**; the room then appears in E1 admin's own `GET /school/rooms/` list. Reverted (deleted the probe room).
- Expected vs actual: a cross-tenant write must be 403/400. Actual: 201, foreign room injected into the victim school's room pool (where it becomes selectable for that school's lessons).
- Impact: cross-tenant data injection / integrity. Any authenticated school admin who knows/guesses another school's location UUID can pollute its rooms. NEW.

**X-R2-03 (High) — The HQ role-permission matrix is not enforced on `/api/school/*`; any HQ sub-role has full read/write/DELETE over every school's operational data.**
- Where: entire `/api/school/*` surface; `core/section_guard.HQSectionGuardMiddleware` only guards paths starting `/api/hq/`, and `SchoolScopedModelViewSet`/`is_hq()` treat **all** HQ as god-mode.
- Repro (clean): `qa.hq.support` (HQRole permissions = `["dashboard","inbox"]` only, confirmed via `/hq/permissions/mine/`) → `GET /school/closures/{E1}/` 200, `DELETE /school/closures/{E1}/` **204** (E1 admin re-GET → 404, i.e. it really deleted an E1 object), `POST /school/rooms/` into E1 **201**. During the matrix run this same `hq_support` also deleted an E1 location, room, student document, course, discount code and compensation plan via `/school/…/{id}/` DELETE.
- Contrast (the gap is real, not "HQ is trusted"): the **same** `hq_support` is correctly `403` on `/hq/team/`, `/hq/permissions/`, `POST /hq/packages/`, `PATCH /hq/schools/{id}/` — the prior-round HQSectionGuard fix works there. It simply does not extend to `/api/school/`, so a low-trust HQ role (`support`/`tech_support`) bypasses its own permission matrix entirely for all tenants' courses, lessons, packages, locations, rooms, credits, documents, closures, etc.
- Impact: privilege escalation within HQ + unrestricted cross-tenant mutate/delete. NEW (prior round hardened `/api/hq/` only).

**X-R2-04 (High) — Systemic unhandled 500 on malformed query params, including unauthenticated public endpoints.**
- No stack traces are leaked (bodies are the generic Django "Server Error (500)" page — DEBUG is off), but per this round's rule any 500 is a finding, and several are reachable **without authentication**.
- Public / unauthenticated 500s:
  - `GET /api/student/lessons/?school_id=<non-uuid>` (also `lesson_type_id`, `teacher_id`, `date=2026-13-45`) → 500
  - `GET /api/student/school-packages/?school_id=<non-uuid>` → 500
  - `GET /api/calendar/<school>.ics?type=x` / `?teacher=x` / `?location=x` → 500 (public iCal feed)
  - `POST /api/auth/complete-invite/` and `POST /api/auth/password-reset-confirm/` with a malformed `uid` → 500 (unauthenticated auth endpoints)
- Authenticated 500s (same class): `/school/lessons-feed/?from=x&to=y`, `/school/student-lesson-ids/?student=x`, `/school/students/detail/?student_id=x`, `/school/teachers/{id}/compensation/?month=2026-99`, `/school/compensation-summary/?month=x`, `/teacher/lessons/?date=x&from=x`, `/teacher/compensation/?month=x`, `/teacher/compensation-overview/?month=2026-13`, `/student/packages/?school=x`, `/student/subscriptions/?school=x`.
- Root cause pattern: raw casts of query params (UUID / date / `YYYY-MM` split) with no validation, surfacing as `ValueError`/`ValidationError` outside DRF's handled path (many are plain `APIView`/`View` reads). Note the well-behaved counter-examples where DRF filter backends validate (`/school/lessons/?teacher=x` → clean 400 `"is not a valid UUID"`), showing the fix pattern already exists elsewhere.
- Impact: trivial for anyone (incl. anonymous) to make the app 500; noise/alerting pressure and a poor client experience; the public iCal + catalog endpoints are the most exposed. NEW.

### MEDIUM

**X-R2-05 (Medium) — HQ settings GET endpoints are readable by any authenticated user (missing `is_hq` on GET).**
- `GET /hq/homepage-settings/`, `/hq/brand-settings/`, `/hq/homepage-real-stats/`, `/hq/student-shop-visibility/`, `/hq/student-credits-visibility/` return 200 to E1/E2 students, teachers and admins (only POST checks `is_hq`; `translations/views.py` / the homepage view GETs have no guard). The HQ section-guard maps these to the `homepage_settings` permission but only for HQ sub-roles, so non-HQ callers fall through to the unguarded view.
- Data returned is low-sensitivity (brand colours, public nav links, the same marketing counters already served publicly at `/platform-stats/`), so real exposure is small — but it is HQ-namespace data reaching every role and should be `is_hq`-gated for consistency. NEW.

**X-R2-06 (Medium) — `/school/compensation-summary/` POST accepts an arbitrary `teacher_id` with no membership check; creates a junk payment row and echoes the foreign teacher's name.**
- E2 admin `POST /school/compensation-summary/ {teacher_id:<E1 teacher>, month, amount}` → **201**, creating a `TeacherCompensationPayment` in E2's scope that references an E1 teacher, and returning `teacher_name:"QA R2 X E1 Teacher"`. `teachers/views.py::SchoolCompensationPaymentsSummaryView.post` does `update_or_create(school_id=<caller>, teacher_id=<body>, …)` without verifying the teacher belongs to the caller's school (unlike the sibling GET at `/school/teachers/{id}/compensation/`, which does check `TeacherSchool`).
- Impact: cross-tenant teacher-name enumeration + creation of dangling payment rows referencing foreign teachers. No money moves and the row lives in the caller's own school. Reverted the created row. NEW.

**X-R2-07 (Medium) — `/school/packages/{id}/auto-translate/` returns HTTP 500 (should be 4xx/503) when `ANTHROPIC_API_KEY` is unset, and checks the key before ownership.**
- `POST /school/packages/{any pkg}/auto-translate/` → **500** `{"error":"ANTHROPIC_API_KEY not configured"}` for hq_support and for E2 admin against an E1 package (`catalog/views.py::PackageAutoTranslateMixin` returns `status=500` and does the key check before `self.get_object()`). No data is exposed (would 404 after the key check if configured), but the status code is wrong and it is another authenticated 500. NEW.

### LOW / informational

- **X-R2-08 (Low)** — `GET /stripe/verify-session/?session_id=x` → **502** with the raw Stripe error in the body: `{"error":"stripe_retrieve_failed","detail":"InvalidRequestError: Request req_…: No such checkout.session: x"}`. Leaks a Stripe request id and confirms session validity to any authenticated user.
- **X-R2-09 (Low, i18n)** — literal placeholder copy shipped in the message files and rendered live: `auth.setup.welcomeDesc` = `"Descrizione Benvenuto"` (it), `"Descripción de bienvenida"` (es), `"Description de bienvenue"` (fr), `"Willkommensbeschreibung"` (de) instead of the EN copy "Just a few details and you'll be ready to go." — **visible on the public `/setup-account` page** (every invited teacher/staff sees it; screenshot `x-setup-account-e1staff.png`). Same pattern: `hq.permissions.role{Owner,SuperAdmin,Finance,Analytics,Operations,Support,TechSupport}Desc` (it/fr) and `hq.packages.placeholderDescription` (it/fr) = "Descrizione X" / "Description X" placeholder text.
- **X-R2-10 (Low, i18n)** — dropped `{count}` interpolation in `school.reports.export{Lessons,Students,Teachers}Tooltip` for es/fr/de (e.g. es "Exportar Clases" vs en "Export {count} students") and flattened ICU plural in `hq.locations.citiesLabel` (it/es/fr/de are plain nouns, no `{count}`). Cosmetic; tooltips lose the number. Details in `crosscut-i18n-static.json`.
- **X-R2-11 (Low)** — `x-powered-by: Next.js` is present on every frontend response despite `poweredByHeader:false` in `next.config.ts` (config not taking effect, or added downstream). Minor tech-stack disclosure.
- **X-R2-12 (Low/informational)** — `/api/docs/` (Swagger UI) and `/api/schema/` (314 KB OpenAPI) are served **unauthenticated** (`SERVE_INCLUDE_SCHEMA=False` but the views themselves have no permission). Full API surface is public.
- **X-R2-13 (Low)** — CSP has no `frame-src`/`frame-ancestors` beyond `default-src 'self'`, so any externally-iframed Library content is blocked ("Refused to frame 'https://example.test/'…" in console). Only seed URLs affected today; will bite real embeds. (Complements prior-round H-3 which fixed `media-src` for `<video>`.)
- **X-R2-14 (Low)** — `/school/courses/{id}/edit` throws an **uncaught** `PAGEERROR "API error 400"` when the course id is missing/invalid, instead of a graceful not-found state (observed when a course had been deleted; the page loads cleanly for a valid id).
- **X-R2-15 (Low)** — `/ws/nope/` (unknown WebSocket path) → HTTP **500** at the ASGI router (unmatched route) rather than a clean 404/close.
- **X-R2-16 (informational)** — the personal iCal token is not exposed anywhere in the student API (`StudentSerializer` omits `ical_token`), so `/api/calendar/student/<token>.ics` is effectively unreachable by students through the product — a likely dead/unwired feature (not a security issue; the 36-char UUID feed isn't brute-forceable). `/api/calendar/<school_id>.ics` is intentionally public and returns all non-cancelled lessons + teacher names for any known school UUID.

---

## 4. Auth flows (all behaved correctly unless noted)

| check | result |
|---|---|
| login wrong password / unknown email / uppercase email | 401 "No active account…" (uniform; no user enumeration on login) |
| login missing password | 400 field required |
| access token: garbage / tampered sig / refresh-as-access | 401 `token_not_valid` (correct, distinct messages) |
| refresh valid → rotates access + refresh | 200, both change |
| refresh **reused** (rotated one) | 401 "Token is blacklisted" ✓ (BLACKLIST_AFTER_ROTATION works) |
| refresh garbage / access-as-refresh | 401 invalid / wrong type |
| logout {refresh} | 205; that refresh then 401 blacklisted ✓ (access stays valid until exp — JWT stateless, expected) |
| change-password wrong current / weak / numeric / common | 400 with specific reasons |
| change-password success → old password login fails, new works | ✓ |
| Google login garbage credential / no credential | **400/503** (not 500) ✓ (503 = "Google login not configured" on dev) |
| complete-invite / password-reset-confirm bad **token** | 400 `invalid_or_expired_token` ✓ |
| complete-invite / password-reset-confirm malformed **uid** | **500** ✗ (see X-R2-04) |
| register invalid payload | 429 (shared-IP throttle; register limit **5/hour** confirmed) — inferred, not deliberately burned |
| password reset end-to-end (UI email → token) | token single-use: 1st use 200 + auto-login, 2nd use **400** ✓, bad token 400 ✓, reset password logs in ✓ |
| setup-account invite (UI) single-use | 1st completes → dashboard, 2nd shows "Questo link è scaduto o è già stato utilizzato" ✓ |
| multi-role (student invited as teacher) | roles become `[student, teacher]`, JWT carries `roles[]`, both `/student/*` and `/teacher/*` work, `/select-role` page present ✓ |
| multi-school student books foreign lesson | atomic: no credits at that school → `no_valid_access`, **no orphan SchoolStudent link** created (rolled back) ✓; with valid credits it would enrol + charge that school's wallet |
| X-Forwarded-For throttle bypass | **not possible** — edge nginx sets `X-Forwarded-For $proxy_add_x_forwarded_for` (appends real `$remote_addr`) and `X-Real-IP $remote_addr`; with `NUM_PROXIES=1` DRF reads the appended real IP as the last element (F, one request confirmed normal 401) |

Section guard (school): `staff` correctly 403 (`section_forbidden`) on sections it lacks (`payments`, `reports`, `team`, `settings`, `packages`, `attendanceStatuses`); non-member 403 `not_a_school_member`. Prior-round HQ escalation fixes on `/api/hq/` all **still hold** (`hq_support` 403 on team/permissions/packages/schools writes).

---

## 5. Public surface

- Security headers (frontend): CSP present **with `media-src`** (prior H-3 fixed), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS `max-age=63072000`, `Cache-Control: no-cache`. API responses: `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: same-origin`, HSTS. (HSTS on dev omits `includeSubDomains` — minor.)
- CORS: a foreign `Origin: https://evil.example` preflight returns 200 but **no `Access-Control-Allow-Origin`** header (browser blocks); same-origin gets `ACAO` + credentials. Correctly restricted (`CORS_ALLOWED_ORIGINS` allow-list). Not a finding.
- Media: `/media/private/…` → 404 (no route), `/internal-media/…` → 404 (nginx `internal`), `/media/public/<missing>` → 404. Private storage correctly unreachable.
- `/admin/` → 302 → `/admin/login/` (200) — login page reachable (noted only, not logged in; out of scope).
- Routing: `/login` → 307 `/en/login`; `/` → `/en`; `Accept-Language: it` → `/it`; unsupported `/tr/login` → `/en/tr/login` (404); random `/en/<x>` → 404 (bilingual 404 page renders). `http://` → 301 `https://`. Host header `evil.example` → 400. TRACE → 405.
- PWA/manifest: `manifest.json` 200 (valid, `start_url:/student/dashboard`), icons + apple-touch-icon 200; **`favicon.ico` 404**, `sw.js` 404 (no service worker — PWA push is a documented conscious gap), `robots.txt` 404.
- `/ws/` without token → 400 (HTTP) / 4401 close (WS). Bad JSON body → clean 400 with parse message. Method-not-allowed → 405.
- See X-R2-04, X-R2-08, X-R2-12, X-R2-13 for the public-surface findings.

---

## 6. Automated i18n crawl

616 dumps under `$SP/reports/i18n/` + screenshots `$SP/shots/x-*.png` (422). Roles crawled: HQ owner, E1 admin (school), E1 teacher, E1 student, plus public pages; 5 locales; desktop + top-level mobile.
- **No horizontal overflow >4px** on any page (desktop or mobile) — responsive layout is clean.
- **No page-load errors, no 5xx page loads.** Console noise = `favicon.ico` 404s and CSP frame-blocks on `example.test`/seed URLs (X-R2-13). One transient Next.js "Failed to fetch RSC payload … falling back" (benign).
- Regex scan (`scan_dumps.py`): **`titlecase_frag` (Label/Kpi/Tab/Col…) = 0**, no dotted i18n keys in rendered copy (the only `\w+\.\w+\.\w+` hits are the account email `qa.hq.owner` in the header), **no `undefined` / `NaN` / `[object Object]` / stray `null`**. The only `{var}`/`{{` hits are on the HQ Emails template editor, which legitimately shows `{placeholder}` variables. → **The systemic raw-key regression from prior rounds is NOT present.**
- Static comparison of `messages/{en,it,es,fr,de}.json` (`crosscut-i18n-static.json`): all 5 files have the **same 3,083 keys** (no missing/extra). Identical-to-en values: it 62 / es 54 / fr 122 / de 87 — mostly legitimate loanwords (Dashboard, Online, Shop, Team, Studios, Metodo). Real defects among them are the placeholder-text keys (X-R2-09). Placeholder-set mismatches (X-R2-10). No unbalanced ICU braces (the only `{{` is the intentional `{{booking_url}}` hint in `emailEditor.linkPrompt`).

---

## 7. Emails verified (via mail.tm inboxes)

| trigger | inbox | subject | locale | link worked? |
|---|---|---|---|---|
| school team invite (E1, staff) | qa-r2-x-e1-staff | "✉️ Sei stata invitata nel team…" | **it** ✓ | ✓ setup-account single-use (UI completed, reuse blocked) |
| school team invite (E2, staff) | qa-r2-x-e2-staff | "✉️ Te han invitado al equipo…" | **es** ✓ | ✓ complete-invite via API; reuse → 400 |
| teacher invite (E1) | qa-r2-x-e1-teacher | "✉️ Sei stata invitata…" | **it** ✓ | ✓ completed (roles=[teacher]) |
| teacher invite (E2) | qa-r2-x-e2-teacher | "✉️ Te han invitado…" | **es** ✓ | ✓ completed |
| student welcome (E1 register) | qa-r2-x-e1-student | "🩰 Benvenuta…" | **it** ✓ | profile link ✓ |
| student welcome (E2 register) | qa-r2-x-e2-student | "🩰 ¡Bienvenida…" | **es** ✓ | profile link ✓ |
| password reset (E1 student) | qa-r2-x-e1-student | "🔑 Reimposta la tua password" | **it** ✓ | token single-use ✓ |

All arrived within ~10 s, correct per-recipient locale, links well-formed and functional. Team-invite email locale correctly threads the school language (prior-round M-6 fix holding). Note: `enabled.team_invite` was already TRUE (coordinator flipped it at 10:00 UTC); left as-is.

---

## 8. Test data created (all `QA R2 X`-named; left in place unless noted)

- Fixture ids: [`crosscut-fixtures.json`](crosscut-fixtures.json). Two full fixture sets (E1, E2): staff, teacher, student, course + 2 lessons (one booked), package, discount code, document type + uploaded student document, location + room, closure, 2 attendance statuses, compensation plan, school↔student + teacher↔school chat conversations with messages, a manual credit grant.
- Accounts created (persist): `qa-r2-x-e1-staff@`, `qa-r2-x-e1-teacher@`, `qa-r2-x-e1-student@`, `qa-r2-x-e2-staff@`, `qa-r2-x-e2-teacher@`, `qa-r2-x-e2-student@` (all `@uberip.com` / `QaRound2!2026`). The E2 student is now **multi-role** `[student, teacher]` (from the select-role test) with teacher id `b508f06e-…`.
- Probe rows created for findings and then **reverted**: cross-tenant rooms under E1 (deleted), a junk `TeacherCompensationPayment` in E2 (deleted), throwaway closures/rooms for the god-mode repro (deleted).
- **Self-inflicted fixture churn (disclosure):** my matrix's `hq_support` DELETE probes (X-R2-03, god-mode) and `e1_teacher` chat DELETEs (X-R2-01) destroyed several E1 fixtures mid-run (location, room, student document, course + lessons, discount code, compensation plan, 2 conversations). I **rebuilt** all of them afterward (new ids recorded in `crosscut-fixtures.json`), so both tenants end the round with a complete fixture set. No production-like school (Milano/Barcelona/Hakan) or other agent's tenant was touched.
- Ledger updated: `$SP/reports/REGISTRATION_LEDGER.md` (2 registrations, 1 password reset by this agent).

---

## 9. Verified good (re-verification + isolation that held)

- Cross-tenant isolation between E1↔E2: **clean** — every E2 token vs E1 object = 401/403/404; `?school=` ignored for non-HQ; document file endpoint (anon 401, foreign `?token=` 403, path-traversal 404, owner/school 200); WS channels 4403 for foreign tokens.
- Prior-round HQ escalation fixes (`/api/hq/`): `hq_support` 403 on team/permissions/packages/schools-writes; `/hq/permissions/mine/` self-serve 200. **Holding.**
- Prior-round M-6 (school-invite email locale) and M-7 (locale-cookie override removed — shared `/it/…` links no longer bounced) — invite emails arrive in the school's language; explicit URL locales are respected. **Holding.**
- JWT refresh rotation + blacklist, logout blacklist, change-password invalidation, Google 400/503-not-500 — all correct.
- Section guard (school + HQ) enforces role matrices on their own path prefixes.
- i18n raw-key regression **not present** anywhere in this crawl.

## 10. Not tested / assumptions

- Django Admin — out of scope (only noted `/admin/login/` reachable).
- Live Stripe checkout completion / webhook fulfilment — Student agent's domain; I only checked auth/permission on `/stripe/*` (verify-session leak X-R2-08).
- Login-throttle (10/min) not deliberately exhausted (shared IP; would lock out other agents) — inferred from settings; register-5/h and reset-5/h confirmed via observed 429.
- Assumption: an "any 500 is a finding" reading per the brief, even though DEBUG is off and no tracebacks leak — grouped as X-R2-04 with the full list.
- Assumption: for the multi-role case I used the E2 student (invited as teacher at E2) rather than E1, to limit further perturbation of E1 fixtures — behaviour is identical.

## 11. Screenshot index (selected; all under `$SP/shots/`)
`x-setup-account-e1staff.png`, `x-setup-account-done-e1staff.png`, `x-setup-account-reuse-e1staff.png` (invite single-use), `x-verify-edit-valid-course.png`, plus 616 crawl screenshots `x-<role>-<page>-<locale>[-mobile].png`.
