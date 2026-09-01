# Load & Security Test Report

**Date:** 2026-09-01
**Revision tested:** `837e8df` (`develop`, in sync with `origin/develop`)
**Environment:** local Docker stack only. Production was never touched.
**Tools:** k6, OWASP ZAP, Nuclei, Semgrep, Bandit, pip-audit, npm audit, Trivy, Gitleaks
— all free/OSS, all run as containers.

> The local checkout was 87 commits behind `origin/develop` when this started.
> It was fast-forwarded first; everything below describes current `develop`.

---

## 1. Executive summary

The **API's security posture is solid**: 65 of 65 authorization checks passed on the
paths that matter (tenant isolation, JWT forgery, unauthenticated access, IDOR on
bookings), and a full 6,941-template Nuclei sweep against the backend produced
**zero** matches. The real problems are elsewhere.

| Area | Verdict |
|---|---|
| Multi-tenant isolation (school A ↔ school B) | **Holds.** No cross-tenant read or write found. |
| JWT handling | **Holds.** alg=none, stripped/tampered signatures, re-signed payloads all rejected. |
| Object-level IDOR (bookings) | **Holds.** Cross-tenant read/modify/cancel all refused. |
| Rate limiting | **Absent everywhere.** Highest-priority security gap. |
| Secrets hygiene | Service-role key still live in git history, unrotated. |
| Load capacity | **~50 req/s ceiling.** Fails well below a realistic launch load. |

Two issues would hurt first in production: **no rate limiting on authentication**,
and a **database connection model that collapses under concurrency**.

---

## 2. Load testing (k6)

### 2.1 Method

The dev stack runs `manage.py runserver` with `DEBUG=True`, which is meaningless for
capacity. Numbers below come from a **production-equivalent server** started
alongside it: `daphne config.asgi:application` with `config.settings.production`
(`DEBUG=False`) — matching `docker-compose.prod.yml:81`.

### 2.2 Mixed-workload result — `ops/testing/load/api_load.js`

95 peak VUs over 2 minutes across three scenarios (anonymous browsing, student
journey with booking, school-admin dashboard):

| Metric | Value | Threshold | |
|---|---|---|---|
| `http_req_duration` p95 | **33.76 s** | < 1.5 s | ✗ |
| `http_req_duration` median | 4.62 s | | |
| `http_req_failed` | **16.23 %** (268 / 1651) | < 1 % | ✗ |
| Login p95 | 8.78 s | < 1 s | ✗ |
| School dashboard p95 | 10.48 s | < 2.5 s | ✗ |
| Throughput | 12.9 req/s | | |

### 2.3 Where the ceiling actually is — `ops/testing/load/concurrency_probe.js`

To separate "slow endpoints" from "slow server", `/api/health/` — a single trivial
query — was driven at a rising arrival rate up to 400 req/s:

| Result | Value |
|---|---|
| Sustained throughput | **~50 req/s** |
| p95 latency | 6.55 s |
| Failed requests | 23.81 % (1251 / 5254) |
| Dropped iterations | 6,040 |

**An endpoint that does almost nothing still collapses.** The bottleneck is the
server tier, not application logic.

### 2.4 Root causes (all verified)

**a) No database connection reuse — this is what produced the 5xx.**

`backend/config/settings/base.py:101` defines `DATABASES` with **no `CONN_MAX_AGE`**,
so Django's default of `0` applies: a new PostgreSQL connection is opened and torn
down for *every request*. PostgreSQL is at `max_connections = 100` with no pooler
(no pgbouncer anywhere in the compose files). Under load the server logs:

```
django.db.utils.OperationalError: connection to server at "db" port 5432 failed:
FATAL:  sorry, too many clients already
```

198 5xx responses from Django and 1,684 5xx/499 at nginx during the test window.

*Fix:* set `CONN_MAX_AGE` (e.g. 60) and `CONN_HEALTH_CHECKS = True`; raise
`max_connections`; add pgbouncer if the process count grows.

**b) Production runs a single daphne process.**

