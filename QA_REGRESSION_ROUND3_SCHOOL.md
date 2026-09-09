> Round-3 live regression, 2026-09-08 — per-panel detail report written by the school QA agent. Entry point: [QA_REGRESSION_ROUND3_SUMMARY.md](QA_REGRESSION_ROUND3_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…`, `$SP/reports/…` or `$SP/work/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round3-screenshots/](docs/qa/round3-screenshots/).

# School Panel — QA Round 3 Report (agent: school)

**Agent:** School-panel QA agent (`school`) · **Playwright profiles:** `school-agent` (desktop 1366×900), `school-agent-mobile` (390×844) · **Inbox prefix:** `qa-r3-school-*@uberip.com`
**Tenant:** QA R3 School B (`45786b6e-5605-4587-ae57-9dca50884db2`, slug `qa-r3-school-b`, `language=it`, fee 10 %, timezone Europe/Rome, `School.owner` = user `3db0f434-907f-430f-9822-109d5dd3c6f9`)
**Accounts (password `QaRound3!2026`):** `qa-r3-school-b@uberip.com` (owner; membership 29 → re-created as 35, see SCH-R3-01), `qa-r3-school-admin@uberip.com` (admin; membership 32 → 36), `qa-r3-school-staff@uberip.com` (staff, membership 33, password reset once and set back), `qa-r3-school-t1@uberip.com` (teacher, onboarded), `qa-r3-school-t2@uberip.com` (teacher, invite pending, removed), `qa-r3-school-pending@uberip.com` (staff invite, removed), students `qa-r3-school-s1@uberip.com` (it) and `qa-r3-school-s2@uberip.com` (de, deleted by the school as part of the delete test). `qa.hq.owner@qa-nounder40.test` used read-only (one `GET /chat/conversations/`).
**Time window:** 2026-09-08 09:52 – 11:10 UTC · **Deployed commit:** develop @ `6c0cef1` (CI run 34209392001)
**Method:** every flow driven at least once through the real UI (Playwright/Chromium, own persistent profiles) and cross-checked with the same REST calls the UI makes (`qa.api`, tokens validated with `qa.whoAmI`); every surprising UI observation re-verified by an independent API call; e-mails verified end to end on mail.tm (subject, locale, links). 5-locale desktop sweep of all 20 School pages as owner (100 pages) and as staff (100 pages), mobile sweep as owner (20 pages) — every dump scanned with `qa.scanText`. Scripts: `$SP/work/school/*.js` (numbered 00–42); full request log `$SP/work/school/apilog.jsonl`; raw incremental notes `$SP/work/school/school_rawlog.md`; sweep results `$SP/work/school/sweep-*.jsonl`.

---

## 0. Executive summary

