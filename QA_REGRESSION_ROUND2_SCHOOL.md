> Round-2 live regression, 2026-09-07 — per-panel detail report written by the school QA agent. Entry point: [QA_REGRESSION_ROUND2_SUMMARY.md](QA_REGRESSION_ROUND2_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…` or `$SP/reports/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round2-screenshots/](docs/qa/round2-screenshots/).

# School Panel — QA Round 2 Report (agent: school-agent)

**Agent:** School-panel QA agent · **Playwright profile:** `school-agent` · **Inbox prefix:** `qa-r2-school-*@uberip.com`
**Tenant:** QA R2 School B (`ab51f9ff-b566-4247-995f-b49d37b36578`, `School.language=it`, fee 10%, `School.owner` = first admin)
**Accounts used (all password `QaRound2!2026`):** qa-r2-school-b (admin, School.owner), qa-r2-school-admin2 (admin, created via invite), qa-r2-school-staff1 (staff, created via invite), qa-r2-school-teacher1 (teacher, completed setup), qa-r2-school-teacher2 (teacher, invite pending), qa-r2-school-student1 (student, en), qa-r2-school-student2 (student, de — deleted at 11:32 UTC as part of the delete-student test), temporary members qa-r2-school-temp1/temp3 (removed). `qa.hq.owner@qa-nounder40.test` used read-only (GET /hq/schools/{id}/ and /linked/).
**Time window:** 2026-09-07 10:09 – 11:36 UTC · **Deployed commit:** develop @ 8153889
**Method:** every flow driven through the real UI (Playwright, own persistent profile) or the same REST calls the UI makes; every UI observation cross-checked with curl+JWT; emails verified on mail.tm. After the coordinator's throttle notice (10:44 UTC) all scripts switched to cached tokens + `/auth/refresh/`; registrations/resets were logged in `REGISTRATION_LEDGER.md` (2 registrations at the planned 11:16 slots, 1 password reset at 10:14).

---

## 1. Coverage table

| Page / route | admin (owner-equivalent) | admin2 | staff | Locales (en/it/es/fr/de) | Mobile (390px) | Result |
|---|---|---|---|---|---|---|
| Dashboard | ✅ KPIs vs /school/reports/ | ✅ | ✅ visible, KPIs silently 0 (SCH-R2-10) | 5/5 clean | ✅ | ok / finding |
| Team (invite/edit/resend/remove/reset pw) | ✅ full | ✅ demote/remove admin | 403 + redirect | 5/5 | ✅ | findings 06, 07, 20 |
| Teachers (+invite) | ✅ invite×2, edit, collision, grants, resend, remove | — | GET 200 (lookup), POST/PATCH 403, redirect | 5/5 | ✅ | ok / low i18n |
| Locations + rooms | ✅ UI CRUD + API validation | — | GET 200, writes 403, redirect | 5/5 | ✅ | findings 16, 18 |
| Closures (Settings) | ✅ UI add/remove, API validation, enforcement | — | GET 200, POST 403 | 5/5 | ✅ | finding 16 |
| Courses list / New wizard / detail / edit / class edit | ✅ wizard (3 schedules), PUT edit, reorder, delete, add/edit/cancel class | — | courses perm → allowed | 5/5 | ✅ | findings 03, 05, 14 |
| Lessons | ✅ list, cancel with refund | — | ✅ | 5/5 | ✅ | ok |
| Calendar | ✅ day/week/month/year, popup, teacher filter, add form, closure marker | — | ✅ | 5/5 | ✅ | low i18n |
| Compensation (plans + payments) | ✅ plan CRUD UI, simulate math, mark paid | — | plans GET 200, payments/summary 403 | 5/5 | ✅ | findings 09, 15, 16 |
| Students (list/search/detail/free-lesson/reset/delete) | ✅ (reset-password NOT triggered: coordinator budget) | — | delete 204 (SCH-R2-04) | 5/5 | ✅ | finding 04, 11 |
| Credits (manual grants) | ✅ API boundaries, UI modal (partial) | — | grant allowed (manualCredits) | 5/5 | ✅ | finding 19 |
| Packages (+ /subscriptions redirect) | ✅ UI all-types/duplicate/recurring/drop-in/validation/deactivate, API validation | — | GET 200, POST 403 | 5/5 | ✅ | finding 16 |
| Discount codes (API + student check) | ✅ | — | 403 | — | — | ok |
| Payments (Stripe status + transactions) | ✅ empty state, onboarding started | — | 403 + redirect | 5/5 | ✅ | Stripe blocked by captcha (§7) |
| Documents (+ types in Settings, sheet approve/reject) | ✅ | — | doc-types POST 201, validate 200 (documents perm) | 5/5 | ✅ | finding 02 |
| Inbox (+ conversation, quick replies) | ✅ teacher & student conversations both sides | — | ✅ (quick reply create allowed) | 5/5 | ✅ | low i18n |
| Reports (5 tabs, CSV download) | ✅ | — | 403 + redirect | 5/5 | ❌ horizontal overflow (SCH-R2-13) | finding 12, 13 |
| Settings (rules, docs block, closures, language) | ✅ | ✅ | 403 + redirect | 5/5 | ✅ | **SCH-R2-01** |
| Attendance statuses | ✅ UI create ×3, API edge cases | — | 403 + redirect | 5/5 | ✅ | finding 23, low i18n |
| Attendance (school/attendance/{lesson}) | ✅ mark via UI, API future-lesson probe | — | allowed (lessons perm) | 5/5 | — | finding 08 |
| Profile | ✅ save | — | GET ok, PATCH identity 403 (H-7 fixed) | 5/5 | ✅ | ok |
| Setup-account / reset-password / register (public) | ✅ via emailed links | ✅ | ✅ | it + en/de | — | low i18n |