`docker-compose.prod.yml:81` is `exec daphne -b 0.0.0.0 -p 8000 config.asgi:application`
— no `--workers`, no `deploy.replicas`. One process serves all HTTP *and* all
WebSocket traffic (chat + calendar). That is the 50 req/s ceiling.

*Fix:* run N daphne processes behind nginx upstream (or Uvicorn workers under a
supervisor). Keep ASGI — switching to WSGI would break Channels, per invariant #5.

**c) N+1 queries — measured with `ops/testing/load/query_profile.py`**

With only **31 students** seeded:

| Endpoint | Queries | Time | Payload |
|---|---|---|---|
| `/api/school/reports/detailed/` | **207** | 490 ms | 6.0 KB |
| `/api/school/students/` | **69** | 258 ms | 14.4 KB |
| `/api/school/reports/` | 16 | 25 ms | 0.3 KB |
| `/api/school/compensation-summary/` | 9 | 27 ms | 0.2 KB |

Both scale linearly with student count — a 500-student school means roughly
3,000 and 1,000 queries per page load.

*Fix:* `select_related` / `prefetch_related` on those two views.

**d) `/api/translations/` ships 117 KB, uncached, on every page load.**
One query, but the largest payload in the app. Add an ETag or a Redis cache layer.

For reference, everything else is fast at N=1: all student endpoints ≤ 16 ms,
most school endpoints ≤ 22 ms. **The application code is not the problem — the
serving architecture is.**

---

## 3. Security testing

### 3.1 What held up (65 checks passed)

Verified with `ops/testing/security/authz_probe.py` and `idor_bookings.py`, using
two fully isolated seeded schools:

- **Tenant isolation:** school A admin cannot read school B lessons, courses,
  packages, or attendance. A `?school=` / `?school_id=` query override is ignored.
- **Object-level IDOR:** student A cannot read, modify, or cancel student B's
  booking; anonymous cannot either; a cross-school admin cannot. The booking
  survived every attempt intact.
- **Credit integrity:** booking a foreign-school lesson with a forged
  `credits_deducted: 0` is refused (`no_valid_access`); balance unchanged.
- **JWT:** signature-stripped, `alg=none`, tampered-signature, and re-signed
  role-elevated tokens are all rejected. Refresh tokens are blacklisted on logout.
- **Registration:** cannot self-assign `role: hq` / `is_staff`; weak passwords
  (`1`, `123456`, `password`) rejected; no user enumeration on login.
- **Unauthenticated:** all 15 probed private endpoints return 401/403.
- **Exposure:** `/.env`, `/.git/config`, `/.git/HEAD`, and `../` traversal all blocked.
  `DEBUG` is off — no tracebacks. CORS rejects arbitrary origins.
- **Nuclei vs. the Django API:** 15,350 requests, 6,941 templates, **0 matches**.
- **ZAP baseline:** 52 pass, 15 warnings, **0 failures**.

### 3.2 Findings

#### HIGH — No rate limiting anywhere

`REST_FRAMEWORK` in `backend/config/settings/base.py:137` sets no
`DEFAULT_THROTTLE_CLASSES` / `DEFAULT_THROTTLE_RATES` (Semgrep flags this as
`missing-throttle-config`). Measured against the running app:

| Endpoint | Result |
|---|---|
| `POST /api/auth/login/` | 30 wrong-password attempts, **no 429** — unlimited brute force |
| `POST /api/auth/password-reset/` | 20 requests in **0.5 s**, all HTTP 200 — mail-bomb vector |
| `POST /api/auth/register/` | 20 accounts created in 9.2 s — no signup abuse control |

This is the single highest-value fix. It compounds with §3.2's admin exposure.

#### HIGH — JWT signing key is 22 characters

`DJANGO_SECRET_KEY` in the local `.env` is 22 characters. PyJWT warns at runtime:

```
InsecureKeyLengthWarning: The HMAC key is 22 bytes long, which is below the
minimum recommended length of 32 bytes for SHA256.
```