**All nine School-panel round-2 fixes are genuinely live and work through the real UI**: Settings save (R2-H5), document review (R2-H6), add-lesson plan inheritance (R2-H7), staff cannot delete students (R2-H8), `credit_cost` validation (R2-H9), staff dashboard honesty (R2-M2), role validation + fail-closed guard (R2-M3), attendance timing (R2-M5), foreign-teacher payment (R2-M6), closure reporting incl. the wizard banner (R2-M7), `credits_used`/counters (R2-M8), all twelve R2-M9 validation values, invalid `status_id` (R2-M10), invite/no-show/account-deleted copy (R2-M20), e-mail honesty (PR #106), the four SCH-R2-18/21/23/24 Lows and the half-credit modal. Cross-tenant room creation (R2-H3) is closed with the real School C location id. No regressions were introduced by those PRs.

**Not fully closed:** R2-M4 is only partially fixed — the founder is now `owner` and admins are blocked, but a *second owner* can remove the founder's membership (204) while the demotion silently no-ops (200, role unchanged), and an owner promotion is irreversible (**SCH-R3-01, High**). R2-M1 still leaves four team/teacher endpoints returning 500 on a malformed id. The mobile Reports overflow (SCH-R2-13) and most hardcoded-English spots (SCH-R2-20) are unchanged.

**New this round (5 Medium):** the shareable slug deep link `/register?next=/student/book?school=<slug>` never enrols the new student and 500s behind the scenes (SCH-R3-02); document **expiry is not enforced** by the booking gate (SCH-R3-03); re-posting a compensation payment silently overwrites a paid record (SCH-R3-04); the Reports page still overflows on mobile (SCH-R3-05); malformed ids still 500 on team/teacher endpoints (SCH-R3-06). Plus 9 Lows (closure range silently normalised, negative/zero compensation payments, deletable default status, invalid timezone stored, `javascript:` website published, noisy "package running out" mails, hardcoded English incl. the new calendar "Create Class" modal, raw `email_taken`, CSV headers).

Counts: **0 Critical · 1 High · 5 Medium · 9 Low**.

---

## 1. Coverage table

| Page / flow | owner | admin | staff | Locales (en/it/es/fr/de, desktop) | Mobile (it) | Result |
|---|---|---|---|---|---|---|
| Dashboard | ✅ real KPIs | ✅ | ✅ "—" + "Non disponibile per il tuo ruolo" | 5/5 clean | ✅ | R2-M2 fixed |
| Team (invite admin+staff, resend, edit, reset-password, remove, role guards) | ✅ UI + API | ✅ (owner row locked) | 403 + redirect | 5/5 | ✅ | **SCH-R3-01**, SCH-R3-06 |
| Teachers (+invite, `email_sent`, grants, collision, resend, remove) | ✅ UI + API | — | GET 200, writes 403, redirect | 5/5 | ✅ | ok; Low copy |
| Locations + rooms (capacity 0, cost −10, foreign location) | ✅ UI + API | — | GET 200, POST 403 | 5/5 | ✅ | R2-H3 / SCH-R2-18 fixed |
| Compensation plans + payments | ✅ UI + API | — | 403 + redirect | 5/5 | ✅ | **SCH-R3-04**, Lows |
| Courses (wizard, detail, edit PUT, reorder, delete w/ and w/o bookings) | ✅ | — | allowed (courses perm) | 5/5 | ✅ | R2-H9/M7 fixed |
| Lessons (add "like the course", closure add/move, cancel) | ✅ UI + API | — | ✅ | 5/5 | ✅ | R2-H7/M7 fixed |
| Calendar (day/week/month/year, popup, add class) | ✅ | — | ✅ | 5/5 | ✅ | Low: "Create Class" modal English |
| Packages (one-off, recurring, drop-in, custom/half, duplicate, validation) + `/subscriptions` | ✅ UI + API | — | GET 200, POST 403 | 5/5 | ✅ | ok; Low copy |
| Attendance statuses | ✅ UI + API | — | 403 + redirect | 5/5 | ✅ | SCH-R2-23 fixed; Low (default deletable) |
| Settings (rules save, block-booking toggle, language, closures CRUD) | ✅ UI | — | 403 + redirect | 5/5 | ✅ | R2-H5 fixed; Low closure range |
| Profile (identity fields, validation, staff guard) | ✅ | ✅ website | GET 200 (no Stripe/fee keys), PATCH identity 403 | 5/5 | ✅ | Lows (timezone, website) |
| Students (list/search/detail/edit/usage/export, free-lesson flag, delete) | ✅ UI + API | — | delete 403 | 5/5 | ✅ | R2-H8 fixed |
| Credits (grants incl. 0.5 via modal, list, bounds) | ✅ UI + API | — | allowed | 5/5 | ✅ | SCH-R2-19 fixed |
| Documents (types CRUD, pending→validate/reject/expiry/flag, gating) | ✅ UI + API | — | validate 200 (documents perm) | 5/5 | ✅ | R2-H6 fixed; **SCH-R3-03** |
| Attendance (school-side marking, future refusal, invalid status) | ✅ UI + API | — | allowed | 5/5 | — | R2-M5/M10 fixed |
| Inbox (student/teacher/HQ threads, quick replies, realtime badge) | ✅ UI + API | — | ✅ | 5/5 | ✅ | ok |
| Payments (Stripe onboarding → hCaptcha, transactions empty state) | ✅ | — | 403 + redirect | 5/5 | ✅ | blocked at captcha (§8) |
| Reports (5 tabs, CSV, `{count}` strings) | ✅ | — | 403 + redirect | 5/5 | ❌ overflow | **SCH-R3-05**; Low CSV headers |
| Register / setup-account / reset-password (public) | ✅ via e-mailed links | ✅ | ✅ | it + de | ✅ (register on mobile) | **SCH-R3-02** |

Section-guard matrix (staff token): GET → 200 on locations, rooms, closures, courses, courses-overview, lesson-types, lessons, lessons-feed, attendance-statuses, teachers, compensation-plans, students, documents, document-types, packages, credits/grants, quick-replies, memberships, profile, permissions; 403 `section_forbidden` on compensation-payments, compensation-summary, subscriptions, discount-codes, transactions, reports (+detailed/packages/student-classes), team. Staff writes: locations/rooms/closures/compensation-plans/attendance-statuses/packages/discount-codes/teachers (POST+PATCH)/compensation-summary → 403; document-types POST 201 and quick-replies POST allowed (documents/inbox perms — same as R2, by matrix design); students delete → 403 (R2-H8). Cross-role: teacher → `/api/school/*` 403 `not_a_school_member`; school → `/api/hq/*`, `/api/teacher/*`, `/api/student/*` 403; anonymous 401. Staff UI: locations, teachers, teachers/invite, compensation, packages, payments, reports, settings, settings/statuses, team redirect to `/school/dashboard` in all 5 locales.

---

## 2. Findings

### High

#### SCH-R3-01 — A co-owner can remove the founder (`School.owner`) membership; owner demotion is a silent no-op; an owner promotion cannot be reverted — R2-M4 PARTIAL
- **Where:** `backend/schools/views.py` `SchoolTeamView.delete()` (:759–782): the only owner guard is `_is_owner_membership(membership) and caller_role != "owner"` (:773) — a caller who is *also* an owner passes and `membership.delete()` runs; `SchoolTeamView.patch()` (:733) `if new_role in allowed_roles and not self._is_owner_membership(...)` silently skips any role change on an owner membership and still returns 200.
- **Repro (09:58 UTC, all tokens validated with `whoAmI`):** owner `PATCH /api/school/team/ {"id":"32","school_sub_role":"owner"}` → 200 (admin promoted to owner). With that account: `PATCH {"id":"29","school_sub_role":"staff"}` (29 = founder) → **200 with body `school_sub_role: "owner"`** (nothing changed, no error); `DELETE /api/school/team/ {"id":"29","pending":false}` → **204**. Founder afterwards: `GET /api/school/profile/` → 403 `not_a_school_member`, `GET /api/school/memberships/` → `[]`. Then owner `PATCH {"id":"32","school_sub_role":"admin"}` → 200 but still `"owner"`: the only way back is `DELETE` (204), which also drops the account's `school` role until it is re-invited.
- **Expected:** `School.owner` cannot be removed by anyone but HQ (or at least not by a peer owner), and an owner→admin change either works or returns 4xx. **Actual:** peer owner locks the founder out; demotion "succeeds" without effect.
- **Impact:** any account an owner promotes (e.g. a co-founder) can silently evict the founder; the founder loses the whole panel until someone re-invites him. The UI hides Modifica/Rimuovi on the owner row only for admins, so a co-owner sees the buttons.
- **Evidence:** `apilog.jsonl` 09:58:24–09:59:51; recovery: co-owner `POST /school/team/ {email: founder, school_sub_role:"owner"}` → 201 `existing:true` (new membership 35, no e-mail), owner `DELETE {id:32}` → 204, `POST` admin again → membership 36.
- **vs R2:** PARTIAL fix of R2-M4/SCH-R2-07 — admin-side protections verified (403 on demote/edit/remove/invite-owner/promote-to-owner), owner-vs-founder unguarded.

### Medium

#### SCH-R3-02 — Slug deep link `/register?next=/student/book?school=<slug>` does not enrol the new student and 500s — NEW
- **Where:** `frontend/src/app/[locale]/register/page.tsx:79-86` forwards the raw `school` query value as `school_id`; `backend/students/views.py:106` `School.objects.filter(pk=request.data.get("school_id"))` with a non-UUID → unhandled `ValidationError` → 500; the page `.catch(() => {})`es and redirects anyway. `student/book/page.tsx:191` explicitly advertises the slug form ("Lo slug è più pulito da girare via chat/WhatsApp").
- **Repro (10:59:49 UTC, real UI, mobile profile):** `/it/register?next=/student/book?school=qa-r3-school-b` → `POST /api/auth/register/` 201 (user `0efeae08…`) → redirect to `/it/student/book?school=qa-r3-school-b` (school pre-selected, no error). Same for `/de/register…` (user `7e49e3bb…`). Then `GET /api/student/school/` → `{"school": null}` for both; direct `POST /api/student/school/ {"school_id":"qa-r3-school-b"}` → **500**; with the UUID → 200.
- **Expected:** the student is enrolled in the linked school (the whole point of the deep link). **Actual:** silent no-op + a 500 on an authenticated endpoint (R2-M1 class).
- **Impact:** every student recruited through the shared slug link is not in the school's Allieve list until she books; school-side counters/grants cannot target her.
- **Evidence:** `school-register-it/de.png`, `school-student-after-register-it/de.png`; apilog 11:01:07–08.

#### SCH-R3-03 — Document expiry is not enforced by the booking gate — NEW (R2-H6 side gap)
- **Where:** `backend/bookings/services.py _missing_required_document_names()` (PR #95) checks `status == valid` and attachment presence, never `expires_at`.
- **Repro:** `block_booking_on_documents=true`; document `6dcdc3a7…` (type "QA R3 Certificato medico", `has_expiry: true, required: true`) validated by the school; school `PATCH /api/school/documents/6dcdc3a7…/ {"action":"expiry","expires_at":"2026-09-01T00:00:00Z"}` → 200, status stays `valid`. Student `POST /api/bookings/ {"lesson": <19/10>}` → **201** (`b7f16bef…`). Same when the school re-validated after setting the past date (`656344d2…`). Bookings cancelled afterwards; expiry restored to 2027-06-30.
- **Expected:** an expired required document blocks booking like a missing one (400 `documents_required`). **Actual:** expiry is decorative; the sheet shows "scade il 1 set 2026" but nothing happens.
- **Impact:** medical certificates lapse silently — the exact risk the gate exists for.
- **Evidence:** apilog 11:02:02–03 and 11:04:02–08; `school-documents-sheet-it.png`.

#### SCH-R3-04 — Re-posting a compensation payment silently overwrites the existing (paid) record — NEW
- **Where:** `backend/teachers/views.py SchoolCompensationPaymentsSummaryView.post` (`update_or_create` on school+teacher+month).
- **Repro:** `POST /api/school/compensation-summary/ {"teacher_id":T1,"month":"2026-09","amount":44,"status":"pending","payment_method":"bank_transfer","note":"QA R3 settembre"}` → 201 `479ba78f…`; `PATCH /api/school/compensation-payments/479ba78f…/ {"status":"paid"}` → 200; second `POST {"teacher_id":T1,"month":"2026-09","amount":50,"status":"paid"}` → **201 with the same id, `amount 50`, `note ""`, `payment_method ""`**. `paid_at` remains `null` even when `status` is `paid`.
- **Expected:** a payment that already exists for that month is refused (409) or updated only via PATCH, keeping note/method. **Actual:** a settled financial record is replaced and its metadata wiped with no trace.
- **Impact:** silent alteration of teacher-payment records (audit/accounting).

#### SCH-R3-05 — Reports page overflows horizontally on mobile — STILL OPEN (SCH-R2-13)
- 390×844, owner, `it`: `scrollWidth 530 > clientWidth 390` (lessons table); the body scrolls sideways. All other 19 mobile pages fine. Evidence `school-mobile-reports-it.png`, `sweep-mobile-owner.jsonl`.

#### SCH-R3-06 — Malformed ids still 500 on team/teacher endpoints — R2-M1 PARTIAL
- `PATCH /api/school/team/ {"id":"x",…}` → **500**; `DELETE /api/school/team/ {"id":"x"}` → **500**; `POST /api/school/team/resend/ {"id":"x"}` → **500**; `POST /api/school/teachers/resend/ {"teacher_id":"x"}` → **500** (`schools/views.py:690,766,793` and `teachers/views.py` filter integer/uuid pks with raw input). Every other probe from R2-M1's list is now 400/404 (students detail/delete/PATCH, credits grant, compensation month, `lessons?teacher=x`, `lessons-feed?from=x`, plan simulate `students:"abc"`, attendance body string). `reports?month=x` / `?from=x` → 200 (silently ignored).

### Low

- **SCH-R3-07** Settings → Chiusure: typing "A" < "Da" (30/12 → 28/12) makes the UI send `{"date":"2026-12-30","end_date":null}` — a single-day closure is created silently instead of the R2-M9 server error (`settings/page.tsx` ~116). Screenshot `school-settings-closure-bad-it`.
- **SCH-R3-08** `POST /school/compensation-summary/` accepts `amount: -5` and `amount: 0` (201) — no range check (R2-M9 family; rows deleted).
- **SCH-R3-09** The default attendance status can be deleted (`DELETE /school/attendance-statuses/{default}/` → 204) leaving no default; PR #112 guarantees a single default only on create/update.
- **SCH-R3-10** `PATCH /school/profile/ {"timezone":"Mars/Olympus"}` → 200 and stored; the backend falls back to UTC (`bookings/services.py:48`) so the school silently runs on UTC (≈2 h policy drift — the R2-H14 class) with no validation.
- **SCH-R3-11** `PATCH /school/profile/ {"website":"javascript:alert(1)"}` → 200 and published verbatim by the anonymous `GET /api/schools/public/`. Not rendered as an `href` anywhere today (only as text in HQ school detail), so latent; URL scheme validation is missing.
- **SCH-R3-12** "💳 Il tuo pacchetto sta per finire" fires on every booking once *balance ÷ that lesson's cost* ≤ 5: s1 with 7.5 of 10 credits got "5 lezioni rimaste" (11:01:12) then "4 lezioni rimaste" (11:02:03, 6.5 credits) — two "running out" mails at 65–75 % balance; the number changes with the cost of the lesson just booked.
- **SCH-R3-13** Hardcoded English on non-English UI — STILL OPEN (SCH-R2-20/R2-L3) plus new spots: Team `confirm()` "Are you sure you want to remove this pending invitation? / team member" and fallback errors; Packages placeholders "e.g. Starter Pack" / "Short description..." and backend validation text verbatim ("Errore: Credits must be greater than zero."); Locations errors verbatim ("Capacity must be at least 1.", "Cost cannot be negative."); Compensation plan summary "€22/lesson · +€5/student (3–10 students)" and placeholders "e.g. Standard, Senior, Guest", "e.g. 5", "e.g. 9 (or leave empty)"; Teachers edit modal shows the raw code `email_taken`; **Calendar "+ Aggiungi lezione" modal buttons "Create Class" / "Cancel" and "Select course..."**; Reports CSV headers are the raw English row keys ("Name,Date,Teacher,…,Comp. Plan,…") in every locale.
- **SCH-R3-14** Copy nits: teacher invite subject uses lowercase "— insegnante" while team invites say "— Amministratore/Staff"; greeting "Ciao QA" (first token of a multi-word first name); cancelled orphan lessons keep `current_bookings 1` (cosmetic, lesson is cancelled); "Uso Pacchetti" shows a manual gift grant as package "—" ("0 usati su 0.5").

### Observations (not rated)
- Re-opening a consumed `/setup-account` link re-renders the empty form (error only on submit).
- A re-added member's fresh JWT carries `"role":""` with `roles:["school"]`; UI unaffected.
- Staff `PATCH /school/profile/ {}` → 200 without Stripe/fee keys (R2-L11a fixed) but still returns `grace_period_days`, `free_trial_ends_at`, `ical_token`, `owner` (same as staff GET).
- `POST /auth/password-reset/` returns `{"found": true}` for a known e-mail (Team modal). If the anonymous path returns the same, it is an account-enumeration oracle (not probed — reset budget).
- `DELETE /school/courses/{id}/full/` with booked future lessons cancels + refunds immediately (no `confirm_cancel_bookings` step — that 409 exists only on the PUT edit path, `course_views.py:801`); UI has its own confirm. Cancelled lessons stay as `course: null` orphans (documented policy, SCH-R2-22).
- Course reorder with an unknown id → 200 `{"ok":true}` (ignored).

---

## 3. Round-2 fix re-verification (School scope)

| R2 item | PR / commit | Verdict | Live evidence |
|---|---|---|---|
| R2-H5 Settings save 403 | #83 | **VERIFIED FIXED LIVE** | UI: 48 h / 3 h / free-first ON / show-teacher OFF / EN → `PATCH /school/profile/` body without `grace_period_days` → 200, "Impostazioni salvate"; `GET` = 48/3/true/false/en; grace field gone; restored |
| R2-H6 documents born valid | #95 | **VERIFIED FIXED LIVE** | upload → `status:"pending"`; gate blocks pending/rejected/missing; validate → booking 201; reject → 400; expiry/flag persist; `approved_locked`; counter "In attesa di convalida" shows the pending waiver. Gap: expiry (SCH-R3-03) |
| R2-H7 add-lesson plan | #97 | **VERIFIED FIXED LIVE** | `POST /school/classes/` without plan → lesson `compensation_plan` = course plan `6d16edbb…`; teacher compensation lists the lesson at €22 |
| R2-H8 staff deletes student | #89 | **VERIFIED FIXED LIVE** | staff `DELETE /school/students/delete/` → 403; owner → 204 |
| R2-H9 credit_cost | #99 | **VERIFIED FIXED LIVE** | create: −1/0 → 400 "greater than zero", 1.25 → 400 "half-credit steps", "abc" → 400; PUT: 1.25/−2 → 400, 2.5 → persisted; wizard 1.5 OK |
| R2-H3 cross-tenant room | #89 | **VERIFIED FIXED LIVE** | School C location `35d9cd81…`: POST and PATCH → 400 "Location does not belong to your school." |
| R2-M2 fake zeros | 815098f | **VERIFIED FIXED LIVE** | staff: "—" ×4 + "Non disponibile per il tuo ruolo"/"Not available for your role"; owner/admin real numbers |
| R2-M3 godmode role | #86 | **VERIFIED FIXED LIVE** | POST → 400 `invalid_school_sub_role`; PATCH to `godmode` ignored |
| R2-M4 owner protections | ee646cf | **PARTIAL → SCH-R3-01** | first account is `owner`; admin blocked (403 ×5); co-owner can remove founder; demotion silent |
| R2-M5 attendance timing | ee646cf | **VERIFIED FIXED LIVE** | future 14/09 and today-19:00 → 400 `lesson_not_yet_occurred`; past → 200 |
| R2-M6 foreign teacher payment | #89 | **VERIFIED FIXED LIVE** | `9c987f88…` → 404 `teacher_not_at_school` |
| R2-M7 closure reporting | ee646cf / 815098f | **VERIFIED FIXED LIVE** | API `skipped_closure_dates`; single-only → 400; classes POST/PATCH → 400 `school_closed` + date; wizard banner "1 lezione non è stata creata: la scuola è chiusa il 21/09/2026." |
| R2-M8 credits_used / counters | ee646cf | **VERIFIED FIXED LIVE** | refund excluded (3.5 with 1.5 refunded; 3 at the end); delete student → `current_bookings` 1→0 and 2→1 |
| R2-M9 validation gaps | ee646cf | **VERIFIED FIXED LIVE** | all 12 values → 400 with field messages. New gaps: SCH-R3-08/10/11 |
| R2-M10 invalid status_id | ee646cf | **VERIFIED FIXED LIVE** | 400 with per-row `invalid_status_id`, nothing written |
| R2-M1 malformed → 500 | ee646cf | **PARTIAL → SCH-R3-06** | 4 team/teacher endpoints still 500; SCH-R3-02 adds `/student/school/` |
| R2-M20 e-mail copy | ee646cf | **VERIFIED FIXED LIVE** | invites name school + role (it/de); no-show "am 01-09-2026 um 11:00" / "del 08-09-2026 alle 09:00"; account-deleted "von QA R3 School B gelöscht … keine Anfrage von dir" |
| R2-H15 / PR #106 e-mail honesty | #106 | **VERIFIED FIXED LIVE** | team `email_sent:true`, teacher `email_sent:true` / `false`+`existing_account:true`, resend `{"sent":true}`; 8/8 invite mails arrived ≤ 2 s |
| R2-L11 SCH-R2-17 staff PATCH `{}` | 0ca4505 | **VERIFIED FIXED LIVE** | no `stripe_account_id`/fee keys |
| R2-L11 SCH-R2-18 capacity 0 | #112 | **VERIFIED FIXED LIVE (UI)** | server message shown, no silent 20 |
| R2-L11 SCH-R2-19 credits modal | 0ca4505 | **VERIFIED FIXED LIVE (UI)** | 0.5 granted from the modal → 201 |
| R2-L11 SCH-R2-21 lessons_upcoming | #112 | **VERIFIED** | 9 upcoming = 8 (course A) + 1 (course C) |
| R2-L11 SCH-R2-23 statuses | #112 | **VERIFIED FIXED LIVE** | duplicate name → 400; one default at a time; new: SCH-R3-09 |
| R2-L11 SCH-R2-24 bool strings | #112 | **VERIFIED FIXED LIVE** | `"false"` → false, `"0"` → false, `"maybe"` → 400 |
| R2-L11 SCH-R2-25 existing-account hint | #112 (no change) | **VERIFIED** | `existing_account:true`, no mail |
| SCH-R2-13 mobile reports | — | **STILL OPEN → SCH-R3-05** | |
| SCH-R2-20 hardcoded English | #110 | **STILL OPEN → SCH-R3-13** | |
| SCH-R2-22 orphan lessons | policy | **VERIFIED (policy unchanged)** | 3 cancelled `course:null` lessons after deleting course A |
| PR #105 realtime unread badge | #105 | **VERIFIED LIVE** | sidebar "Messaggi 1" → "Messaggi 2" without reload |

---

## 4. E-mails verified (all from `support@alinaquintana.com`, delivery 1–6 s)

| Trigger (UTC) | Recipient | Subject | Locale | Links / notes |
|---|---|---|---|---|
| Team invite admin (UI) 09:54:41 | qa-r3-school-admin | ✉️ Invito da QA R3 School B — Amministratore | it ✓ | `/it/setup-account?uid&token` → completed via UI ✓ |
| Team invite staff (UI) 09:54:43 | qa-r3-school-staff | ✉️ Invito da QA R3 School B — Staff | it ✓ | completed via API ✓ |
| Teacher invite ×2 (UI) 09:55:17/19 | t1 / t2 | ✉️ Invito da QA R3 School B — insegnante | it ✓ | t1 completed ✓ |
| Team invite `locale:"de"` (API) 10:01:11 | qa-r3-school-pending | ✉️ Einladung von QA R3 School B — Staff | de ✓ | `/de/setup-account` |
| Team "Rinvia" (UI) 10:02:53 | qa-r3-school-pending | ✉️ Einladung von QA R3 School B — Staff | de ✓ (user pref) | |
| Team modal "Invia reset password" (UI) 10:02:55 | qa-r3-school-staff | 🔑 Reimposta la tua password | it ✓ | `/it/reset-password` → password updated → dashboard ✓ |
| Teacher resend (API) 10:04:15 | t2 | ✉️ Invito da QA R3 School B — insegnante | it ✓ | |
| Register (UI) 10:59:49 / 10:59:55 | s1 / s2 | 🩰 Benvenuta in … / 🩰 Willkommen bei … | it ✓ / de ✓ | `/it|de/student/profile?for=` |
| Bookings (API) 11:01:10–13 | s1 (it) / s2 (de) / school inbox (it) | ✅ Prenotazione confermata — …, 08-09-2026 / ✅ Buchung bestätigt / 📅 Nuova prenotazione: <name> — <course>, <date> | ✓ each | |
| Cancel within policy 11:01:12 | s1 / school | ❌ Prenotazione annullata — …, 14-09-2026 / ❌ Prenotazione annullata: QA R3 Studentessa Uno — … | it ✓ | |
| Low credits 11:01:12 / 11:02:03 | s1 | 💳 Il tuo pacchetto sta per finire — 5 / 4 lezioni rimaste | it ✓ | SCH-R3-12 |
| School attendance "QA R3 Assente" (API) 11:01:14 | s2 | 👻 Du hast uns gefehlt — …, 01-09-2026 | de ✓ | date in body ✓ |
| Student deleted by school 11:02:07 | s2 | 🕊️ Dein Konto wurde von QA R3 School B gelöscht | de ✓ | R2-M20 copy ✓ |
| School attendance via UI 11:04:40 | s1 | 👻 Ci sei mancata — …, 08-09-2026 | it ✓ | |
| Course A deleted with bookings 11:05:56 | s1 | 🚫 Lezione annullata — …, 12-10-2026 (and 28-09) | it ✓ | course/date/time/teacher/room |
| Stripe `school.stripe_connected` | school | not received (onboarding blocked by hCaptcha) | — | expected |

School inbox `qa-r3-school-b@uberip.com` received 9 school-side copies (📅 ×6, ❌ ×3) plus the HQ "— Titolare" invite. No expected e-mail failed to arrive.

---

## 5. Verified good (passed)

- Team: invite admin/staff via UI (201, `email_sent:true`), owner sees "Proprietario" option (admin does not), pending resend, edit modal (name/phone) saved, reset password from modal end-to-end, remove pending (confirm → DELETE 204), `cannot_remove_self`, foreign/unknown membership ids → 404, admin cannot touch the owner row (API 403 ×5 and no buttons in UI), staff → `section_forbidden` on team.
- Teachers: invite ×2 via UI with honest banner, grants ON/OFF (incl. string booleans), e-mail collision → 400 (case-insensitive), edit phone/bio, resend, existing-account invite (`existing_account:true`, no mail, "è stato aggiunto"), remove via two-click "Rimuovi → Sicuro? Clicca di nuovo" (`DELETE /school/teachers/ {teacher_id}` → `{"deleted":1}`), teacher sees the school + plan on `/teacher/schools/`, stats 2 taught / 9 upcoming.
- Locations/rooms: create location + rooms via API and UI; capacity 0 / cost −10 → real server messages in the UI; valid room created; foreign location → 400.
- Closures: single/range/partial created; end<start and partial-without-time → 400 (API); UI add/remove.
- Compensation: plans via API/UI (negative base fee blocked client-side and server-side; bonus threshold order enforced); simulate (5 students → €32); payment pending→paid; summary and teacher breakdown list only occurred lessons (01/09, 08/09 09:00 — not 19:00), €44 = 2 × €22; foreign/unknown teacher → 404.
- Courses: wizard end to end (Flex, T1, 1.5 credits, plan Base, single-on-closure + weekly) with closure banner; course detail / edit / list pages; API courses A/C/D (weekly, biweekly, online link, past lessons); PUT edit; reorder; delete bookingless (hard delete) and booked (cancel + refund + e-mail).
- Lessons: add "like the course" inherits plan; add on closure → 400 with date; weekly add reports skipped 08/10; move onto closure → 400; move to a free day → 200; cancel via UI (two-click + confirm) → `{"cancelled":true,"refunded":0}`.
- Calendar: all four views, week navigation, lesson popup (date/time/teacher/format/room/bookings), filters; "+ Aggiungi lezione" modal creates a lesson (`created:1`, see SCH-R3-13 for its English buttons).
- Packages: one-off/recurring/drop-in/custom-half-credit via API, UI create (with lesson-type guard), duplicate, deactivate, validation (credits 0 / 1.25, validity 0, cap −1, unknown lesson type → 400); discount code create/validation; `/subscriptions` → `/packages` redirect (single engine).
- Attendance statuses: create ×3, duplicate name → 400, single default enforced on create/patch, rename collision → 400.
- Settings: full save cycle and restore, block-booking toggle, language switch it→en→it.
- Profile: owner/admin identity PATCH (phone/address/VAT/website) + restore; staff identity/policy PATCH → 403 with field list; invalid e-mail / blank name → 400; HQ-only fields (`platform_fee_percentage`, `grace_period_days`) → 403 for the owner.
- Students: list/search, free-lesson flag PATCH both ways, edit modal, "Uso Pacchetti" panel, XLS/PDF exports (real downloads `students.xlsx`, `students.pdf`), documents sheet, delete by owner (204, cascade, counters, e-mail); staff enrolment on past lessons; duplicate enrolment → 400.
- Credits: 10 / 2.5 / 0.5 (UI) grants, 0.3 → 400, 99999.5 accepted (max), grants list with granter.
- Documents: types CRUD (dup code → 400), full review workflow, gating both ways, student `approved_locked`.
- Attendance: UI marking with status buttons; present/absent semantics (`attended/present`, `no_show/no_show`, lesson `completed`); credits untouched by marking; future/today-later refused; unknown student/status → per-row errors.
- Inbox: student/teacher/HQ threads, unread counts per type, quick reply insert + send, `/read/` on open, realtime badge, teacher isolation (R2-C2), HQ owner sees the `hq_school` thread.
- Reports: 5 tabs render with data, CSV download works, `{count}` strings interpolated (no raw placeholders in 285 dumps).
- i18n sweep: 100 owner + 100 staff desktop pages and 20 mobile pages — 0 raw keys / `{var}` / `undefined` / `NaN`, 0 non-401/403 console errors, 0 overflow except reports mobile.
- Stripe: `POST /api/stripe/onboard/` creates the Connect account and the Payments page reflects "Onboarding in Sospeso · Account ID · Continua l'Onboarding".

---

## 6. Test data created (tenant QA R3 School B) — left in place unless noted

- **Memberships:** 35 owner (`qa-r3-school-b@`, re-created; original 29 deleted during SCH-R3-01), 36 admin (`qa-r3-school-admin@`, user `f283e3b6…`; original 32 deleted), 33 staff (`qa-r3-school-staff@`, user `29f48df3…`, last name now "Uno Modificata", phone +39 333 1234567, password reset to the same value). Removed: 38 pending (`qa-r3-school-pending@`). Rejected: godmode invite, owner-x invite.
- **Teachers:** `2e9d8c59…` QA R3 Teacher Uno (user `09dd850e…`, both grants ON). Removed: `a728e9fe…` Teacher Due (pending), `3fbe9fc8…` admin-as-teacher link.
- **Location** `609629a9…` "QA R3 Sede Centrale" with rooms `e276e44c…` Sala Grande (12, €20), `ceb0d63f…` Sala Piccola (3, €0), `6bb89c5c…` Sala UI (8, €12.5).
- **Closures:** `3b239d03…` 2026-09-21, `0fb8430a…` 2026-10-05→09, `f3742cf3…` 2026-10-22 partial 14:00. Deleted: Natale 24→26/12, two "QA R3 bad".
- **Compensation plans:** `6d16edbb…` Piano Base (€22, +€5 from 3 to 10), `47bc7641…` Piano Flat (€25.5). Payment `479ba78f…` T1 2026-09 €50 paid (overwritten, SCH-R3-04). Deleted: −5, 0 payments.
- **Attendance statuses:** `5c085be7…` QA R3 Presente (default; original `80d42c40…` deleted in SCH-R3-09 probe), `8e1a30e4…` Assente (burns), `b5a2b38b…` Giustificata. Deleted: Default2, Ritardo (if created).
- **Document types:** `b9b7169c…` QA R3 Certificato medico (required, expiry), `6fb62ff2…` QA R3 Liberatoria. Deleted: Temp Doc, staff-created `qa_r3_staff`.
- **Packages:** `98586115…` Pacchetto 10, `37dc2e60…` Abbonamento Mensile (recurring), `07b3f952…` Lezione Singola (drop-in), `50eed51b…` Pacchetto Custom (5.5), `7a6b1adf…` Pacchetto UI 12.5 (inactive), `411a7cfc…` "Pacchetto 10 (copia)". Discount code `0581d0b6…` QAR3TEN.
- **Courses:** `4ac8a1b8…` (course C: lessons `3dbf51d4` 01/09 completed, `6055a3f6` 08/09 09:00 completed, `be73c744` 08/09 19:00 booked by s1, plus 05/11 15:00 added through the Calendar modal), W `b72486b5…` (wizard course, 4 lessons Nov, left in place — the course detail page exposes no delete action, deletion was exercised via API on A and D). Deleted: A `bdacf6be…` (3 cancelled orphans `03b92899`, `be54dbe2`, `d07349fa` remain), D `29ce6b45…`.
- **Students:** s1 `qa-r3-school-s1@` (user `0efeae08…`, Student `b0b5239e…`, SchoolStudent `d79ed697…`; grants 10 + 0.5; balance 7.5; booking `bf698234…` 08/09 19:00 confirmed, no-show on 08/09 09:00, present on 01/09; document `6dcdc3a7…` valid exp. 2027-06-30 note "QA R3 nota", waiver `3932104f…` pending). s2 `qa-r3-school-s2@` (user `7e49e3bb…`) **deleted** 11:02 with its 99999.5+2.5 grants and bookings.
- **Chat:** `4ddeb9d2…` school↔s1, `43325a31…` + `2309baf0…` school↔t1, `7ed643e9…` hq_school. Quick reply `f2dbd64c…` "QA R3 Saluto".
- **Stripe:** Connect account `acct_1UDM6O3pIDyxmQGr` (test mode, onboarding incomplete) — cannot be removed from the school panel.
- **Settings changed and restored:** cancellation 24 h, notice 2 h, free-first false, show-teacher true, language it, block-booking false, timezone Europe/Rome, website "", phone/address/VAT as baseline — final `GET /school/profile/` differs from the 09:53 baseline only in `stripe_account_id`.
- **Ledger:** 2 registrations (10:59:49, 10:59:55), 1 password reset (10:02:55). Inboxes created: `qa-r3-school-{admin,staff,t1,t2,s1,s2,pending,godmode}@uberip.com`.

---

## 7. Screenshots (`$SP/shots/`, 300+ files)

Team: school-team-before-invite-it, -after-invite-admin-it, -after-invite-staff-it, -pending-it, -after-resend-it, -edit-modal-it, -edit-modal-reset-sent-it, -after-edit-it, -after-remove-it, -as-admin-it · Setup/reset: school-setup-account-admin-it, school-dashboard-after-setup-admin-it, school-dashboard-admin-readded-it, school-reset-password-page-it, school-reset-password-done-it · Teachers: school-teachers-empty-it, school-teacher-invite-form-it, school-teachers-after-invites-it, -edit-modal-it, -edit-email-collision-it, -after-remove-it · Locations: school-locations-it, -room-cap0-it, -room-costneg-it, -final-it · Compensation: school-compensation-plan-form-it, -plan-form-error-it, -plans-it, -payments-it · Courses: school-courses-list-it, school-course-wizard-step1/step2/step2-filled/result-it, school-course-detail-it, school-course-edit-it, school-courses-list-after-it, school-class-edit-it, school-course-delete-confirm-it, school-courses-after-delete-it · Lessons: school-lessons-it, -cancel-confirm-it, -after-cancel-it · Calendar: school-calendar-default/giorno/settimana/mese/anno/week-next/lesson-popup/add-class/add-class-filled/add-class-done-it · Packages: school-packages-list/form/create-attempt/after-create/after-duplicate/validation/final/discounts-it, school-subscriptions-it · Statuses: school-statuses-list-it, school-statuses-after-create-it · Settings: school-settings-it, -after-save-it, -closures-it, -closure-bad-it · Students/credits/docs: school-students-list-it, -search-it, school-student-edit-modal-it, school-student-package-usage-it, school-credits-it, school-credits-modal-it, school-credits-after-grant-it, school-documents-it, school-documents-sheet-it · Attendance: school-attendance-page-it, -marked-it, -submitted-it · Inbox: school-inbox-it, school-inbox-badge-it, school-inbox-student-conv-it, -quick-replies-it, -student-conv-after-it, school-inbox-tab-insegnanti/hq-it · Payments: school-payments-it, school-payments-after-onboard-it, school-stripe-onboarding-s1/s2 · Reports: school-reports-tab0..3-it · Register: school-register-it/de, school-student-after-register-it/de · Sweeps: school-<page>-<locale> ×100 (owner), school-staff-<page>-<locale> ×100, school-mobile-<page>-it ×20.

Text dumps: `$SP/reports/dumps/school-*.txt` (285 files, all scanned — 0 hits).

---

## 8. Assumptions, decisions, hazards

- **Self-inflicted incident, disclosed:** the SCH-R3-01 probe removed the founder's membership at 09:58:25; it was restored within 45 s by the co-owner re-invite (new membership 35). Membership ids in `tenants.json` for this tenant are therefore stale (29 → 35). No other tenant was touched; the only cross-tenant calls were read-only (`GET /school/locations/` with the cached School C token to obtain a real location id — no mutation on School C) and the two rejected room probes.
- Stripe Connect onboarding was attempted once (creates a real test-mode account); the hCaptcha blocked it as in round 2 — payments/transactions/refund flows were not exercised on this tenant (QA Test School is the Student agent's).
- The password-reset budget (1) was spent on the Team-modal reset; the Students-page "Ripristina Password" was therefore not fired (API guard checked).
- `POST /auth/password-reset/` returning `{"found":true}` was not probed anonymously (budget); flagged as an observation for the crosscut agent.
- Severity calls: SCH-R3-01 rated High (privilege boundary between owner peers + irreversible role change + founder lock-out) rather than Critical because it needs an existing owner to have promoted the attacker; SCH-R3-03 Medium because the gate is the only enforcement point of `has_expiry`; SCH-R3-04 Medium (financial record overwrite, school-internal).
- "Attendance never changes credits" (excused re-mark does not refund) is treated as the intended domain rule, not a bug.
- Delete of course A used the API without `confirm_cancel_bookings` — the flag only exists on the edit path; the UI shows its own confirm.
- Calendar "+ Aggiungi lezione" modal submitted via its "Create Class" button → `POST /school/classes/ {course_id, date:"2026-11-05", start_time:"15:00", duration_minutes:"60", frequency:"single"}` → 200 `{"created":1,"skipped_closure_dates":[]}` (screenshot `school-calendar-add-class-done-it`).
- Throttles: all 10/min login, 5/h registration and 5/h reset limits were respected (2 registrations at 10:59 after the shared window cleared; 1 reset).