Section guard matrix (staff token, GET): locations/rooms/closures/courses/courses-overview/lesson-types/lessons/lessons-feed/attendance-statuses/teachers/compensation-plans/students/documents/document-types/packages/credits/grants/quick-replies/memberships/profile/permissions → 200; compensation-payments/compensation-summary/subscriptions/discount-codes/transactions/reports(+detailed/packages/student-classes)/team → 403 `section_forbidden`. Staff writes: compensation-plans/attendance-statuses/discount-codes/closures/compensation-summary/teachers PATCH → 403; document-types POST 201, quick-replies POST 201, credits/grant, classes, students PATCH/DELETE → allowed by the matrix (documents/inbox/manualCredits/courses/students permissions). School tokens vs `/api/hq/*`, `/api/teacher/*`, `/api/student/*` → 403 everywhere; teacher token vs `/api/school/*` → 403 `not_a_school_member`; anonymous → 401. Direct URLs to staff-forbidden pages (team, reports, packages, settings, settings/statuses, payments, compensation, teachers, locations, subscriptions) all redirect to `/school/dashboard`.

---

## 2. Findings

### High

#### SCH-R2-01 — Settings page "Salva impostazioni" always fails (403) but shows "Impostazioni salvate" — NEW (regression introduced by the H-7 fix)
- **Where:** `frontend/src/app/[locale]/school/settings/page.tsx:80-96` (`handleSave` sends `grace_period_days` and swallows errors with `.catch(() => {})`, then sets `saved=true`); `backend/schools/views.py` `_SCHOOL_HQ_ONLY_FIELDS` includes `grace_period_days`.
- **Repro (UI, admin):** Settings → set "Politica di cancellazione" 48 and "Preavviso minimo" 3 → Salva impostazioni → green "Impostazioni salvate".
- **Actual:** `PATCH /api/school/profile/` body `{"cancellation_policy_hours":48,"grace_period_days":7,"free_first_lesson":false,"min_booking_notice_hours":3,"language":"it","show_teacher_to_students":true}` → **403 `{"error":"forbidden","fields":["grace_period_days"]}`**; `GET /school/profile/` afterwards still `cancellation_policy_hours: 24, min_booking_notice_hours: 2`. The same PATCH without `grace_period_days` → 200 (so no admin can change cancellation policy, notice, free-first-lesson, show-teacher or school language from this page; the "Blocca prenotazione senza documenti" toggle uses a separate PATCH and works, 200).
- **Evidence:** `school-settings-after-save-it.png`; captured request/response above.

#### SCH-R2-02 — Student documents are born `status=valid`: booking gating passes with zero school validation — NEW
- **Where:** `backend/students/models.py` `StudentDocument.status = CharField(..., default=Status.VALID)`; `students/serializers.py StudentDocumentSerializer` marks `status` read-only, so a student POST always yields `valid`.
- **Repro:** `block_booking_on_documents=true`, required type "QA R2 Certificato medico". Student1 `POST /bookings/` → 400 `documents_required` (correct). Student1 `POST /documents/upload/` (a 40×40 red PNG) then `POST /student/documents/ {type_ref, files, expires_at}` → **201 with `"status":"valid","validated_at":null`**. Immediately `POST /bookings/ {lesson: L14}` → **201 confirmed** — no school action ever happened.
- **Impact:** the school's "Approva/Rifiuta" step (Documents sheet, works: PATCH 200 both ways) is decorative for gating; the Documents page counter "In attesa di convalida" is always 0 (screenshot `school-documents-with-doc-it.png`). Rejecting afterwards does re-block booking (400 `documents_required` verified), but a student can re-upload anything to unblock.

#### SCH-R2-03 — Lessons added with "Aggiungi lezione" never inherit the course compensation plan → teacher fee silently 0 — NEW
- **Where:** `backend/catalog/course_views.py:829` `SchoolClassCreateView`: `compensation_plan_id=data.get("compensation_plan_id") or None` (no `or course.compensation_plan_id` fallback, unlike the wizard `:377` and the edit path). The UI form defaults the plan select to "Come il corso" (`''`, not sent).
- **Repro (UI):** course 3b2e3659 has plan "QA R2 Piano Base" (€22 base). Course detail → Aggiungi lezione (23/09 12:00, plan left on "Come il corso") → `GET /school/lessons/?course=…` shows `compensation_plan: null` for `bf883237…`; API-created class `cf642cd4` identical. `GET /school/compensation-summary/?month=2026-09` for the past class 0cc95230 (added the same way, 1 student present) → `lesson_count 1, total 0.0`; `GET /school/teachers/{T1}/compensation/?month=2026-09` → `fee 0.0, plan_name null`.
- **Impact:** every manually added class pays the teacher nothing unless the school re-selects the plan on each class; the label "Come il corso" says the opposite.