SimpleJWT signs every access and refresh token with this key. A short key
materially shrinks the brute-force cost of forging tokens.

**Production's value was not inspected** — `.env.prod.example` ships it blank.
Verify the deployed key is ≥ 50 characters; if it is not, rotate it (which
invalidates all live sessions — plan the timing).

#### HIGH — Supabase service-role key still in git history

Gitleaks scanned 819 commits and reported 19 hits. Eighteen are false positives
(`templateKey` string literals in `hq/emails/page.tsx`, a `key =` assignment in
`notifications/tasks.py`). **One is real:**

```
commit 3b441cb4  .env.test:15   SUPABASE_SERVICE_ROLE_KEY=sb_sec...
                 .env.test:11   TEST_STUDENT_PASSWORD=...
```

This matches the unrotated-key item already tracked in `CLEANUP_REPORT.md`. A
service-role key bypasses row-level security entirely. Rotate it in Supabase —
rewriting git history is optional, rotation is not.

#### HIGH (latent) — School-scoped viewsets carry no role check

`SchoolScopedModelViewSet` (`backend/core/viewsets.py`) sets
`permission_classes = [IsAuthenticated]` and nothing else. Tenant scoping keys off
`user.active_school_id`. `SchoolSectionGuardMiddleware` (`core/section_guard.py`)
is documented as fail-open and returns `None` (allow) for any role that is not
`school`, students included.

Empirically confirmed: a student account with `active_school` set reads **9**
school-admin endpoints — full student roster, revenue reports, teacher compensation
— and **writes** (`POST /api/school/locations/` → HTTP 201, row created).

**This is not currently reachable.** `RegisterSerializer.create` never sets
`active_school`, and neither student enrollment path does
(`students/views.py:103`, `bookings/services.py:449` — they set `student.school`,
a different column). `UserSerializer` exposes `active_school` as writable but is
only ever used for output. Verified with a student registered through the real API:
all admin endpoints returned 400/empty.

So the only thing standing between a student and the school admin panel is *an
unset column* — not an access check. Any future code path that sets
`active_school` for a non-school role opens it, and the codebase already supports
multi-role accounts (`accounts/migrations/0009_seed_test_personas.py` creates one
that is both Teacher and Student).

*Fix:* add an explicit role/membership check to `SchoolScopedModelViewSet`, and
make the section guard fail closed.

#### MEDIUM — Django admin publicly exposed

`/admin/login/` returns HTTP 200, and `nginx/nginx-prod.conf:99` proxies `/admin/`
straight to Django in production too. With no login rate limiting (above), this is
a credential-stuffing target. Restrict by IP/VPN at nginx, or at minimum throttle it.

#### MEDIUM — Public lesson feed leaks `online_link` and `notes`

`/api/student/lessons/` is `AllowAny` **by design** (spec 9.2 — browsing must not
require login). But `LessonBookingSerializer` (`catalog/serializers.py:273`)
includes `online_link` and `notes` in that anonymous response. Anyone can harvest
the join URLs of paid online classes. Teacher identity is correctly gated behind
`show_teacher_to_students`; these two fields are not gated at all.

#### MEDIUM — CSP permits `unsafe-inline` and `unsafe-eval`

```
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net
```

Both directives defeat most of what CSP is for against XSS.

#### MEDIUM — Dependency CVEs

| Scanner | Result |
|---|---|
| pip-audit | **83 vulnerabilities in 6 packages** — Django 5.2.7 (47), Pillow 11.3.0 (25), django-allauth 65.3.0 (6), daphne 4.1.2 (2), requests 2.32.3 (2), pytest 8.3.5 (1) |
| npm audit | **12** — 1 critical (`jspdf` ReDoS), 8 high (`next`, `sharp`, `xlsx`, `postcss`, `nanoid`, `js-yaml`, `brace-expansion`, `jspdf-autotable`) |
| Trivy — `danza_django` | 17 CRITICAL / 271 HIGH (202 are `linux-libc-dev` kernel headers — not exploitable in-container) |
| Trivy — `danza_frontend` | 7 CRITICAL / 64 HIGH — `next` 15.5.14 → 15.5.21, `jspdf` 2.5.2 → 4.x |

