> Round-3 live regression, 2026-09-08 — per-panel detail report written by the xcut QA agent. Entry point: [QA_REGRESSION_ROUND3_SUMMARY.md](QA_REGRESSION_ROUND3_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…`, `$SP/reports/…` or `$SP/work/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round3-screenshots/](docs/qa/round3-screenshots/).

# QA Regression Round 3 — Cross-cutting agent report

**Agent:** `xcut` (authorization matrix, cross-tenant isolation, WebSocket isolation, auth flows, public surface, robustness, e-mail honesty)
**Profile:** Playwright `xcut-agent` (+ `xcut-agent-mobile`) · inbox prefix `qa-r3-x-` · screenshots `x-*` · finding IDs `X-R3-NN`
**Tenants:** QA R3 School E1 `a89e1e5a-7893-48bd-a8a5-3f16e2387f51` (owner `qa-r3-school-e1@uberip.com`, built from empty into the full fixture set — §6). Foreign/attacker tenant: round-2 QA R2 School E2 `47010765-5c77-42e7-bd66-0de0e0b08606` (`qa-r2-school-e2@`, `qa-r2-x-e2-{staff,teacher,student}@uberip.com`) — read + short-lived probe rows only, all reverted (§6, §8).
**Accounts (16 tokens):** anon, `qa.hq.{owner,super_admin,support,tech_support,finance,analytics,operations}@qa-nounder40.test`, E1 owner/staff/teacher/student, E2 owner/staff/teacher/student.
**Environment:** https://dev.danzaclassicanounder40.com — `develop @ 6c0cef1` (CI run 34209392001).
**Time window (UTC):** 2026-09-08 09:53 → 10:25.
**Method:** every fixture created through the product's own API/UI flows (invites via e-mail, one self-registration, one password reset — ledger updated); 4,042-request authorization/isolation matrix (16 tokens × 298 endpoint variants, `crosscut-matrix-r3.json`, condensed `crosscut-matrix-r3-condensed.md`, anomalies `crosscut-matrix-r3-anomalies.json`); node `ws` WebSocket probe (51 handshakes + a live inbox/chat relay test); auth-flow suite; public-surface sweep; 190-case malformed-input sweep; e-mail honesty test with the HQ switch off for 59 s; Playwright pass on the public/auth pages in 5 locales + mobile. Every UI observation was cross-checked with a `qa.api` call on a `qa.whoAmI`-validated token. Raw API log: `$SP/work/xcut/apilog.jsonl`; scripts `$SP/work/xcut/*.js`; state/ids `$SP/work/xcut/state.json`.
**Budgets used:** 1 self-registration, 1 password reset, 5 login attempts (4 deliberate failures/variants + 1 real), 4 E2 logins (cached afterwards).

---

## 0. Executive summary

The four round-2 authorization fixes that were in my scope are **genuinely live and hold under attack**: a teacher can no longer see, answer or delete school↔student / HQ↔school threads (REST 404 + WebSocket rejected, forged `X-Panel-Role`/`?as=` grants nothing), the narrow HQ roles (`support`, `tech_support`, `finance`, `analytics`) are 403 (`hq_school_access_forbidden`) on **every** `/api/school/*` variant (owner/super_admin/operations keep cross-school access, `?school=<E1>` honoured for them and ignored for everyone else), a foreign location on `POST /school/rooms/` is refused, a compensation payment for a foreign teacher is refused, `staff` cannot delete a student, and `godmode` is refused as a sub-role. Cross-tenant isolation between schools stayed clean across all 4,042 combinations (zero E1 rows in any E2 response, every E2 token vs. E1 object → 401/403/404).