#### SCH-R2-04 — A `staff` member can permanently delete a student account — NEW
- **Where:** `backend/students/school_views.py SchoolStudentDeleteView` (no role check beyond section guard; `students` section is in the staff matrix).
- **Repro:** staff1 → `DELETE /api/school/students/delete/?student_user_id=514746d2-…` → **204**. Account, bookings and documents gone; "🕊️ Dein Konto wurde gelöscht" e-mail sent (11:32:41 UTC, German — student's language ✓, but the copy says "you decided to delete your account", which is false for a school-initiated deletion). The admin's own subsequent delete returned 404. The UI shows no delete button to staff, so this is API-reachable only, but it is the most destructive action in the panel and the lowest-trust role has it.
- **Companion (SCH-R2-11):** lesson counters are left stale after deletion.

#### SCH-R2-05 — Negative `credit_cost` accepted; booking such a lesson **adds** credits to the student — NEW
- **Where:** `backend/catalog/course_views.py:42 _credit_cost_decimal` (the H-5 fix removed `int()`, but there is still no `> 0` check; the wizard blocks ≤0 client-side only).
- **Repro:** `POST /school/courses-create/ {"credit_cost": -1, …}` → 200; `GET …/full/` → `credit_cost: -1.0`. Student1 (99995.9 credits) `POST /bookings/` on that lesson → 201 `credits_deducted: -1.0`, balance → **99996.9**; cancelling within policy "refunds" −1 (balance back to 99995.9). The lesson is offered to students as "-1 Guthaben" (`school-student2-lesson-modal-de.png`). Also `credit_cost: 0` is silently stored as 1 and `1.25` as 1.3 via the API.
- **Severity note:** requires a school admin to set it (UI prevents it), but it corrupts the credit ledger and reports (`credits_deducted -1.0` persisted); same family as M-1/M-4 which were fixed for packages but not for courses.

### Medium

#### SCH-R2-06 — Team invite accepts any `school_sub_role`; a member outside the matrix makes the section guard fail open — NEW
- **Where:** `backend/schools/views.py SchoolTeamView.post` (no validation of `school_sub_role`; `patch` validates against `allowed_roles`), `core/section_guard.py` ("ruolo fuori matrice: fail-open").
- **Repro:** admin `POST /school/team/ {"email":"qa-r2-school-temp1@uberip.com","name":"QA R2 Temp Uno","school_sub_role":"godmode"}` → 201; UI shows the raw role "godmode". After setup, temp1's token: `GET /school/team/` 200 (full roster), `GET /school/reports/` 200, `/school/transactions/` 200, `/school/packages/` 200, `/school/compensation-summary/` 200, `POST /school/team/` (invite another member) → **201**; `PATCH /school/profile/` settings → 403 (SchoolRole lookup fails closed there). Cleaned up (temp1 removed via UI, membership 26 deleted).

#### SCH-R2-07 — The first HQ-created account is `admin`, not `owner`: the school can never have an owner and owner-only protections are unreachable — NEW (design consequence)
- `POST /school/team/` / `PATCH` with `school_sub_role: "owner"` → 403 `only_owner_assigns_owner` for every admin (correct guard), and no HQ endpoint sets a membership sub_role (`api_hq.py`, `hq_views.py`: none). Result: **admin2 demoted the founder account (membership 16, `School.owner`) to staff → 200** (reverted) and could remove it with DELETE (guard only protects `sub_role == "owner"`). The Team legend shows a "Proprietario" role that nobody can hold; the invite dropdown never offers it.

#### SCH-R2-08 — School panel can mark attendance on lessons that have not happened (teacher endpoint blocks it); false "we missed you today" e-mail — NEW
- **Where:** `backend/bookings/attendance_views.py SchoolAttendanceView.post` has no `_lesson_datetime(lesson) > now` check (the teacher view returns `lesson_not_yet_occurred`).
- **Repro:** `POST /school/attendance/bf883237…/` (lesson 2026-09-23, booked by student2) `{"attendance":[{"student_id":…,"status_id":<Senza Colore QA, burns>}]}` → 200; roster `booking_status: no_show`; e-mail "👻 Du hast uns heute gefehlt" sent at 11:30:52 UTC for a lesson 16 days ahead; same call with the teacher token → 400 `lesson_not_yet_occurred`. (Reverted by re-marking with a non-absence status.)

#### SCH-R2-09 — Compensation payment can be recorded for a teacher of another school (cross-tenant reference + name leak) — NEW
- **Where:** `backend/teachers/views.py SchoolCompensationPaymentsSummaryView.post` (`update_or_create(school_id=…, teacher_id=<any>)`, no `TeacherSchool` check).
- **Repro:** admin `POST /school/compensation-summary/ {"teacher_id":"9c987f88-0f6b-4501-883e-927ac056990b" (QA Test School probe),"month":"2026-09","amount":5,"status":"paid"}` → **201** with `"teacher_name":"QA R2 TeacherProbe"`. Row deleted right after via `DELETE /school/compensation-payments/62a46f12…/` (204).

#### SCH-R2-10 — Staff dashboard shows fake zeros (403 swallowed) — NEW
- `dashboard/page.tsx` calls `/school/reports/` (section `reports`, not in the staff matrix) and `.catch(() => {})` → staff sees "STUDENTI ATTIVI 0 · RICAVO MENSILE €0.00 · …" with no hint (`school-dashboard-staff-it.png`, console `403 /api/school/reports/`). With real data the numbers are simply wrong for that role.

#### SCH-R2-11 — Deleting a student leaves `Lesson.current_bookings` stale (phantom seats) — NEW
- After SCH-R2-04's deletion: `GET /school/classes/bf883237…/` → `current_bookings: 1, enrollments: []`; past lesson 0cc95230 → `current_bookings: 2` with 1 enrollment; lessons-feed and the student calendar show 1/10 booked. Booking cascade-deletes rows without decrementing the counter.

#### SCH-R2-12 — `credits_used` KPI sums `credits_deducted` of cancelled/refunded bookings too — NEW
- `backend/commerce/report_views.py:130` `bookings.aggregate(Sum("credits_deducted"))` with no status filter. Live: `credits_used 12.5` when net used credits were 3.0 + the −1 anomaly (5 of 9 bookings were cancelled and refunded); after student2's deletion 6.5.

#### SCH-R2-13 — Reports page overflows horizontally on mobile — NEW
- 390px viewport: `scrollWidth 530 > clientWidth 390`, offender `TABLE.w-full` (lessons tab) — the body scrolls sideways (`school-mobile-reports-it.png`). All other 18 top-level pages are fine.

#### SCH-R2-14 — Closure days: schedules/classes on closed dates are dropped silently; class edits ignore closures — NEW
- Wizard: schedule "Singola 21/09 10:00" (closure day) → course created with the schedule silently gone, no message; recurring dates 21/09 and 05/10 correctly skipped. `POST /school/classes/` on a closure day → `{"created":0}` 200 (UI shows nothing). `PATCH /school/classes/{id}/ {"date":"2026-10-06"}` (inside the 05–09/10 closure) → 200 and the lesson lands on a closed day; booking it then fails with `school_closed` (enforcement OK) — so the school can create a lesson nobody can book.

#### SCH-R2-15 — Unhandled 500s on malformed ids/values — NEW
- `DELETE /school/students/delete/?student_user_id=x`, `PATCH /school/students/ {"school_student_id":"x"}`, `GET /school/students/detail/?student_id=x`, `POST /school/credits/grant/ {"student_id":"x"}` → **500** (UUID ValidationError not caught; courses/attendance with bad ids correctly 404). `POST /school/compensation-plans/{id}/simulate/ {"students":"abc"}` → **500** (`int()`).

#### SCH-R2-16 — Server-side validation gaps still open (grouped) — NEW (same class as fixed M-1/M-4/M-5)
- Packages: `validity_days: 0` → 201 (students see "Gültig für 0 Tage"); `weekly_booking_cap: -1` → 201 (storefront "bis zu -1 pro Woche", panel "max -1/settimana"); `allowed_lesson_types: ["00000000-…"]` (nonexistent) → 201. Rooms: `cost: -10` → 201. Closures: `end_date < date` → 201; `type: partial` without `from_time` → 201. Compensation plans (API): `base_fee: -5` → 201; `bonus_max_threshold < bonus_threshold` → 201 (UI blocks it). Profile: `cancellation_policy_hours: -5` → 200; `language: "xx"` → 200 (form only offers it/en/es). Discount codes: `max_uses: -1` → 201; code "  qar2 spaced " stored as "QAR2 SPACED". Course API: `credit_cost 0` → 1 silently, `1.25` → 1.3 (see SCH-R2-05 for negatives).

### Low

- **SCH-R2-17** L-1 bypass on the write path: staff `PATCH /school/profile/ {}` (or unknown field) → 200 and the response body includes `stripe_account_id`, `platform_fee_percentage`, `shop_commission_percentage`, `stripe_onboarding_complete` (hidden on GET). STILL OPEN variant of L-1.
- **SCH-R2-18** Locations UI: typing capacity `0` creates the room with **20** (`Number(x) || 20`, `locations/page.tsx:144,189`) instead of showing the server's "Capacity must be at least 1"; editing a room to `-3` shows "Impossibile salvare: potresti non avere i permessi per questa azione" for a 400 validation error. (L-3 server fix verified.)
- **SCH-R2-19** Credits modal amount input has `min="1"` (`AddCreditsModal.tsx:194`) — half credits cannot be granted from the UI although the API (and the domain rule) accept 0.5 (API 0.5 → 201 verified).
- **SCH-R2-20** i18n/copy: placeholder translations shipped as UI text — `auth.setup.welcomeDesc` = "Descrizione Benvenuto"/"Descripción de bienvenida"/"Description de bienvenue"/"Willkommensbeschreibung" (setup-account page, `school-setup-account-staff1-it.png`); `school.statuses.defaultStatusDesc`/`defaultBadge` = "Descrizione stato predefinito"/"Badge predefinito" (it/es/fr/de). Hardcoded English on non-English UI: Team remove `confirm()` "Are you sure you want to remove this team member?"; Teachers "Invitation resent to …" and raw error code `email_taken` in the edit modal; Compensation plan summary "€22/lesson · +€5/student (3–10 students)" and placeholders "e.g. Standard, Senior, Guest", "e.g. 5", "e.g. 9 (or leave empty)"; Packages placeholders "e.g. Starter Pack"/"Short description..." and backend messages "Credits must be greater than zero." shown verbatim; Courses empty state "No courses yet. / Create your first course"; wizard summary "from 14/09/2026 → …"; class edit "📍 In-Person"; calendar year view weekday initials "M T W T F S S"; CSV export headers in English; inbox timestamps in 12-hour "01:00 PM" format on the Italian UI; DRF throttle text "Request was throttled. Expected available in N seconds." shown raw on /de/register. Team legend labels "Proprietario" vs API label "Titolare".
- **SCH-R2-21** `GET /teacher/stats/` `lessons_upcoming` counts cancelled lessons (6 while 3 are scheduled).
- **SCH-R2-22** Course delete with a booked future lesson leaves the cancelled lesson with `course: null` (policy documented last round; it now shows in `/school/lessons/` and the Lessons page with an empty course). Bookingless future lessons are hard-deleted (verified twice, 0 orphans).
- **SCH-R2-23** Attendance statuses: duplicate names and several `is_default=true` statuses accepted (which one is pre-selected is undefined).
- **SCH-R2-24** `PATCH /school/teachers/{id}/ {"can_view_all_lessons":"false"}` → stays `true` (`bool("false")`).
- **SCH-R2-25** Teacher invited with an existing school admin e-mail silently becomes a multi-role account (`roles: ["school","teacher"]`, no e-mail) — reasonable, but the Teachers page gives no hint; removing the teacher link keeps the `teacher` role and RoleSwitcher.
- **SCH-R2-26** `student.account_deleted` e-mail copy assumes the student deleted herself ("es tut uns leid, dass du dich entschieden hast…") when the school did it.

---

## 3. Re-verification of prior-round findings (live evidence)

| Item | Verdict | Evidence |
|---|---|---|
| H-5 course `credit_cost` 1.5 truncated | **VERIFIED FIXED LIVE** | Wizard with 1.5 → `GET /school/courses/3b2e3659…/full/` `credit_cost: 1.5`; `PUT …/full/ {"credit_cost":2.5}` → 2.5; lessons-feed/student calendar show 1.5. (New gap: negatives, SCH-R2-05.) |
| H-6 all-lesson-types package create/duplicate | **VERIFIED FIXED LIVE** | `POST /school/packages/ {"lesson_type_restriction":"all","allowed_lesson_types":[]}` → 201 (c288abd5); duplicate POST → 201 (ac08c893); UI "Tutti i tipi di lezione" create → 201 (a1bb78e0) and UI "Duplica" → 201. Custom with empty list → 400 as designed. |
| H-7 staff rewriting identity fields | **VERIFIED FIXED LIVE** | staff `PATCH /school/profile/` name/website/email/cancellation/platform_fee → 403 `{"error":"forbidden","fields":[…]}`; admin identity PATCH → 200. Side effect: SCH-R2-01. |
| M-3 credit grant ≥100000 → 500 | **VERIFIED FIXED LIVE** | 100000 and 99999.95 → 400 `amount_too_large`; 99999.9 → 201; 0/−1 → 400; "abc" → 400 `invalid amount`. |
| M-4 package credits/price validation | **VERIFIED FIXED LIVE** | credits 0/−1 → 400 "Credits must be greater than zero."; price −1 → 400; 0.5 credits / price 0 → 201. |
| M-5 discount percentage range | **VERIFIED FIXED LIVE** | 0, 101, −1, 100.5 → 400; 50/100/0.5 → 201; PATCH 50→150 → 400; fixed −5/0 → 400; student check: 50% → amount_off 24.5, expired → `discount_code_expired`, inactive/unknown/cross-school → `invalid_discount_code`. |
| M-6 team invite e-mail locale | **VERIFIED FIXED LIVE** | Invites from the it school → "✉️ Sei stata invitata…" with `/it/setup-account` link (2 s delivery); resend with `locale:"de"` → German mail with `/de/` link; `School.language=de` + invite without locale → German mail; reverted to it. |
| M-7 locale cookie override | **VERIFIED FIXED LIVE (incidentally)** | 125 direct navigations with explicit `/xx/` prefixes across 5 locales never redirected (REDIRECT hits: 0). |
| School L-1 GET exposes Stripe/fee | **FIXED on GET / STILL OPEN via PATCH response** | staff GET hides the 4 fields; staff `PATCH {}` → 200 full body incl. `stripe_account_id`, `platform_fee_percentage` (SCH-R2-17). |
| School L-2 Duplicate swallows error | **NOT REPRODUCIBLE** | Duplicate now succeeds (H-6); validation errors from New/Duplicate render the backend text inline (in English — SCH-R2-20). |
| School L-3 room capacity negative | **VERIFIED FIXED LIVE (server)** | capacity 0/−5 → 400 "Capacity must be at least 1."; PATCH 0 → 400. UI still maps 0→20 (SCH-R2-18). |
| Course delete → ghost lessons | **VERIFIED** | 4 bookingless future courses deleted → 0 `course:null` lessons; booked future lesson → cancelled + refunded (0.5 back, "🚫 Lesson cancelled" 11:30:42 UTC) and kept as cancelled orphan (policy, SCH-R2-22). |
| Closure days enforced | **VERIFIED** | Generation: Mondays 21/09 and 05/10 skipped, single 21/09 not generated, single on 06/10 → 400 "No classes could be generated"; booking: lesson moved onto 06/10 → student `POST /bookings/` 400 `school_closed`. Gaps: SCH-R2-14. |
| Teacher e-mail collision → 400 | **VERIFIED FIXED LIVE** | `PATCH /school/teachers/{id}/ {"email":"qa-r2-school-b@uberip.com"}` → 400 `email_taken` (also case-insensitive); UI modal shows the raw code. |
| C-2 `burns_credit` semantics | **VERIFIED FIXED LIVE** | School attendance page: "Assente QA" (counts as absence ON) → `booking_status no_show / attendance no_show`, "Presente QA" → `attended / present`; lesson → `completed`; no-show e-mail "👻 We missed you today" 11:29:42 UTC. |
| C-3 not-yet-happened lessons in compensation | **VERIFIED FIXED LIVE** | `GET /school/teachers/{T1}/compensation/?month=2026-09` and `/teacher/compensation-overview/` list only the 01/09 lesson; 14/09, 18/09, 23/09 excluded; summary `lesson_count 1`. |
| H-8 documents_required names the document | **VERIFIED FIXED LIVE (API)** | `{"error":"documents_required","documents":["QA R2 Certificato medico"]}`; `student/book/page.tsx:471,523` interpolates `documents`. Booking blocked/allowed correctly with the toggle both ways. |
| admin cannot invite/promote owner | **VERIFIED** | POST and PATCH → 403 `only_owner_assigns_owner`; dropdown offers only Amministratore/Staff. |
| self-removal / cross-tenant membership ids | **VERIFIED** | DELETE own membership → 400 `cannot_remove_self`; PATCH/DELETE membership 17 (other school) → 404. |

---

## 4. E-mails verified (all from "Danza Classica No Under 40" <support@alinaquintana.com>, delivery ≤ 3 s)

| Trigger (UTC) | Recipient | Arrived | Subject | Locale | Link |
|---|---|---|---|---|---|
| Team invite staff (UI) 10:10:19 | qa-r2-school-staff1 | 10:10:21 | ✉️ Sei stata invitata nel team di Danza Classica No Under 40 | it ✓ (School.language) | /it/setup-account → completed ✓; reuse → "Questo link è scaduto…" ✓ |
| Team invite admin (UI) 10:10:22 | qa-r2-school-admin2 | 10:10:23 | same | it ✓ | completed ✓ |
| Resend `locale:"de"` (API) 10:10:58 | qa-r2-school-staff1 | 10:10:59 | ✉️ Du bist ins Team … eingeladen | de ✓ | /de/setup-account |
| Invite temp1 (API, role godmode) 10:13:47 / UI "Rinvia" 10:14:41 | qa-r2-school-temp1 | 10:13:48 / 10:14:43 | Sei stata invitata… | it ✓ | completed via API ✓ |
| Team modal "Invia reset password" 10:14:44 | qa-r2-school-staff1 | 10:14:45 | 🔑 Reimposta la tua password | it ✓ | /it/reset-password → new password set, landed on dashboard ✓ |
| Teacher invite ×2 (UI) 10:17:23/27 | teacher1 / teacher2 | 10:17:24 / 10:17:28 | Sei stata invitata… | it ✓ (UI locale) | teacher1 completed → /it/teacher/dashboard shows "QA R2 School B" ✓ |
| Teacher "Rinvia invito" (UI) 10:19:38 | qa-r2-school-teacher2 | 10:19:39 | Sei stata invitata… | it ✓ | — |
| School.language=de + invite (API) 10:36:02 | qa-r2-school-temp3 | 10:36:03 | Du bist ins Team … eingeladen | de ✓ | — (membership deleted) |
| Register /en (UI) 11:16:37 | qa-r2-school-student1 | 11:16:40 | 🩰 Welcome to Danza Classica No Under 40! | en ✓ | /en/student/profile |
| Register /de (UI) 11:16:43 | qa-r2-school-student2 | 11:16:46 | 🩰 Willkommen bei … | de ✓ | /de/student/profile |
| Bookings (API) 11:18–11:27 | student1 (en) / student2 (de) / school inbox (it) | ≤2 s | ✅ Booking confirmed / ✅ Buchung bestätigt / 📅 Nuova prenotazione | ✓ each in own language | — |
| Student cancellations 11:23 | student1 / school | ≤1 s | ❌ Booking cancelled / ❌ Prenotazione annullata | ✓ | — |
| Course window shortened (API confirm) 11:28:29 | qa-r2-school-student2 | 11:28:30/31 | 🚫 Stunde abgesagt (28-09, 12-10) | de ✓ | — |
| Attendance "Assente QA" (UI) 11:29:41 | qa-r2-school-student1 | 11:29:42 | 👻 We missed you today | en ✓ | — |
| Lesson cancel (UI) 11:29:47 | qa-r2-school-student1 | 11:29:51 | 🚫 Lesson cancelled (16-09) | en ✓ | — |
| Course delete with booking (API) 11:30:41 | qa-r2-school-student1 | 11:30:42 | 🚫 Lesson cancelled (05-11) | en ✓ | — |
| School attendance on FUTURE lesson (API) 11:30:51 | qa-r2-school-student2 | 11:30:52 | 👻 Du hast uns heute gefehlt | de ✓ (but false — SCH-R2-08) | — |
| Staff deletes student (API) 11:32:39 | qa-r2-school-student2 | 11:32:41 | 🕊️ Dein Konto wurde gelöscht | de ✓ | — |
| Stripe `school.stripe_connected` | qa-r2-school-b | **not received** (onboarding not completable, §7) | — | — | — |

No e-mail expected by a flow failed to arrive. Not triggered on purpose: student reset-password from the Students page (coordinator budget ≤1 reset; the Team-modal reset was used instead).

---

## 5. Test data created (tenant QA R2 School B — all left in place unless noted)

- **Team memberships:** 16 admin (qa-r2-school-b, School.owner), 21 staff (staff1, phone +39 333 1234567), 22 admin (admin2). Removed: temp1 (godmode, id 25), 26 (temp2 pending, created by temp1), 28 (temp3, staff). Owner-invite attempt qa-r2-school-owner-x@uberip.com rejected (nothing created).
- **Teachers:** 5402afd1 Teacher Uno QA R2 (active, both staff grants ON), 71048c65 Teacher Due QA R2 (invite pending, phone +39 333 0000002). Teacher link 417bafe8 (admin2 as teacher) created then removed via UI; admin2 keeps roles `school,teacher`.
- **Location:** bca1511c "QA R2 Sede Centrale" (Via Dante 5, 20121 Milano) with rooms babd4e88 Sala Grande (12, €20) and f022ff89 Sala Piccola (6). Probe location 912d9aa4 + rooms deleted.
- **Closures:** 883b9ad1 2026-09-21, ec321bbd 2026-10-05→09. Deleted: bad-range, partial, Natale.
- **Compensation plans:** 366985cc "QA R2 Piano Base" (€22, threshold 3, +€5/student, max 10), 54bf65fa "QA R2 Piano Flat" (€25.5). Deleted: junk "20", Temp, Bad, Bad2. Payment 9ab4ef35 teacher1 2026-09 €0 paid (bank_transfer). Cross-tenant payment 62a46f12 created and deleted.
- **Courses:** 3b2e3659 (main, 1.5 credits, plan Base, Sala Grande, teacher1) with lessons 0cc95230 01/09 11:00 (completed, attendance marked), e68ad889 14/09 (student1 booked dcca68bd), ff7a56f6 16/09 (cancelled via UI), cf642cd4 18/09 11:30 (plan Flat), bf883237 23/09 12:00 (attendance row for the deleted student2, stale counter 1), f1afb8bd 28/09 + 49982b0b 12/10 (cancelled by window shortening; window end now 27/09). Deleted courses: c270c49d (−1 credit), 2a5603c6 (0.5; orphan cancelled lesson 3e463556 05/11 remains), f3951e8e, c3120616, cb68a407 (staff-created).
- **Attendance statuses:** 885427ae Presente QA (#16a34a, default), 85c5c2d9 Assente QA (#dc2626, absence), 4ea09a59 Giustificata QA (#22c55e), 46848ed3 Senza Colore QA (no colour, absence). Deleted: duplicate Presente QA, Default2 QA.
- **Packages (12):** 56bdec97 QA R2 API Pack (0.5 cr €0, custom), 2a4467c4 copy, 8ee59032 V0 (validity 0), adf5f22a API DropIn, 0d995449 QA R2 Lezione Singola (drop-in, UI), 037b1bb0 API Monthly (recurring), 4d4345b1 QA R2 Abbonamento Mensile (recurring, UI, it name only), bd2593e2 BadLT, 0dd573fe Cap (−1), ac08c893 All Types (copy), c288abd5 All Types (inactive), a1bb78e0 QA R2 Pacchetto Tutti 12.5 (inactive).
- **Discount codes:** QAR2PCT50, QAR2PCT100, QAR2PCT0.5, QAR2EXPIRED, QAR2ONCE, QAR2NEGUSES, "QAR2 SPACED" (QAR2FIX5 deleted).
- **Document types:** a36ba39c "QA R2 Certificato medico" (required, expiry, variants), 224870a6 "QA R2 Liberatoria". Deleted: duplicate, staff-created "x".
- **Quick replies:** cc5afc43 "QA R2 Saluto" (admin), c5711a39 "QA R2 Staff QR" (staff).
- **Students:** student1 cf8765c1 (user 1b48d805; manual grants 0.5 + 99999.9 + doc 0d9b44bb valid; balance 99996.9; bookings: 14/09 confirmed, 01/09 no_show, 3 cancelled). student2 (user 514746d2) **deleted** at 11:32 with its 5 grants/bookings.
- **Chat:** d11b0a6f school↔teacher1 (status resolved/high), cad7ee3c school↔student1.
- **Stripe:** Connect account `acct_1UCzvz32iRNheSwY` created on the platform (test mode), onboarding incomplete.
- **School profile:** website `https://qa-r2-school-b.example.test`, VAT `IT12345678901`, city back to "Milano", `block_booking_on_documents=false`, language it, cancellation 24 h, notice 2 h.
- **Ledger:** 3 throttled registration attempts (10:28–10:34), 2 successful at 11:16:37/43; 1 password reset 10:14:44.

---

## 6. Not tested and why

- **Stripe Connect onboarding beyond step 1:** `POST /api/stripe/onboard/` works (account created, `status: connected true / onboarding_complete false`, "Continua l'Onboarding" re-issues a fresh link, `?onboard=refresh` banner OK). Stripe's hosted page ("Hakan Sandbox", test mode) accepts "Usa numero di telefono di test" but pressing "Invia" opens an **hCaptcha image challenge** (`school-stripe-captcha.png`); its "Salta" only reloads the challenge. Four heuristic walks (≈30 min, time-boxed) never got past it in headless Chromium, so the phone/OTP/identity/IBAN steps and the `school.stripe_connected` e-mail could not be exercised. Observations on the Stripe page: phone country defaults to +34 for an Italian school, and Stripe's own Italian copy shows a raw `<PrivacyPolicyLink>` tag (third-party).
- **Student "Ripristina password" action** (Students page): skipped on purpose (coordinator budget ≤1 reset; the Team-modal reset was used). API-level guards checked without sending mail (unknown student → 404).
- **Credits modal half-credit and grant submission via UI:** the modal's amount input was inspected (`min="1"`, SCH-R2-19) but the automated submit kept failing on overlay handling; grants were verified via API and the resulting list on the Credits page.
- **Real purchases/transactions/refunds:** no Stripe checkout possible without a completed Connect account; Payments page verified in its empty state only; usage-limit counting of discount codes (`max_uses`) needs a checkout.
- **Recurring-package renewal, waitlist, PWA push:** out of scope / conscious gaps per CLAUDE.md §10.
- **Owner role behaviour:** no owner can exist for this tenant (SCH-R2-07), so owner-specific paths were exercised only from the admin side.
- **Mobile drawer navigation:** the burger click did not open the drawer in the automated run (selector ambiguity); layouts of all 19 top-level pages were checked for overflow instead.

---

## 7. Assumptions / decisions

- The tenant was built strictly through product flows (UI or the same REST calls); nothing outside `ab51f9ff…` was mutated. The two cross-tenant probes (membership 17, teacher 9c987f88 of QA Test School) were read-only except SCH-R2-09, whose row was deleted immediately.
- Severity calls: SCH-R2-04 rated High (destructive, irreversible, lowest role) rather than Critical because it is within the HQ-defined matrix ("students" section) and not a guard bypass; SCH-R2-05 rated High because it corrupts the credit ledger, although only an admin can set a negative cost.
- The 99999.9-credit grant to student1 (M-3 boundary test) was left in place (no delete endpoint for a StudentPackage from the School panel).
- Registration/login throttling (429) is treated as an environment effect of the shared IP (documented once in SCH-R2-20 for the raw message only).
- The godmode-member repro completed the invite via API (not UI) to avoid a third `setup-account` UI loop; the fail-open behaviour was cross-checked with fresh tokens.
- Attendance on the past lesson was made possible by staff-enrolling the two students on the already-occurred 01/09 class (`POST /school/classes/{id}/students/` allows past lessons — noted, not rated).

---

## 8. Screenshot index (all under `$SP/shots/`)

Team: school-team-before-invite-it, school-team-after-invites-it, school-team-pending-resend-it, school-team-edit-modal-it, school-team-edit-modal-reset-sent-it, school-team-after-remove-it · Setup/reset: school-setup-account-staff1-it, school-setup-account-admin2-it, school-dashboard-after-setup-staff1-it, school-dashboard-after-setup-admin2-it, school-reset-password-page-it, school-dashboard-staff-it · Teachers: school-teachers-empty-it, school-teacher-invite-form-it, school-teachers-list-it, school-teachers-grants-on-it, school-teachers-edit-email-collision-it, school-teachers-resend-msg-it, school-teachers-after-remove-it, school-teacher1-dashboard-after-setup-it · Locations: school-locations-empty-it, school-locations-room-cap0-it, school-locations-final-it · Compensation: school-compensation-empty-it, school-compensation-plan-form-error-it, school-compensation-plans-it, school-compensation-payments-it · Courses: school-courses-empty-it, school-course-wizard-step1-it, school-course-wizard-step2-it, school-courses-list-it, school-course-detail-it, school-course-detail-after-add-it, school-class-edit-it, school-lessons-it, school-lessons-cancel-confirm-it, school-lessons-after-cancel-it · Calendar: school-calendar-week-it, -giorno-, -mese-, -anno-, school-calendar-lesson-popup-it, school-calendar-add-class-it · Packages: school-packages-list-it, school-packages-form-it, school-packages-after-create-all-it, school-packages-validation-it, school-packages-final-it · Statuses: school-statuses-empty-it, school-statuses-list-it · Settings/Profile: school-settings-it, school-settings-after-save-it, school-settings-closures-it, school-profile-it · Students/Credits/Docs: school-students-it, school-students-list-it, school-credits-it, school-credits-modal-it, school-documents-it, school-documents-with-doc-it, school-documents-sheet-it, school-documents-sheet-after-it · Attendance: school-attendance-page-it, school-attendance-marked-it, school-attendance-submitted-it · Inbox: school-inbox-it, school-inbox-conversation-it, school-inbox-quick-replies-it, school-inbox-student-conv-it · Payments/Stripe: school-payments-it, school-payments-before-stripe-it, school-stripe-s1, school-stripe-w4s1…w4s4, school-stripe-captcha, school-stripe-after-salta (+ w2/w3 series) · Reports: school-reports-it · Students side: school-register-en/de, school-student-dashboard-after-register-en/de, school-student2-buy-de, school-student2-book-de, school-student2-lesson-modal-de · Mobile: school-mobile-<page>-it ×19, school-mobile-drawer-it.

Locale text dumps: `$SP/school/i18n/<locale>-<page>.txt` (125 files, automated scan found no raw i18n keys / `undefined` / `NaN` / un-interpolated placeholders on any page).