Highest-value upgrades: **Pillow** (image handling on user uploads) and **daphne**
(the edge process). `requests` 2.32.3 → 2.32.4 is a one-line change.

#### LOW

- `Server: nginx/1.27.5` leaks the exact version (`server_tokens off;`).
- `Permissions-Policy` header not set.
- ZAP: missing `Cross-Origin-Embedder-Policy`, missing SRI on `/api/docs/`
  CDN scripts, 32 "suspicious comments".
- HSTS is absent locally but **correctly set in production**
  (`nginx-prod.conf:78`) — dev-only, not a real gap.

### 3.3 Dismissed after verification

Reporting these matters as much as the findings — each was flagged by a tool and
then disproved:

| Flagged as | Verdict |
|---|---|
| **CVE-2025-29927 Next.js middleware bypass, CVSS 9.1** (Nuclei) | **False positive.** Installed version is 15.5.14; the CVE affects 11.1.4–15.2.2, fixed in 15.2.3. Sending the `X-Middleware-Subrequest` header changes nothing (both requests → identical 307). |
| Student reads school admin data | **Test artifact.** My seeder set `active_school` on students; real registration never does. Re-tested with an API-registered student: blocked. The genuine latent form is filed above. |
| `/media/private/` exposed (HTTP 308) | **No.** The 308 is the i18n redirect; it resolves to 404. `../../etc/passwd` also 404. |
| Student lesson feed spans schools | **By design.** `StudentLessonsView` is the public cross-school catalogue (spec 9.2). |
| School admin reads HQ brand-settings | **By design.** Returns `{}`; `PATCH` is 405. Read-only branding. |
| Bandit: 3× SQL injection | **Not reachable.** All in `core/management/commands/etl_from_supabase.py`, a CLI command with no user input. |
| ZAP: cookies without HttpOnly | **Expected.** The only cookie is `csrftoken`, which must be JS-readable. Production sets `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE`. |
| Teacher hits `/api/school/*` → HTTP 400 | **Not a bypass.** `"school is required"` — a missing parameter, no data returned. |

### 3.4 Coverage gaps — what was *not* tested

- **Private document access.** No `StudentDocument` row existed to probe; the
  upload path was never exercised. `/api/documents/{id}/file/` and the
  `X-Accel-Redirect` private-media path remain untested.
- **Nuclei against the frontend reached only 29 %.** The Next.js **dev** server
  crashed mid-scan (`.next/server/pages-manifest.json` missing, repeated
  `uncaughtException`) and stopped responding. This is a dev-mode artifact —
  production runs a prebuilt standalone server — but it means the frontend was
  not fully swept. Re-run against a production build.
- **Stripe flows.** `.env` keys are masked, so checkout/onboard/refund could not
  be exercised. Webhook signature verification was not tested.
- **WebSocket/Channels** (`/ws/`) was not load-tested or fuzzed.
- **No authenticated ZAP active scan** — baseline (passive) only.

---

## 4. Recommended order

1. **Add DRF throttling** — login, password-reset, register. Cheapest fix, largest risk reduction.
2. **Set `CONN_MAX_AGE`** — one line; removes the 5xx cliff under load.
3. **Rotate the Supabase service-role key.**
4. **Verify the production `DJANGO_SECRET_KEY` is ≥ 50 chars.**
5. **Run multiple daphne processes** behind nginx.
6. **Restrict `/admin/`** by IP at nginx.
7. **Fix the two N+1 endpoints** (`reports/detailed/`, `school/students/`).
8. **Drop `online_link` / `notes`** from the anonymous lesson feed.
9. **Add a role check** to `SchoolScopedModelViewSet`; make the section guard fail closed.
10. **Upgrade Pillow, daphne, requests, next, jspdf.**

---

## 5. Reproducing

See `ops/testing/README.md`. All artifacts are in `ops/testing/reports/`.