However the HQ-role fix stopped at the `/api/school/` and `/api/chat/` mounts: **any narrow HQ role can still read, download and delete every student's private document through `/api/documents/{id}/` (+ `/file/?token=`)** — during the matrix `qa.hq.support` really deleted my fixture document (204) — and can still subscribe to any school's calendar WebSocket. Separately, **Stripe Connect onboarding has no role gate** (`staff` without `payments` obtained the school's onboarding link) and creates orphan Stripe accounts under concurrency. The systemic-500 fix (R2-M1) closed the whole *query-parameter* class (every `?x` case now answers a clean 400) but not the *body* class: 45 request shapes still 500, four of them anonymous. Other regressions/gaps: `credit_cost` negative/zero still accepted on `PATCH /school/courses/{id}/` (PR #99 only covers the wizard paths), `School.timezone` (new in PR #88) is unvalidated, students can rewrite `Student.school`/`Student.email` through their own profile, invalid e-mail addresses are accepted by both invite endpoints, and `/school/teachers/resend/` still answers `sent:true` with the e-mail switch off (PR #106 missed it).

Counts: **Critical 0 · High 2 · Medium 7 · Low 8**. Round-2 fix verdicts in §3.

---

## 1. Coverage table

| Area | What ran | Tokens / roles | Locales | Viewport | Result |
|---|---|---|---|---|---|
| Authorization matrix | 298 endpoint variants × 16 tokens = 4,042 requests (92 combinations skipped on purpose: destructive calls with legitimately-allowed tokens) | anon, 7 HQ sub-roles, E1 owner/staff/teacher/student, E2 owner/staff/teacher/student | — | API | 0×5xx, 1 unexpected 204, 4 unexpected 201, 8 unexpected 200 (all in §2) |
| Round-2 attack re-runs | X-R2-01/02/03, R2-M6, R2-H8, R2-M3, X-R2-05/07/08/12/15, R2-M11/M15/M17, R2-L5 | as above | — | API/WS | see §3 |
| WebSocket isolation | 51 handshakes on `/ws/inbox/`, `/ws/chat/<4 threads>/`, `/ws/calendar/school/<E1>/`, `/ws/calendar/teacher/<T>/`, `/ws/nope/`, `/ws/chat/nope/` + forged `?as=` | 11 tokens | — | WS | 2 anomalies (§2 X-R3-09) |
| PR #105 realtime unread | student posts → 5 inbox sockets + 1 chat socket listening | owner, teacher, HQ owner, HQ support, E2 owner | — | WS | VERIFIED |
| Auth flows | login variants, XFF spoof, token tampering, refresh rotation/blacklist, logout, change-password (7 cases), Google, malformed `uid`/`token` (10 cases), password reset e2e, mass-assignment on `/auth/me/`, `/student/profile/`, `/teacher/profile/` | E1 staff/student/teacher | es (reset mail) | API | 3 findings |
| Public surface | headers on 7 URLs, CORS ×3, `/api/docs` + `/api/schema` ×5 tokens, 22 misc paths, media/private paths, iCal ×8, document `?token=` ×15 tokens, Host/TRACE/http→https | anon + all | — | HTTP | 1 finding (HSTS) |
| Robustness | 190 malformed-input cases (anon, owner, teacher, student, HQ owner) | 5 | — | API | 45×500, 1×502 leak |
| E-mail honesty (PR #106) | `enabled.team_invite` false for 59 s: team invite + resend, teacher invite + resend, HQ invitation create + approve, HQ school resend-invite; then ON again + resend | E1 owner, HQ owner | it | API + mail.tm | 1 call site still lies |
| UI (Playwright) | `/setup-account` (real invite link), `/login`, `/register`, `/reset-password?uid=x&token=y`, `/select-role`, `/forgot-password`, 404 page | anon | en/it/es/fr/de | 1366×900 + 390×844 | placeholders gone; 404 page not localized |
| UI throttle copy | route-mocked 429 on register + login | anon | it, es | desktop | localized, no raw JSON |

---

## 2. Findings

### HIGH

**X-R3-01 (High) — Narrow HQ roles can read, download and DELETE every student's private document via `/api/documents/…` (R2-H2 fix is incomplete outside `/api/school/`).**
- Where: `backend/students/document_views.py` — `DocumentDetailView._authorize()` (line ~42), `DocumentDetailView.delete()` (`is_school_side = is_hq(user) or …`), `DocumentFileView.get()` (`allowed = is_hq(user) or …`). All three use bare `core.viewsets.is_hq()`; the `/api/documents/` mount is outside `SchoolSectionGuardMiddleware`, and PR #89 wired `hq_school_godmode()` only into the middleware, `SchoolScopedModelViewSet.get_queryset()` and chat.
- Repro (fresh tokens, `qa.whoAmI` checked, all `role=hq`): `qa.hq.support` (HQRole permissions `[dashboard, inbox]`) → `GET /api/school/documents/?school=<E1>` **403** `hq_school_access_forbidden` (correct) but `GET /api/documents/b9198927-0948-4ba1-b6e8-b638784b044a/` → **200** (full metadata incl. `student_name`, `note`, `files[]`), `GET /api/documents/b9198927…/file/?path=documents/555600bf-e6e7-4ce9-9305-3f1f5653c9ec.pdf&token=<support jwt>` → **200 application/pdf** (23 bytes, the uploaded content). Same for `tech_support`, `finance`, `analytics` (`$SP/work/xcut/state.json → docs_probe`). During the matrix `DELETE /api/documents/373488a3-580f-4202-8461-fe5240268f6b/` with the `support` token → **204** — it destroyed the fixture document (the student's own later GET → 404); I re-created it (§6).
- Controls: E2 owner/staff/teacher/student and E1 teacher → 403 `Not your document.` on all three (cross-tenant OK); E1 owner/staff/student and HQ owner/operations → 200 (correct).
- Expected vs actual: per PR #89 a narrow HQ role must have no access to school-operational data; actual: full read/download/delete of medical certificates etc. for every school on the platform.
- Impact: cross-tenant PII leak (medical documents) + destructive action for the lowest-trust HQ roles. Same root-cause family (bare `is_hq`) also opens the calendar WebSocket channels (X-R3-09) and `POST /chat/conversations/` (X-R3-10).
- Evidence: matrix rows `GET/DELETE /documents/{D}/…` (bold in the table below), `docs_probe` in `state.json`, apilog lines `del-doc…`, screenshot n/a (API).
- vs R2: **PARTIAL fix of R2-H2 / X-R2-03** (the `/api/school/*` and chat halves are verified fixed).

**X-R3-02 (High) — Stripe Connect onboarding has no role gate and is not idempotent: a `staff` member (no `payments` permission) obtains the school's payout-account onboarding link, and concurrent calls create orphan Stripe Express accounts.**
- Where: `backend/commerce/stripe_views.py::OnboardView.post` (only `IsAuthenticated` + `active_school_id`), `backend/commerce/stripe_service.py::start_connect_onboarding` (lines 140-162: `if not school.stripe_account_id: stripe.Account.create(...)` then save — no lock/`select_for_update`).
- Repro: `POST /api/stripe/onboard/ {}` with `qa-r3-x-e1-staff@uberip.com` (`school_sub_role=staff`, whose `GET /school/transactions/` is 403 `section_forbidden: payments`) → **200** `{"url":"https://connect.stripe.com/setup/e/acct_1UDLrUKf9raZcz79/…"}`. E2 staff → 200 as well. Teachers/students/HQ → 400 `no_active_school` only because their `active_school_id` is null — any account with that column set would pass.
- Concurrency: the matrix issued the owner and staff calls within the same second; E1 owner received `acct_1UDLrUKgzt1eSuqR`, E1 staff `acct_1UDLrUKf9raZcz79`; `GET /stripe/onboard/status/` afterwards → `account_id: acct_1UDLrUKgzt1eSuqR` (staff's account orphaned in Stripe). On E2 the opposite: owner got `acct_1UDLrUQSvEQwnXZ4`, staff `acct_1UDLrU32g4gu3d0t`, status keeps **the staff one**. Two orphan Stripe test accounts were created by two requests.
- Expected vs actual: only owner/admin (or the `payments` section) should start onboarding; one account per school. Actual: staff can open the KYC/bank-details flow for the school's payouts; a race leaves orphan accounts (and on E2 the school is now bound to the account created by the staff call).
- Impact: money path — whoever completes the onboarding link supplies the bank account that receives the school's share. Requires a staff login, hence High not Critical.
- Evidence: matrix rows `POST /stripe/onboard/` (bold), apilog `onboard-status-e1/e2`. Side effect on E2 disclosed in §8.
- vs R2: NEW.

### MEDIUM

**X-R3-03 (Medium) — Negative / zero course `credit_cost` still accepted on `PATCH /api/school/courses/{id}/` (R2-H9 fix covers only the wizard paths).**
- Where: `backend/catalog/serializers.py::CourseSerializer` (`fields="__all__"`, no `validate_credit_cost`); PR #99 added `_credit_cost_decimal()` only to `catalog/course_views.py` (`courses-create`, `classes`).
- Repro: E1 owner `PATCH /school/courses/4603cde5-0888-4675-af73-bdddb0e0bd7f/ {"credit_cost": -1}` → **200**, `GET` → `credit_cost: -1`; `{"credit_cost": 0}` → 200 stored `0`; `-0.5` → 200 stored `-0.5`; `1.25` → 400 ("no more than 1 decimal places" — the silent 1.25→1.3 rounding of R2 is gone); `"abc"` → 400. Restored to 1.
- Impact: same as R2-H9 (a booking on a negative-cost lesson adds credits) — reachable through the plain viewset the school panel uses for course edits. Not re-booked live to avoid corrupting the wallet.
- vs R2: **PARTIAL fix of R2-H9 / SCH-R2-05** (create path fixed, update path not).

**X-R3-04 (Medium) — Student self-profile mass-assignment: `PATCH /api/student/profile/` lets a student set `school` to any school (no enrolment, no `active` check) and rewrite `Student.email`.**
- Where: `backend/students/serializers.py::StudentSelfSerializer` (only `ical_token` read-only; `school`, `email`, `user` writable), `students/views.py::StudentProfileView.patch`.
- Repro: E1 student `PATCH /student/profile/ {"school": "<E2>", "email": "qa-r3-x-hijack2@uberip.com", "ical_token": "0000…", "user": "<hq owner user id>"}` → **200** with `school: 47010765-… (E2)`, `email: qa-r3-x-hijack2@uberip.com` (`ical_token` and `user` correctly ignored). `POST /student/school/` — the intended path — checks `active=True` and creates the `SchoolStudent` link; the profile PATCH bypasses both. Restored (`school`=E1, `email`=original).
- Impact: `Student.school` desync (home school with no enrolment link → dashboards/e-mails keyed on the wrong school), `Student.email` ≠ `User.email` so booking/purchase/no-show e-mails (which follow the Student record, R2-M13) go to an arbitrary third-party address. `/auth/me/` correctly refuses `role`/`roles`/`email`/`active_school`/`hq_sub_role` (verified) — the gap is only on the student profile.
- vs R2: NEW.

**X-R3-05 (Medium) — `School.timezone` (new in PR #88) is not validated; an invalid zone is stored and silently falls back to UTC, re-introducing the R2-H14 policy drift for that school.**
- Where: `backend/schools/serializers.py::SchoolSerializer` (no `validate_timezone`), `bookings/services.py:47-50` (`except ZoneInfoNotFoundError: tz = ZoneInfo("UTC")`), `frontend/src/lib/school-time.ts:51-52` (same fallback).
- Repro: E1 owner `PATCH /school/profile/ {"timezone": "Mars/Olympus"}` → **200**, stored (`GET` → `Mars/Olympus`); with it in place `POST /bookings/` on lesson 2 → 201 and `DELETE` → 200 refund (no 500 — the fallback hides the error, with policy hours computed in UTC). Restored to `Europe/Rome`. `staff` → 403 on the field (settings-gated, correct).
- Impact: a typo in Settings silently shifts every cancellation/min-notice decision of the school by the UTC offset — exactly the R2-H14 bug, now per-school and invisible. Fix: validate against `zoneinfo.available_timezones()`.
- vs R2: NEW (introduced by PR #88).

**X-R3-06 (Medium) — R2-M1 still open for request *bodies*: 45 malformed-body shapes → HTTP 500, four of them on anonymous endpoints; `/stripe/onboard/` leaks a Python error text.**
- The query-parameter class is fixed everywhere I could reach (every `?school_id=x`, `?type=x`, `?month=2026-13`, `?from=x`, `?student=x`, `?date=…` → clean 400 via `core/params.py`; public iCal too). `complete-invite`/`password-reset-confirm` with malformed `uid` → 400 `invalid_link` (5 shapes each). `POST /hq/team/` → 405, auto-translate → 503, homepage non-integer → 200 ignored. Attendance with a JSON-string body → 400 `lesson_not_yet_occurred` (guard runs first; the body path itself untested because the fixture lessons are in the future).
- Still **500** (all `Server Error (500)` HTML, no traceback): anonymous — `POST /auth/password-reset-confirm/` body `"just a string"`, `POST /auth/complete-invite/` body `[1,2]`, `POST /auth/logout/` body `"string"`, `POST /auth/google/` body `"str"`; authenticated — JSON-string body on `/school/profile/` (PATCH), `/school/team/`, `/school/teachers/`, `/school/classes/`, `/school/classes/{id}/` (PATCH), `/school/courses-create/`, `/school/quick-replies/`, `/hq/schools/`, `/hq/invitations/`, `/hq/email-settings/` (also `[1]`), `/hq/email-templates/`, `/hq/library/`, `/bookings/`, `/bookings/multiple/`, `/student/school/`, `/student/documents/`, `/student/discount-code/check/`, `/student/shop/checkout/`, `/stripe/checkout/`, `/stripe/refund/`, `/chat/conversations/{id}/messages/`; and typed-but-invalid values — `POST /bookings/ {"lesson_id":"x"}`, `POST /student/school/ {"school_id":"x"}`, `DELETE /school/teachers/ {"teacher_id":"x"}`, `DELETE /school/team/ {"id":"x"}`, `POST /stripe/refund/ {"transaction_id":"x"}`, `POST /school/courses-reorder/ {"ids":["x"]}`, `POST /school/credits/grant/ {"amount":"NaN"}` (`Decimal('NaN')` passes the range checks), `courses-create` with `lesson_type_id:"x"` / `start_time:"25:99"` / `duration_minutes:"abc"` / `schedules:"x"` / `room_id:"x"`, `PATCH /school/classes/{id}/` with `date:"x"` / `start_time:"99:99"` / `teacher_id:"x"`, `POST /student/shop/checkout/` with `items:"x"` or `qty:"abc"`. `POST /stripe/onboard/` body `"str"` → **502** `{"error":"stripe_error","detail":"'str' object has no attribute 'get'"}` (Python error text leaked).
- Counter-examples showing the pattern already exists: `core.params.ensure_object_body` gives `{"body":["Expected a JSON object."]}` on `/school/credits/grant/`, `/hq/homepage-settings/`, `compensation-plans/{id}/simulate/`; DRF serializers give `{"non_field_errors":["Invalid data. Expected a dictionary, but got str."]}` on `/hq/packages/`.
- Full list with statuses: `state.json → robust` (190 rows).
- vs R2: **PARTIAL fix of R2-M1 / X-R2-04**.

**X-R3-07 (Medium) — Team and teacher invites accept a syntactically invalid e-mail, create the account and report `email_sent: true`.**
- Where: `schools/views.py::SchoolTeamView.post` (line ~621: `email = (request.data.get("email") or "").strip().lower()`, no `EmailValidator`), `teachers/views.py::SchoolTeacherListView.post` (line ~475).
- Repro: E1 owner `POST /school/team/ {"email":"not-an-email","name":"x"}` → **201** `{"id":"39","existing":false,"email_sent":true}` (pending member listed with `email: "not-an-email"`); `POST /school/teachers/ {"email":"not-an-email","name":"x"}` → **201** `email_sent: true` — reused the same User row and added the `teacher` role + a Teacher row; both invite e-mails were queued to an unroutable address.
- Impact: unreachable accounts, ghost roster rows, Celery/SMTP bounces; a User `not-an-email` with roles `[school, teacher]` now exists in the dev DB (membership deleted and teacher link removed by me; the User/Teacher rows cannot be removed through the product — §6).
- vs R2: NEW.

**X-R3-08 (Medium) — `POST /api/school/teachers/resend/` still answers `{"sent": true}` while the `team_invite` template is switched off (PR #106 missed this call site).**
- Where: `teachers/views.py::SchoolTeacherResendInviteView.post` lines 604-605 — `_send_teacher_invite_email(...)` return value discarded, `return Response({"sent": True})`.
- Repro (switch off 10:13:02 → restored 10:14:01 UTC; captured original `true`): `POST /school/team/` → 201 `email_sent:false` ✓; `POST /school/team/resend/` → `sent:false` ✓; `POST /school/teachers/` → 201 `email_sent:false` ✓; **`POST /school/teachers/resend/` → 200 `sent:true` ✗**; `POST /hq/invitations/` + `…/approve/` → 201 `email_sent:false` ✓; `POST /hq/schools/<E1>/resend-invite/` → `{"success":true,"email_sent":false}` ✓. No mail reached any of the three inboxes while off (25 s wait); with the switch back on, both resends → `sent:true` and the mails arrived in 1.7 s (`x-setup-account-*` screenshots were taken from that staff link).
- vs R2: **PARTIAL fix of R2-H15**.

**X-R3-09 (Medium) — WebSocket calendar channels accept narrow HQ roles (same `is_hq` family as X-R3-01); every pre-accept rejection is an HTTP 403, so the 4401/4403/4404 codes of PR #113 are not observable.**
- Where: `backend/catalog/consumers.py::SchoolCalendarConsumer._can_access` / `TeacherCalendarConsumer._can_access` (`if is_hq(user): return True`).
- Repro: `wss://…/ws/calendar/school/<E1>/?token=<qa.hq.support>` → **OPEN**; `…?token=<qa.hq.finance>` → **OPEN**; `/ws/calendar/teacher/<T>/?token=<support>` → **OPEN**, while the same tokens are 403 on `GET /school/lessons/?school=<E1>`. Payload is `catalog/realtime._lesson_payload` (lesson id/date/time/teacher/room changes) — schedule data, not PII, hence Medium. Everything else in the WS matrix is correct: no token / garbage token → rejected; E2 tokens on every E1 channel → rejected; E1 teacher on the school calendar, on the school↔student and on the HQ↔school thread → rejected (also with forged `&as=school` / `&as=hq`); E1 student on the school↔teacher thread → rejected; `/ws/nope/` and `/ws/chat/nope/` → rejected, **no 500** (X-R2-15 fixed).
- Observation: the `ws` client sees `HTTP 403` for every `close()`-before-`accept()` (daphne turns them into a 403 handshake), so 4401/4403/4404 cannot be distinguished by a client — informational.
- vs R2: NEW (X-R2-15 VERIFIED FIXED; X-R2-03 family PARTIAL).

### LOW

**X-R3-10 (Low) — `POST /api/chat/conversations/` has no HQ permission check and no participant check for students.** Narrow HQ roles (even `finance`/`analytics`, which have no `inbox` permission and see 0 threads) create threads: `qa.hq.support` `POST {}` → **201** `type: school_student, hq: <user>, school: null` — an orphan thread invisible to everybody but god-mode HQ (6 such orphans were created by the matrix and deleted with the HQ owner). An E1 student `POST {"type":"school_student","school":"<E2>"}` → **201** although she is not enrolled at E2 (deleted). Teacher-side creation is correctly gated (`school_student`/`hq_school` as teacher → 403 `Cannot start this conversation type.`). Root: `chat/views.py::perform_create` `if role == "hq" and is_hq(user): serializer.save(hq=user)` and the student branch trusts `validated_data["school"]`.

**X-R3-11 (Low) — Password "similarity" is equality only (documented design): `Qa-r3-x-e1-staff1` accepted as the new password of `qa-r3-x-e1-staff@uberip.com`** (change-password 200; reset-confirm 200 for the student equivalent), while `qa-r3-x-e1-staff` / `QAR3XE1staff` → 400 `password_too_similar`. `accounts/validators.py` explains the choice (avoid rejecting "Alina1812"); reported so the product owner can confirm the residual weakness (local part + 1 character) is acceptable. vs R2-M17: PARTIAL (by design).

**X-R3-12 (Low) — HSTS on dev still lacks `includeSubDomains`** (`strict-transport-security: max-age=63072000` on `/`, `/en`, `/api/*`). `nginx/edge.conf` lines 33/49 now carry `includeSubDomains` (PR #113) but the host-level edge nginx is not part of the CI deploy (`.github/workflows/ci.yml` only ships `nginx-app.conf`), so the change is not live. vs R2-L5: NOT FIXED LIVE (config-only).

**X-R3-13 (Low) — 404 page is not localized:** `/en|es|fr|de/<missing>` all render `<html lang="it">` with the bilingual "Pagina non trovata · Page not found" (screenshots `x-404-{en,it,es,fr,de}.png`, `x-404-it-mobile.png`). Also `/forgot-password` is not a route (404) — the reset request lives in `/login` (`mode: 'forgot'`); fine, just noting for future crawls.

**X-R3-14 (Low) — Empty-body creates:** `POST /school/courses/ {}` → 201 (course with no lesson type/name/time; also for `staff`), `POST /school/subscriptions/ {}` → 201. `POST /school/rooms/ {}` / `closures {}` / `packages {}` correctly 400. Orphan rows were deleted.

**X-R3-15 (Low) — Login e-mail is case-sensitive:** `QA-R3-X-E1-STAFF@uberip.com` + correct password → 401, while register/invite lowercase the address and password-reset uses `iexact`. A user who capitalises her address on the login form (the form does not lowercase) cannot log in. (R2 recorded the same 401 as "uniform".)

**X-R3-16 (Low) — Minor validation:** `compensation-plans/{id}/simulate/` accepts `students: -1` (200) and `1e12` (fee `2000000000010`); chat message `content: 123, attachment_url: ["x"]` → 201; `/bookings/multiple/ {"lesson_ids":"x"}` → 200 `{"results":[]}`; `POST /hq/homepage-settings/ {"stat_students":"abc"}` → 200 `success:true` but silently ignored (value unchanged) — better than the R2 500, but the client is told it succeeded.

**X-R3-17 (Low, informational) — `qa.hq.super_admin` was deactivated by another agent's test during my matrix run** (every `hq_super` cell = 401 `user_inactive`, 276 rows; still inactive at 10:24 UTC). The `hq_owner` column covers the owner-equivalent behaviour; the super_admin column should be re-run when the account is restored (`MATRIX_TOKENS=hq_super MATRIX_SUFFIX=-super node ../work/xcut/10_matrix_param.js`).

### Condensed matrix (key rows; full table `$SP/reports/crosscut-matrix-r3-condensed.md`, 298 rows)

`·` = not run (would destroy a fixture with a legitimately-allowed token). **Bold** = anomaly (automated rules + manual review). `hq_super` column = account inactive (X-R3-17). ids: E1 `a89e1e5a…`, C course `4603cde5…`, L lesson `8abbc6ae…`, D document `373488a3…` (v1, deleted by the `support` probe), cs/ct/ch/cts = school↔student / school↔teacher / HQ↔school / teacher-support threads.

| method · endpoint | anon | hq_owner | hq_super | hq_support | hq_tech | hq_finance | hq_analytics | hq_ops | e1_owner | e1_staff | e1_teacher | e1_student | e2_owner | e2_staff | e2_teacher | e2_student |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET /auth/me/ | 401 | 200 | **401** | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| GET /hq/team/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| POST /hq/packages/ | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /hq/brand-settings/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /hq/email-settings/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| PATCH /hq/schools/{E1}/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /school/students/ | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 200 | 200 | 403 | 403 | 200(own) | 200(own) | 403 | 403 |
| GET /school/students/?school=E1 | · | 200 | **401** | 403 | 403 | 403 | 403 | 200 | · | · | · | · | · | · | · | · |
| GET /school/courses/{C}/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 200 | 200 | 403 | 403 | 404 | 404 | 403 | 403 |
| PATCH /school/courses/{C}/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 200 | 200 | 403 | 403 | 404 | 404 | 403 | 403 |
| DELETE /school/courses/{C}/ | 401 | · | · | 403 | 403 | 403 | 403 | · | · | · | 403 | 403 | 404 | 404 | 403 | 403 |
| POST /school/rooms/ (location=E1) | 401 | 201 | **401** | 403 | 403 | 403 | 403 | 201 | 201 | 403 | 403 | 403 | 400 | 403 | 403 | 403 |
| DELETE /school/closures/{closure}/ | 401 | · | · | 403 | 403 | 403 | 403 | · | · | · | 403 | 403 | 404 | 403 | 403 | 403 |
| POST /school/compensation-summary/ (E1 teacher) | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 201 | 403 | 403 | 403 | 404 | 403 | 403 | 403 |
| DELETE /school/students/delete/ | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 404 | 403 | 403 | 403 | 404 | 403 | 403 | 403 |
| PATCH /school/profile/ {} | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 200 | 200 | 403 | 403 | 200(own) | 200(own) | 403 | 403 |
| GET /school/transactions/ | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 200 | 403 | 403 | 403 | 200(own) | 403 | 403 | 403 |
| GET /school/team/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 200 | 403 | 403 | 403 | 200(own) | 403 | 403 | 403 |
| GET /school/documents/ | 401 | 400 | **401** | 403 | 403 | 403 | 403 | 400 | 200 | 200 | 403 | 403 | 200(own) | 200(own) | 403 | 403 |
| PATCH /school/documents/{D}/ | 401 | 200 | **401** | 403 | 403 | 403 | 403 | 200 | 200 | 200 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /teacher/profile/ | 401 | 403 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 403 | 200 | 200 |
| POST /teacher/attendance/{L}/ | 401 | 403 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 400 | 403 | 403 | 403 | 404 | 404 |
| GET /student/profile/ | 401 | 403 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 200 | 403 | 403 | 403 | 200 |
| POST /bookings/ {E1 lesson} | 401 | 403 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | · | 403 | 403 | 403 | 400 no_valid_access |
| DELETE /bookings/{B}/ | 401 | 403 | **401** | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | · | 403 | 403 | 403 | 404 |
| GET /documents/{D}/ | 401 | 200 | **401** | **200** | **200** | **200** | **200** | 200 | 200 | 200 | 403 | 200 | 403 | 403 | 403 | 403 |
| GET /documents/{D}/file/?token= | 401 | 200 | **401** | **200** | **200** | **200** | **200** | 200 | 200 | 200 | 403 | 200 | 403 | 403 | 403 | 403 |
| DELETE /documents/{D}/ | 401 | · | · | **204** | 404 | 404 | 404 | · | · | · | 404 | 404 | 404 | 404 | 404 | 404 |
| GET /chat/conversations/ | 401 | 200 | **401** | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| POST /chat/conversations/ {} | 401 | 201 | **401** | **201** | **201** | **201** | **201** | 201 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| GET /chat/conversations/{cs}/ | 401 | 200 | **401** | 404 | 404 | 404 | 404 | 200 | 200 | 200 | 404 | 200 | 404 | 404 | 404 | 404 |
| GET /chat/conversations/{cs}/messages/ | 401 | 200 | **401** | 404 | 404 | 404 | 404 | 200 | 200 | 200 | 404 | 200 | 404 | 404 | 404 | 404 |
| POST /chat/conversations/{cs}/messages/ | 401 | 201 | **401** | 404 | 404 | 404 | 404 | 201 | 201 | 201 | 404 | 201 | 404 | 404 | 404 | 404 |
| DELETE /chat/conversations/{cs}/ | 401 | · | · | 404 | 404 | 404 | 404 | · | · | · | 404 | · | 404 | 404 | 404 | 404 |
| GET /chat/conversations/{ch}/ | 401 | 200 | **401** | 200 | 200 | 404 | 404 | 200 | 200 | 200 | 404 | 404 | 404 | 404 | 404 | 404 |
| GET /chat/conversations/{ct}/ | 401 | 200 | **401** | 404 | 404 | 404 | 404 | 200 | 200 | 200 | 200 | 404 | 404 | 404 | 404 | 404 |
| GET /chat/conversations/{cts}/ | 401 | 200 | **401** | 200 | 200 | 404 | 404 | 200 | 404 | 404 | 200 | 404 | 404 | 404 | 404 | 404 |
| POST /stripe/onboard/ | 401 | 400 | **401** | 400 | 400 | 400 | 400 | 400 | 200 | **200** | 400 | 400 | 200 | **200** | 400 | 400 |
| GET /stripe/verify-session/?session_id=x | 401 | 404 | **401** | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| GET /calendar/{E1}.ics | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| GET /api/docs/ | 401 | 200 | **401** | 200 | 200 | 200 | 200 | 200 | 403 | 403 | 403 | 403 | 403 | 403 | 403 | 403 |

Status distribution of the 4,042 executed combinations: 200×933 · 201×39 · 204×1 · 400×271 · 401×488 · 403×1945 · 404×342 · 405×23 · **5xx×0**. `?school=<E1>` appended by HQ narrow roles → still 403; by owner/super_admin/operations → E1 rows; by E2 owner/staff → their own rows (verified on 15 scoped endpoints, never an E1 id).

---

## 3. Round-2 fix re-verification

| R2 item | Fix PR | Verdict | Evidence |
|---|---|---|---|
| R2-C2 / X-R2-01 teacher reads/deletes school↔student + HQ↔school threads | #89, #105 | **VERIFIED FIXED LIVE** | E1 teacher: `GET/POST/PATCH/DELETE /chat/conversations/{cs}/…` → 404, `{ch}` → 404, list shows only her `school_teacher` + `teacher_support` threads; WS `/ws/chat/{cs}/` rejected, also with `&as=school`/`&as=hq`; `X-Panel-Role: school|hq` header → same teacher scope; `POST` of `school_student`/`hq_school` as teacher → 403 |
| R2-H2 / X-R2-03 HQ matrix not enforced on `/api/school/*` | #89 | **PARTIAL** — `/api/school/*` and chat VERIFIED; `/api/documents/*`, WS calendar, chat create NOT covered | 4 narrow roles × every `/school/*` variant (incl. `?school=E1`) → 403 `hq_school_access_forbidden`; `DELETE /school/closures/{E1}` → 403 (was 204); chat: `support`/`tech_support` see only `hq_school`+`teacher_support`, `finance`/`analytics` see nothing; owner/operations keep access. Gaps: X-R3-01, X-R3-09, X-R3-10 |
| R2-H3 / X-R2-02 room under a foreign location | #89 | **VERIFIED FIXED LIVE** | E2 owner `POST /school/rooms/ {location:<E1 loc>}` → 400 `Location does not belong to your school.`; E1 room list unchanged |
| R2-H8 staff deletes a student | #89 | **VERIFIED FIXED LIVE** | E1/E2 staff `DELETE /school/students/delete/?student_user_id=…` → 403 `forbidden`; owner → 404 for a random id (guard order correct) |
| R2-M6 / X-R2-06 compensation payment for a foreign teacher | #89 | **VERIFIED FIXED LIVE** | E2 owner `POST /school/compensation-summary/ {teacher_id:<E1 T>}` → 404 `teacher_not_at_school`; E2 payment list has no E1 row |
| R2-M3 `godmode` sub-role / fail-open guard | #86 | **VERIFIED FIXED LIVE** | `POST /school/team/ {school_sub_role:"godmode"}` → 400 `invalid_school_sub_role` |
| R2-C1 / R2-H1 HQ takeover via `PATCH /hq/team/` / invite-approve | #86 | not re-run (HQ agent scope); narrow roles → 403 on `/hq/team/`, `/hq/permissions/`, `PATCH /hq/schools/` confirmed | matrix rows |
| R2-M1 / X-R2-04 systemic 500s | #9x (core/params) | **PARTIAL** — query-param class + anonymous `uid` class FIXED, body class NOT | §2 X-R3-06 (45 remaining, 4 anonymous) |
| X-R2-05 HQ settings GET readable by everyone | — | **VERIFIED FIXED LIVE** | `/hq/brand-settings/`, `/hq/homepage-settings/`, `/hq/homepage-real-stats/`, `/hq/student-*-visibility/` → 403 for every school/teacher/student token (only `/hq/lesson-types/` is shared by design) |
| X-R2-07 auto-translate 500 | — | **VERIFIED FIXED LIVE** | → 503 `ANTHROPIC_API_KEY not configured` (school, HQ templates, translations auto-fill) |
| X-R2-08 / R2-L5d verify-session leaks Stripe request id | — | **VERIFIED FIXED LIVE** | `?session_id=x` → 404 `{"error":"stripe_session_not_found","reference":"…"}` (no Stripe id) |
| X-R2-12 / R2-L5a `/api/docs/` + `/api/schema/` public | — | **VERIFIED FIXED LIVE** | anon 401, school/teacher/student 403, HQ (any sub-role) 200 |
| X-R2-11 `x-powered-by` | #113 | **VERIFIED FIXED LIVE** | header absent on `/`, `/en`, `/it/login` |
| X-R2-13 CSP `frame-src` / `frame-ancestors` | #113 | **VERIFIED FIXED LIVE** | `media-src 'self' https:; frame-src 'self' https:; frame-ancestors 'none'` present |
| X-R2-15 `/ws/nope/` → 500 | #113 | **VERIFIED FIXED LIVE** | `/ws/nope/`, `/ws/chat/nope/` → clean 403 handshake (4404 not observable, §2 X-R3-09) |
| HSTS `includeSubDomains` | #113 | **NOT FIXED LIVE** | still `max-age=63072000` only (edge nginx not redeployed) — X-R3-12 |
| favicon / robots (R2 public-surface) | #111 | **VERIFIED FIXED LIVE** | `/favicon.ico` 200 image/x-icon, `/robots.txt` 200 text/plain |
| R2-H15 invite endpoints lie about e-mail | #106 | **PARTIAL** | 5 of 6 call sites honest; `/school/teachers/resend/` still `sent:true` — X-R3-08 |
| R2-M11 / X-R2-09 placeholder copy on `/setup-account` | — | **VERIFIED FIXED LIVE** | it "Bastano pochi dettagli e sei pronta a iniziare.", es "Solo unos pocos datos y estarás lista para empezar.", fr "Encore quelques informations et vous serez prête à commencer.", de "Nur noch ein paar Angaben und du kannst loslegen." (screenshots `x-setup-account-*`); static: `hq.permissions.role*Desc` and `hq.packages.placeholderDescription` translated in it/es/fr/de |
| R2-M15 429 body shown raw / not localized | — | **VERIFIED FIXED LIVE (UI)** | mocked 429 on register: it "Troppi tentativi da questa connessione. Attendi qualche minuto e riprova.", es "Demasiados intentos desde esta conexión…"; login: it "Troppi tentativi. Aspetta un minuto e riprova.", es "Demasiados intentos…"; no raw JSON. Limits unchanged (register/reset 5/h per IP, login 10/min per IP) |
| R2-M17 no password-similarity validator | — | **PARTIAL (by design)** | equal-to-e-mail/local-part → 400 `password_too_similar` on change-password and reset-confirm; near-identical accepted — X-R3-11 |
| R2-M9 validation gaps (school) | — | **VERIFIED FIXED LIVE** (the ones I re-sent) | `validity_days 0`, `weekly_booking_cap -1`, room `cost -10`/`capacity -1`, closure end<start, partial closure without time, plan `base_fee -5`, `bonus_max_threshold` < threshold, `cancellation_policy_hours -5`, `language xx`, discount `value -10/200` → all 400 with specific messages; `max_uses` not checked (type/value fail first) |
| X-R2-16 `ical_token` unreachable | — | **CHANGED** | `GET /student/profile/` now returns `ical_token`; `/api/calendar/student/<token>.ics` → 200 with the student's booking (1 VEVENT); wrong token → 404 |
| PR #105 realtime unread badge | #105 | **VERIFIED LIVE** | student posts in school↔student thread → E1 owner `/ws/inbox/` receives `{"type":"inbox_event","reason":"new_message","conversation":"a195aa3c…","conversation_type":"school_student","sender":"<student user>"}` within 4 s; E1 teacher, HQ owner, HQ support and E2 owner inbox sockets receive nothing; `/ws/chat/{cs}/` relays `{"type":"message", content:"QA R3 X realtime probe msg"}` |

---

## 4. E-mails verified (mail.tm, all from `support@alinaquintana.com`)

| trigger | inbox | subject | locale | delivery | links |
|---|---|---|---|---|---|
| school team invite (staff, `locale:it`) | qa-r3-x-e1-staff | "✉️ Invito da QA R3 School E1 — Staff" | it ✓ | 1.4 s | `/it/setup-account?uid&token` ✓ completed via `complete-invite` (200, roles `[school]`, sub-role staff); reuse → 400 |
| teacher invite | qa-r3-x-e1-teacher | "✉️ Invito da QA R3 School E1 — insegnante" | it ✓ | 1.4 s | ✓ completed (200, roles `[teacher]`); reuse → 400 |
| student welcome (register, `language_preference:it`) | qa-r3-x-e1-student | "🩰 Benvenuta in Danza Classica No Under 40!" | it ✓ | 1.6 s | profile link `/it/student/profile?for=…` ✓ |
| password reset (request with UPPERCASE address + `locale:es`) | qa-r3-x-e1-student | "🔑 Restablece tu contraseña" | es ✓ (UI locale wins) | 2.0 s | `/es/reset-password?uid&token` ✓; token single-use ✓ (after the first successful confirm every further attempt → 400 `invalid_or_expired_token`); a password equal to the local part → 400 `password_too_similar` without consuming the token ✓ |
| team invite resend / teacher invite resend (switch ON) | qa-r3-x-e1-staff-off / qa-r3-x-e1-teacher-off | same subjects as above | it ✓ | 1.7 s | setup links valid (used only to render the page, never completed) |
| team/teacher/HQ invites with `enabled.team_invite=false` | 3 inboxes | — | — | none in 25 s ✓ | APIs: honest except `/school/teachers/resend/` (X-R3-08) |

Note: tokens issued by `register`, `complete-invite` and `password-reset-confirm` carry no `role`/`roles` claims (only login does — `TokenPairSerializer.get_token`); harmless today (the frontend reads `/auth/me/`), noted for anyone decoding the JWT client-side.

---

## 5. Verified good

- **Cross-tenant isolation**: 4,042 combinations, zero E1 identifiers in any E2 response, every E2 token vs. E1 object → 401/403/404; `?school=<E1>` ignored for non-HQ; E2 staff/teacher/student get `not_a_school_member`/`section_forbidden` exactly per matrix; E2 student booking an E1 lesson → 400 `no_valid_access` (no orphan link).
- **Section guard (school)**: `staff` 403 on `team`, `transactions`, `reports`, `packages` writes, `compensation`, `settings`/identity fields of `/school/profile/` (`cancellation_policy_hours`, `name`, `platform_fee_percentage` → 403 `forbidden` with the field list); support reads (`closures`, `attendance-statuses`, `teachers`…) allowed as designed; `GET /school/memberships/` reachable without membership (by design, empty).
- **HQ guard**: `support`/`tech_support`/`finance`/`analytics` 403 on `/hq/team/`, `/hq/permissions/`, `/hq/packages/` POST, `/hq/email-settings/`, `PATCH /hq/schools/`, `section_forbidden: schools_create_edit`; `operations` keeps school access (`schools_create_edit`); `POST /hq/team/` → 405 "Use the invitation flow".
- **Chat**: visibility matrix exactly as documented for all 16 tokens × 4 thread types; forged `X-Panel-Role`/`?as=` never widens scope (`e1_staff as hq` → school scope, `e2_student as hq` → student scope, `hq_support as school` → HQ inbox scope); message delete rules; `unread/` consistent.
- **Private documents**: anonymous 401; wrong `?token=` 401; foreign school/teacher 403; path not on the document 404; `../.env` 404; `/media/private/…`, `/media/documents/…`, `/internal-media/…` → 404; `/media/public/<missing>` 404.
- **Auth**: wrong password / unknown e-mail → uniform 401; missing field 400; garbage/tampered/refresh-as-access → 401 `token_not_valid` with distinct messages; refresh rotates both tokens, old refresh → 401 blacklisted, access-as-refresh → wrong type; logout 205 + blacklist, idempotent for anon/garbage; change-password wrong-current/short/common/numeric/missing → 400 with reasons, success changes take effect immediately; Google → 400 without token, 503 not configured; `complete-invite`/`password-reset-confirm` malformed `uid` (5 shapes) and bad token → 400; `/auth/me/` PATCH ignores `role`/`roles`/`email`/`active_school`/`hq_sub_role`/`is_staff`; `/teacher/profile/` PATCH ignores `id`/`user`.
- **Throttles**: `X-Forwarded-For`/`X-Real-IP` spoofing has no effect — `nginx/nounder40-proxy.conf` overwrites `X-Real-IP $remote_addr` and appends to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), `nginx-app.conf` forwards those and rate-limits `/api/auth/(login|register|google|password-reset|password-reset-confirm|complete-invite)/` at 10 r/m + burst 20 (429), DRF `NUM_PROXIES=1` reads the appended real IP. Invalid register payloads **do** count toward the 5/h budget: `APIView.initial()` runs `check_throttles()` before the handler and `SimpleRateThrottle.allow_request()` records the hit unconditionally — established from code, not burned live.
- **Public surface**: CSP (`default-src 'self'`, `media-src`, `frame-src`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` (frontend `strict-origin-when-cross-origin`, API `same-origin`), no `x-powered-by`; CORS: foreign `Origin` gets no `Access-Control-Allow-Origin`, same-origin gets ACAO + credentials; `Host: evil.example` → served (nginx default server, no redirect leak), `http://` → 301 https, TRACE → 405, 9 KB query string → 414; `/.env`, `/.git/config`, `/backend/config/settings.py` → 404; `/admin/` → 302 `/admin/login/` (200, not used); `/login` → 307 `/en/login`, `Accept-Language: it` → `/it`, `/tr/login` → 404; `/api/nope/` 404, `/ws/` 400; `manifest.json` 200, `sw.js` 404 (documented gap).
- **iCal**: school feed public (2 events, teacher filter works), `?type|teacher|location=x` → 400, unknown school → 404; student feed by token 200/404.
- **Public JSON**: `/schools/public/` exposes only id/name/slug/city/province/country/logo/website; `/platform-stats/` marketing counters + brand; `/lessons/public/upcoming/`; `/schools/<E1>/document-types/`.
- **R2-M9 validation** (see §3) and `credit grant` guards (`amount 0`, `abc`, `1e30`, non-half-step → 400).
- **UI**: `/setup-account`, `/login`, `/register`, `/reset-password`, `/select-role` render in all 5 locales with no raw i18n keys, `{var}` leftovers, `undefined`/`NaN`, no console errors (except the expected 404 resource on the 404 page); mobile 390×844: 0 px horizontal overflow on setup-account, login, register, 404; wrong-password login copy in de: "E-Mail oder Passwort falsch…".

---

## 6. Test data created / changed

**E1 fixtures (`QA R3 X …`, left in place):** location `4403ef3e-1111-4a12-8332-bc450c5e89db`, room `33187f0a-7022-4cdf-bf75-a73c9b088b2f`, document type `427ab539-fdab-4994-b144-63a5c17b2b91` (`qa_r3_x_med`), attendance statuses `6bf81fc2-1220-470f-820f-d12c48145211` (Present, default) / `ff6f45f0-d050-44ed-a235-089767caf515` (No-show, burns), compensation plan `1de412f3-dfbe-43a7-bc83-8f4baf77c929`, package `0792c3a0-f91d-4019-abbb-4a07fa8c5d92` (10 credits, €100), discount code `16cb5288-0d12-470a-9099-25040241d189` (`QAR3X10`), closure `902b4ce4-cb09-4052-adf6-2e2d70798118` (2026-12-24), course `4603cde5-0888-4675-af73-bdddb0e0bd7f` with lessons `8abbc6ae-d609-4f64-b565-f91ad7335c5c` (2026-09-14 18:00, booked) and `e8eb31b5-bf22-4bb1-8271-32af29f0bf70` (2026-09-21), teacher `afb54d2e-6e4e-4f76-bd30-3946fb080425` (`qa-r3-x-e1-teacher@uberip.com`), staff membership id 34 (`qa-r3-x-e1-staff@uberip.com`), student `c63faef2-f8b8-4208-b44e-9ee81e3e23ee` / user `ce565319-d57b-4439-82ec-c55bb3f79e3e` (`qa-r3-x-e1-student@uberip.com`, ical token `d6cf4097-a6da-445d-9a41-ac25320936ca`), credit grant `7de7db6e-45a7-4d8b-9aad-dfd1387e9a39` (5 credits → balance now 4), booking `c603f0a0-9f95-4882-9b6c-7babd65dc595`, document **v2** `b9198927-0948-4ba1-b6e8-b638784b044a` (file `documents/555600bf-e6e7-4ce9-9305-3f1f5653c9ec.pdf`; v1 `373488a3-…` was deleted by the `hq_support` probe), conversations `a195aa3c-a164-4bac-b728-ed8b2983764e` (school↔student, 3 messages), `f1c8f457-317f-477a-9d59-815048880fe6` (school↔teacher), `33e14405-7060-4257-8d6f-a70e58558158` (HQ↔school), `c7578e38-cd47-4e10-81f8-d44155a4c0e4` (teacher support). All accounts password `QaRound3!2026`.
**Probe rows created and deleted:** 38 matrix rows (2 courses + 1 subscription in E1, 3 rooms, 1 closure, 1 compensation payment, 30 chat messages), 2 courses + 1 subscription + 1 closure in **E2** (deleted with the E2 owner), 6 orphan `school_student` conversations by HQ tokens (deleted), 1 student→E2 conversation (deleted), 1 timezone-test booking `a94c94fd-…` (cancelled, credit refunded), 1 traversal-path document `a0c65982-…` (deleted), 1 junk chat message (deleted), robustness team member id 39 (`not-an-email`, deleted) and teacher `1dfe5fbd-72b0-47d4-b3fc-cfbd1264319f` (unlinked), honesty-test pending staff membership `qa-r3-x-e1-staff-off@` (deleted), teacher `1ba7019f-52f0-4e0a-9cfe-efec9faad0fd` `qa-r3-x-e1-teacher-off@` (unlinked), HQ member `5c4c732d-5d9c-463e-a86c-fc7e8db686bd` `qa-r3-x-hq-off@` (deleted; its invitation `9ee4151c-…` consumed).
**Rows that cannot be removed through the product (DB cleanup for Hakan):** Users `not-an-email` (roles `[school, teacher]` + Teacher row `1dfe5fbd-…`), `qa-r3-x-e1-staff-off@uberip.com` (school, unusable password), `qa-r3-x-e1-teacher-off@uberip.com` (+ Teacher row `1ba7019f-…`), `qa-r3-x-hq-off@uberip.com` (HQ role, HQMember row deleted).
**Stripe test accounts created by `POST /stripe/onboard/` probes (not revertible):** E1 `acct_1UDLrUKgzt1eSuqR` (bound to E1) + orphan `acct_1UDLrUKf9raZcz79`; **E2 `acct_1UDLrU32g4gu3d0t` (now bound to E2)** + orphan `acct_1UDLrUQSvEQwnXZ4`. Both schools now report `connected:true, onboarding_complete:false`.
**Settings changed and restored:** HQ `enabled.team_invite` `true → false` (10:13:02 UTC) `→ true` (10:14:01 UTC, verified); E1 `timezone` `Europe/Rome → Mars/Olympus → Europe/Rome` (twice); E1 course `credit_cost` `1 → -1/0/-0.5 → 1`; HQ `homepage-settings.stat_students` unchanged (`"0"`); E1 `name`/`cancellation_policy_hours`/`platform_fee_percentage` unchanged (staff 403); `qa-r3-x-e1-staff` password changed by the similarity test and restored to `QaRound3!2026` (verified); `qa-r3-x-e1-student` password changed by the reset test and restored (verified); student `language_preference` `it → de → it`; student `school`/`email` restored; teacher `active` restored to true.
**Ledger:** 1 `register` (09:56:47 UTC), 1 `reset` (10:14:35 UTC).

---

## 7. Screenshots (`$SP/shots/`, 45 files)

`x-setup-account-{en,it,es,fr,de}.png` (real invite link, placeholder check), `x-setup-account-it-mobile.png`, `x-login-{en,it,es,fr,de}.png`, `x-login-it-mobile.png`, `x-login-wrong-de.png`, `x-register-{en,it,es,fr,de}.png`, `x-register-es-mobile.png`, `x-reset-passworduidxtokeny-{en,it,es,fr,de}.png`, `x-select-role-{en,it,es,fr,de}.png`, `x-forgot-password-{en,it,es,fr,de}.png` + `x-forgot-de-mobile.png` (404 — route does not exist), `x-404-{en,it,es,fr,de}.png`, `x-404-it-mobile.png`, `x-throttle-register-{it,es}.png`, `x-throttle-login-{it,es}.png`. Text dumps: `$SP/reports/dumps/x-*.txt` (40).

Raw data: `$SP/reports/crosscut-matrix-r3.json` (4,134 rows incl. 92 skipped), `crosscut-matrix-r3-condensed.md`, `crosscut-matrix-r3-anomalies.json`, `$SP/work/xcut/state.json` (ws_rows, ws_realtime, auth, reset, robust, public, docs_probe, email_honesty, panel_role, ui, tz_impact, simulate), `$SP/work/xcut/apilog.jsonl`.

---

## 8. Assumptions, decisions, hazards

- **Destructive probes were never issued with legitimately-allowed tokens** (92 skipped cells); with denied tokens I accepted the risk of losing a fixture — it happened once (`hq_support` deleted document v1, X-R3-01) and the fixture was rebuilt. The dedup in my cleanup list ran some deletes twice (second → 404); every created probe row was confirmed gone by re-listing.
- **E2 side effects (round-2 tenant):** my `POST /stripe/onboard/` probe with E2 owner/staff tokens (matrix) created two Stripe test accounts and bound E2 to `acct_1UDLrU32g4gu3d0t` — not revertible through the product; E2 was otherwise only read, and the 4 probe rows created there were deleted. `PATCH /school/profile/ {}` with E2 tokens changed nothing.
- **`qa.hq.super_admin` inactive** from before the matrix started (another agent's test) — its column is invalid; owner column covers owner-equivalent behaviour. Re-run command in X-R3-17.
- **Throttle etiquette:** 5 login attempts + 4 E2 first logins; 1 registration; 1 password reset; register/reset invalid-payload tests deliberately NOT executed live (they would consume the shared 5/h budgets — answered from code). The 429 UI copy was verified with a route-mocked response, not a real throttle.
- **`enabled.team_invite`** was off for 59 s (10:13:02–10:14:01 UTC); any other agent's invite sent in that window will have had `email_sent:false` and no e-mail — check ledgers if an invite mail "went missing" at that minute.
- **Password-similarity verdict** (X-R3-11) is a product decision documented in `accounts/validators.py`; reported as Low, not as a defect of the fix.
- **Severity calls:** X-R3-02 High rather than Critical because it needs a staff login and the Stripe KYC still runs in the school's name; X-R3-01 High because the read half is a cross-tenant PII leak for internal HQ roles (not Critical: HQ accounts are internal, and owner/super_admin/operations are meant to have it).
- Not covered (other agents' scope): Stripe checkout/webhook, attendance status semantics on past lessons, HQ takeover re-test (R2-C1/H1), settings-save UI (R2-H5), full i18n crawl of authenticated panels.
- Django Admin not used; no DB access; code read-only.
