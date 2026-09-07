> Round-2 live regression, 2026-09-07 — per-panel detail report written by the teacher QA agent. Entry point: [QA_REGRESSION_ROUND2_SUMMARY.md](QA_REGRESSION_ROUND2_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…` or `$SP/reports/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round2-screenshots/](docs/qa/round2-screenshots/).

# QA Regression Round 2 — Teacher Panel

- **Agent:** teacher-agent · Playwright profile `teacher-agent` · inbox prefix `qa-r2-teacher-`
- **Environment:** https://dev.danzaclassicanounder40.com (develop @ 8153889), server clock UTC
- **Time window:** 2026-09-07 10:09 – 10:50 UTC
- **Tenant:** QA R2 School C `c2660d22-66f2-4703-90b9-b23ccc19db18` (admin `qa-r2-school-c@uberip.com`, lang it). Nothing outside this tenant was mutated except: two HQ-owned Library rows created by `qa.hq.owner` and **deleted again**, and one `teacher_support` chat thread (T1 ↔ HQ) left in place as evidence.
- **Accounts created/used (all password `QaRound2!2026` unless noted):**
  - T1 `qa-r2-teacher-t1@uberip.com` — teacher_id `6f716021-1865-4866-a85b-3071eaac4c74`, user `dc941312-22ff-4f47-9c5d-de642e8896b8` (main; onboarded through the UI)
  - T2 `qa-r2-teacher-t2@uberip.com` — teacher_id `44b96436-1fe7-48e6-bfb2-bfb656f70eae`, user `4e61d605-d354-41a2-ac0e-cf938f0b657d` (isolation; onboarded via API)
  - S1 `qa-r2-teacher-s1@uberip.com` (it) student_id `82b4a514-fa9d-4b9b-b370-199bd9c3c0fc`; S2 `qa-r2-teacher-s2@uberip.com` (en) `a238b53a-0f76-4328-9261-ccac9fabf937`; S3 = coordinator's `qa-r2-mailprobe@uberip.com` (it) `fa930669-4212-4fa8-a5a1-995f037f1441`, linked to School C by me
  - `qa.hq.owner@qa-nounder40.test` (read + Library fixtures + one chat reply), `qa-r2-school-c@uberip.com` (all school-side setup)
- **Method:** every UI observation cross-checked with a curl/fetch call using my own JWT; `whoAmI()` checked before trusting any page. Playwright Chromium headless, desktop 1366×900 and mobile 390×844.

---

## 1. Coverage table

| Page / route | As | Locales (desktop) | Mobile | Result |
|---|---|---|---|---|
| School → Teachers → Invite (`/it/school/teachers/invite`) | School C admin | it | – | PASS (T1, T2 invited through the form; IT emails in ≤12 s) |
| `/it/setup-account` (real link, garbage uid/token, reused link) | T1 | it | – | PASS; **placeholder copy** (TCH-R2-04) |
| First login journey (UI form) | T1 | it | – | PASS — lands on `/it/teacher/dashboard` (single role, no select-role) |
| Teacher Dashboard | T1 | en it es fr de | it | PASS (today/next-7-days/plan widgets = API) |
| Calendar (day/week/month/year, prev/next, lesson popup) | T1 | en it es fr de (+ interaction it, de) | it | PASS; year-view weekday initials hardcoded EN (TCH-R2-08) |
| Attendance list (Today / Upcoming / Past, Done vs Mark) | T1 | en it es fr de | it | PASS (M-3 verified) |
| Attendance register (mark, colourless status, save, redirect, re-mark, empty roster, future lesson, unknown id) | T1 | en it es fr de (+ interaction it) | it | PASS with Low copy issues (TCH-R2-07/08); API: TCH-R2-03, TCH-R2-06 |
| Performance | T1, T2 | en it es fr de | it | PASS numbers (hand-derived); **stats attribution bug with staff marking** (TCH-R2-02); "Present/No-show" EN (prior L3 open) |
| Compensation (month nav, badges, per-school, bonus) | T1, T2 | en it es fr de | it | PASS (C-3, M-4 verified; totals = Performance = school summary) |
| Library (filters, empty state, video playback, broken video, PDF, untitled) | T1 | en it es fr de (+ interaction it) | it | PASS (H-3 verified); filter `<option>`s EN (TCH-R2-08) |
| Inbox (list, tabs, New Message, thread, reply, unread badge) | T1 + School C + HQ owner | en it es fr de (+ interaction it) | it | Functionally PASS; **Critical visibility leak on the API** (TCH-R2-01) |
| Profile (name/phone/bio/photo/email, "My school" card) | T1 | en it es fr de (+ interaction it) | it | PASS (H-4 verified); raw `email_taken` shown (TCH-R2-08); API accepts empty first name (TCH-R2-12) |
| Password change | T1/T2 | – | – | Endpoint works; **no UI anywhere in the frontend** (L-4 still open) |
| Forgot password (login page → email → reset page → auto-login → link reuse) | T1 | it | – | PASS |
| Staff teacher feature (grants via school switches, scope toggle, colleague register, add/remove, revoke) | School C admin, T1, T2 | it (+ staff strings en es fr de) | – | PASS functionally; TCH-R2-02, TCH-R2-05 |
| Role isolation (T1 token vs /api/hq/*, /api/school/*, /api/student/*, booking, self-grant) | T1, T2, S1, School C | – | – | PASS (clean 403/401) — except chat (TCH-R2-01) |

No console errors and no 5xx responses on any teacher page in any locale/viewport; no horizontal overflow on mobile. Raw-key / `{placeholder}` / `undefined|NaN|null` scan over all 54 text dumps (`$SP/teacher/text/`): zero hits.

---

## 2. Findings

### CRITICAL

#### TCH-R2-01 — Any teacher of a school can list, read, answer, mark-read and resolve every conversation of that school, including private student↔school chats — NEW
- **Where:** `backend/chat/views.py` — `_role_context()` (resolves `school_id` for a teacher linked to exactly one school) + `visible_conversations()` (`q |= Conversation.objects.filter(school_id=school_id)`), used by `ConversationViewSet.get_queryset()`, `messages`, `read`, `UnreadCountView`. `ConversationViewSet` is a full `ModelViewSet` so PATCH is open too. The teacher UI only requests `?type=school_teacher|teacher_support`, which hides the problem visually, but the API and the unread counter are wide open.
- **Repro (all with fresh, isolated tokens, School C only):**
  1. T1 creates a `school_teacher` thread via the UI → `dd44963a-82e7-4eee-aa0a-8925078c4282`.
  2. T2 (plain teacher, no grants) `GET /api/chat/conversations/` → **200 `["dd44963a…"]`**; `GET …/dd44963a…/messages/` → 200 with T1's text; `POST …/messages/ {"content":"QA R2 T2 intruding…"}` → **201**; `POST …/read/` → `{"marked_read":2}`; `PATCH /api/chat/conversations/dd44963a…/ {"status":"resolved"}` → **200**.
  3. S1 (student) opens a `school_student` thread with School C (`ed8ad14d-a351-440f-adb5-598c973235f6`) and writes "…my medical certificate expires, phone 333 0000000".
  4. T1 and T2 both list it (`GET /api/chat/conversations/` unfiltered → 3 threads incl. `school_student QA R2 Studente S1 … medical certificate…`); T2 `GET …/ed8ad14d…/messages/` → **200 with the student's message**; T2 `POST` a reply → **201**, and S1 then sees `teacher: "QA R2 T2 answering a student chat she should not see"` in her own chat.
  5. `GET /api/chat/unread/` as T2 → `{"total":2,"by_conversation":{"dd44963a…":2},"by_type":{"school_teacher":2}}` (T1's thread) and later `{"total":1,…"school_student":1}` → phantom badge in T2's sidebar.
  6. Only `DELETE /api/chat/messages/<id>/` was refused (403).
- **Expected:** a teacher sees only threads where `teacher = self` (her `school_teacher` thread and her `teacher_support` thread), never other teachers' threads nor student↔school threads; unread counts likewise.
- **Impact:** cross-role data leak inside the tenant (student PII/medical info readable and answerable by every teacher; teachers reading each other's private exchanges with the school), plus wrong unread badges. HQ-side `teacher_support` threads are correctly invisible to the school (0 rows).
- **Evidence:** run log of `$SP/pw` chat probe (10:33–10:34 UTC), thread ids above; T2's intrusion messages left in both threads as evidence.

### HIGH

#### TCH-R2-02 — Attendance marked by a "staff" teacher on a colleague's lesson is counted in the *marker's* Performance stats, not the lesson teacher's — NEW (introduced by 0b45f05)
- **Where:** `backend/teachers/views.py` `TeacherStatsView.get()` — `attendance = Attendance.objects.filter(teacher=teacher)` (Attendance.teacher = whoever marked, see `TeacherAttendanceView.post()` comment "Recorded under whoever marks … compensation and stats keep following Lesson.teacher"). Compensation does follow `Lesson.teacher`; the stats view does not.
- **Repro:** grant T1 both switches. T1 `POST /api/teacher/attendance/0e0d8d33…/` (T2's yesterday lesson) `[S1 Presente, S2 Assente]` → 200.
  - T2 `GET /api/teacher/stats/` before → `{"lessons_taught":1,"attendance_marked":0,…}`; **after → unchanged** `attendance_marked: 0, present: 0, attendance_rate: null` although her own lesson now has 2 marks.
  - T1 before → `{"attendance_marked":4,"present":2,"no_show":1,"attendance_rate":0.75}`; **after → `{"attendance_marked":6,"present":2,"no_show":2,"attendance_rate":0.667}`** (T2's students counted as T1's no-shows/attendance).
  - Compensation is correct on both sides: T1 total stayed €60 (L2_YEST absent), T2's overview shows `students: 1` for that lesson.
- **Impact:** silently wrong attendance KPIs for both teachers whenever a school uses the staff feature (the lesson teacher's Performance page never reflects her own lessons; the staff teacher's no-show rate is polluted).

### MEDIUM

#### TCH-R2-03 — Attendance POST silently accepts an unknown/foreign `status_id` and records the student as *present* with no status reference — NEW
- **Where:** `backend/bookings/attendance_views.py:84-92` `_apply_marks()` — `status_ref = AttendanceStatus.objects.filter(pk=…, school=lesson.school).first()`; when it is `None` the code derives `PRESENT` and saves `status_ref=None` instead of rejecting the row.
- **Repro:** `POST /api/teacher/attendance/711226b7…/ [{"student_id":"82b4a514…","status_id":"00000000-0000-0000-0000-0000000000aa"}]` → **200 `{"results":[{"ok":true}]}`**, roster row → `booking_status: attended, attendance_status: present, attendance_status_id: null` (it overwrote the previous "QA R2 Ritardo" mark).
- **Realistic trigger:** the school deletes/renames a status while a teacher has the register open; also any foreign school's status id. **Expected:** 400 `invalid_status_id` per row (like `student_not_found`).

#### TCH-R2-04 — `/setup-account` shows placeholder copy in it/es/fr/de — NEW
- **Where:** `frontend/messages/{it,es,fr,de}.json` key `auth.setup.welcomeDesc` = "Descrizione Benvenuto" / "Descripción de bienvenida" / "Description de bienvenue" / "Willkommensbeschreibung" (en: "Just a few details and you'll be ready to go."). Rendered under the "Benvenuto" heading on every invited user's first page (teachers, school staff, HQ members).
- **Evidence:** `$SP/shots/teacher-setup-t1real-filled.png`, text dump "Benvenuto / Descrizione Benvenuto".

#### TCH-R2-05 — Staff "add a student" (and the school manual enrolment it shares) ignores lesson capacity — NEW (design observation, decision needed)
- **Where:** `backend/bookings/services.py` `staff_enrol()` (comment: "no minimum notice, closure, capacity or document checks — whoever is at the desk decides").
- **Repro:** lesson `6b5cd63b…` cap 2 with S1+S2 booked; S3 self-booking → `400 full` (correct); T1 (grant on) `POST /api/teacher/attendance/6b5cd63b…/students/ {"student_id": S3}` → **200, `current_bookings: 3`**, school class detail shows `cap 2 current 3`. No warning in the UI or the response. Reverted by removing S3.
- **Note:** consistent with the documented intent, but the teacher UI gives no hint that the room is over capacity; flagging for a product decision (soft warning or hard stop).

### LOW

#### TCH-R2-06 — Malformed attendance body returns HTTP 500 — NEW
- `POST /api/teacher/attendance/<id>/` with body `"hello"` (a JSON string) → **500 Server Error** page (`request.data.get` on a `str` in `TeacherAttendanceView.post()`; the school endpoint shares the code). Any authenticated teacher can trigger it; no data impact.

#### TCH-R2-07 — Register offers "Mark" for future lessons and then shows the raw error code — NEW
- Attendance list shows a "Registra"/"Mark" button for tomorrow's and later-today lessons; saving shows literally `lesson_not_yet_occurred` (register page `setError(body?.error ?? …)`), `$SP/shots/teacher-register-it-tomorrow-error.png`. The empty-roster case shows only the generic subtitle ("Segna presenti e assenti per questa lezione.") with no Save button — no explicit "no students booked" state.

#### TCH-R2-08 — Hardcoded English / untranslated strings in the teacher panel — NEW (+ prior L3 STILL OPEN)
- Register: "Lesson not found." (seen live on `/it/teacher/attendance/<bad id>`), "No attendance statuses configured. Ask your school admin…".
- Performance: "Present" / "No-show" breakdown rows and "Teacher profile not found." (prior-round L3 — **still open**; seen on it/es/fr/de dumps).
- Library: filter `<option>` labels Video/PDF/Entry/Intermediate/Advanced/English/Italian/French/Spanish, "Loading...", "Done", "No video URL available.", "% watched" — all locales (`$SP/shots/teacher-es-library.png`).
- Calendar year view: weekday initials `['M','T','W','T','F','S','S']` (`frontend/src/app/[locale]/teacher/calendar/page.tsx:379`) — rendered "MTWTFSS" in it and de (`$SP/shots/teacher-calendar-it-year.png`).
- Inbox: "Loading…", "Conversation not found.", `'School'` fallback; Profile: raw `email_taken` in the error banner (`$SP/shots/teacher-profile-it-email-collision.png`).
- Auth: DRF throttle text "Request was throttled. Expected available in N seconds." surfaces verbatim on the localized `/es/register` page (see §8 on the throttle itself).

#### TCH-R2-09 — Teacher invite email is the generic "team" invite: it never names the inviting school or the teacher role — NEW
- Subject "✉️ Sei stata invitata nel team di Danza Classica No Under 40", body "sei stata invitata a far parte del team di Danza Classica No Under 40" (same `team_invite` template as HQ/school-team invites). A teacher invited by "QA R2 School C" cannot tell which school invited her. Locale (it) and link were correct.

#### TCH-R2-10 — No-show email says "today" regardless of the lesson date — NEW
- Marking S2 absent on the 6 Sept lesson on 7 Sept produced "👻 We missed you today — QA R2 Corso Base T1 … we didn't see you in the studio today for … (06-09-2026, 10:00)". The date in the body is right; the "today" wording is not. Re-marking a no-show a second time (via the UI) sent the email again (10:19:14 and 10:24:57 for two different lessons; expected per lesson, noted for completeness).

#### TCH-R2-11 — Profile API accepts an empty first name — NEW
- `PATCH /api/teacher/profile/ {"first_name":""}` → 200, `name` becomes "Teacher T1" (last name only); the UI input is `required` but the API is not. Also: `bio` accepts raw HTML/5000 chars (rendered as text in the teacher panel; where the bio is shown to students was not in my scope).

#### TCH-R2-12 — Compensation pays the base fee for a past lesson with zero bookings and no attendance marked — policy question
- Lesson `7408d12c…` (yesterday 08:00, never marked, 0 students, status still `scheduled`) appears in `compensation-overview` with `students: 0, fee: 20.0, threshold_gap: 3` and inflates the month total. Consistent with `compute_lesson_fee()` (base fee per lesson) — flagging because the prior round's C-2 evidence used exactly this shape ("no student was even booked"); the time-boundary part is fixed, the "empty lesson still pays" part is unchanged and may be intended.

#### TCH-R2-13 — Past-lesson booking is refused with `min_notice`, and the public lesson list still shows today's already-past lesson — NEW
- S1 `POST /api/bookings/ {"lesson": <yesterday 08:00>}` → `400 {"error":"min_notice"}` (refused, correct outcome, misleading reason). `GET /api/student/lessons/?school_id=C` still lists `2026-09-07 06:00` after it happened (`date__gte=today` filter only).

#### TCH-R2-14 — No password-change UI in the whole frontend (prior L-4) — STILL OPEN
- `grep -rln "change-password" frontend/src` → no hits. `POST /api/auth/change-password/` works (wrong current → 400, weak → 400 with validator messages, ok → 200, old password refused afterwards). The welcome email tells students they can "change your password from your personal space" — they can't; the only path is forgot-password.

---

## 3. Verified correct (live evidence, no finding)

- **Attendance semantics (C-2):** status with *counts as absence* ON → `booking_status: no_show`, `attendance_status: no_show` (+ no-show email); OFF (incl. colourless "Ritardo" and "Excused") → `attended/present`. Confirmed from the teacher API, the school API (`GET /api/school/attendance/4d79f33d…/`), the school student detail, Performance (no_show 1) and Compensation (absent student excluded from the headcount: lesson with 1 present + 1 absent → `students: 1`).
- **Timing boundary:** later-today (22:30 UTC) and tomorrow → `400 lesson_not_yet_occurred`; earlier today (06:00 UTC) and yesterday → 200; other teacher's lesson → `404 lesson_not_found` (GET and POST); random uuid → 404; marks flip the lesson to `completed`; re-marking is idempotent (`update_or_create`, `marked_at` updated, `already_submitted` flips).
- **Performance (C-4, M-5):** `lessons_taught` = 4 = 2 yesterday + 1 earlier today + 1 bonus lesson (later-today excluded) — hand-derived; `lessons_upcoming` 5; "Students followed" = **distinct** students (3 with 9 attendance rows); rates rendered as `%`; breakdown heading "Dettaglio/Desglose/Répartition/Aufschlüsselung" (M-2).
- **Compensation (C-3, M-4):** month total €85 = 3 × €20 base + €25 (3 present > threshold 2 → +1 × €5, `has_bonus: true`, `bonus_lessons: 1`); later-today and future lessons excluded on both `/teacher/compensation-overview/` and `/teacher/compensation/`; the school's `/school/compensation-summary/` shows the same 4 lessons / 1 bonus / €85 for T1 and €0 for T2 (no plan → "Nessun piano" pill); all strings translated in 5 locales ("In attesa", "3 al bonus", "0 con bonus", …); month navigation and "Oggi" work; 6-month trend shows only Sept.
- **Colour fallback (M-1):** selected colourless button computed style `background rgb(107,114,128), color #fff`, pill `rgba(107,114,128,0.125)`; coloured statuses use their own colour (`$SP/shots/teacher-register-it-yesterday.png`).
- **Past section (M-3):** "PASSATE/Past" lists yesterday's lessons within the 60-day window (8153889), marked ones show "Fatto/Done", unmarked "Registra/Mark".
- **Library (H-3):** deployed CSP header contains `media-src 'self' https:`; a public WebM plays (`currentTime 3.58 s, readyState 4, error null`); an unreachable URL and the seed `example.test` items show the visible red error box ("Impossibile caricare questo video…"); PDF opens in a new tab (`https://www.w3.org/…/dummy.pdf`); filters work; empty state "Nessun Contenuto"; blank-title seed items show "Senza titolo / Sin título" (L-1 verified).
- **Profile (H-4):** email change updates the login credential (new email → 200, old → 401), collision with T2's email → `400 email_taken`; photo upload → `/media/public/teacher-photos/…png` served 200; "La mia scuola — QA R2 School C — Milano" card, no compensation plan on the card (dashboard has the plan widget with tooltip).
- **Onboarding:** invite via the school form (IT success banner), IT invite emails with `/it/setup-account?uid&token` in ≤12 s, setup page validates names/passwords, garbage or reused link → "Questo link è scaduto o è già stato utilizzato." (API: `invalid_link` / `invalid_or_expired_token`, weak password → `weak_password` and the token survives), completion lands directly on `/it/teacher/dashboard`, `complete-invite` returns tokens.
- **Forgot password:** login page "Password dimenticata" → `POST /auth/password-reset/ {"found":true}` → IT email "🔑 Reimposta la tua password" in 3 s → reset page → auto-login to `/it/teacher/dashboard`; old password 401, new 200; reused link → `/it/login?error=reset_expired`.
- **Calendar:** week/day/month/year headers and popup dates follow the locale (it "lunedì 7 settembre 2026", de "Montag, 7. September"); popup shows Data/Orario/Scuola/Aula/Prenotazioni, "Completata" badge, "Registra presenze" link to the right lesson; mobile defaults to day view.
- **Inbox:** New Message creates `school_teacher` / `teacher_support` threads visible to School C (`teacher_name` set) and to the HQ owner; replies arrive; internal notes stay hidden from the teacher; unread `{total:2}` → sidebar badge → 0 after opening; second "New Message" reopens the existing open thread instead of creating a duplicate.
- **Staff feature (0b45f05):** switches on `/it/school/teachers` PATCH `can_view_all_lessons` / `can_manage_bookings` (persist after reload; T2's stay off); with grants T1's `/teacher/lessons/` returns 10 lessons (T1+T2) and `?scope=mine` 8; calendar/attendance show the "Le mie lezioni / Tutte le lezioni" toggle (remembered in `nu40_teacher_scope`), colleague lessons carry "👤 QA R2 Teacher T2" and "Insegnante" in the popup; colleague register shows the amber "Lezione di QA R2 Teacher T2" banner and is markable; student search is names-only (`{id,name,booked}`), add → credit −1 and `current_bookings` +1, remove ("Togli" → "Sicura? Tocca ancora") → credit +1 even <24 h before the lesson (school decision, no policy burn), attended/no-show bookings not removable (404 `booking_not_found`), already booked → 400, unknown/foreign student → 404, cancelled lesson → 400 `lesson_cancelled`, no e-mail on add/remove (by design). T2 without grants: 404 on T1's lessons, 403 on `/students/`, only her 2 lessons. Revoking both switches: T1 back to 9 own lessons, colleague lesson 404, `/students/` 403, toggle and Togli/Add box disappear. Staff strings correct in en/es/fr/de.
- **Role isolation:** T1 token → 403 on `/api/hq/schools/`, `/api/hq/team/`, `/api/hq/permissions/mine/`, `/api/hq/library/`, all `/api/school/*` tried (`not_a_school_member`), `/api/student/*` (`No student profile`), `POST /api/bookings/`, `PATCH /api/school/teachers/<self>/` (cannot self-grant); no token → 401; school-admin and student tokens on `/api/teacher/*` → 403.
- **Emails:** see §5 — every expected email arrived within 3–12 s in the recipient's language.

---

## 4. Re-verification of prior-round findings (teacher panel)

| Prior | Verdict | Live evidence |
|---|---|---|
| C-2 burns_credit inverted | **VERIFIED FIXED LIVE** | Assente (ON) → `no_show/no_show` + email; Presente/Ritardo/Excused (OFF) → `attended/present`; school-side GET agrees |
| C-3 compensation includes future / later-today lessons | **VERIFIED FIXED LIVE** | 22:30 UTC lesson and 8/14/27 Sept lessons absent from both endpoints; totals €60 → €85 hand-derived |
| C-4 Performance vs Compensation day boundary | **VERIFIED FIXED LIVE** | earlier-today lesson counted in `lessons_taught` (3, then 4) and in Compensation |
| H-3 CSP `media-src` / silent video failure | **VERIFIED FIXED LIVE** | header `media-src 'self' https:`; WebM plays; error box for failing URLs |
| H-4 profile email desync | **VERIFIED FIXED LIVE** | new email logs in, old refused; collision → 400 |
| M-1 colourless status buttons | **VERIFIED FIXED LIVE** | grey fallback computed styles |
| M-2 breakdown titled "No Data" | **VERIFIED FIXED LIVE** | "Dettaglio" heading with populated bars |
| M-3 no way to reach past lessons | **VERIFIED FIXED LIVE** | "Passate" section (60-day window) |
| M-4 hardcoded Compensation strings | **VERIFIED FIXED LIVE** | all 5 locales translated |
| M-5 Students Followed counts rows | **VERIFIED FIXED LIVE** | 3 distinct students vs 9 rows |
| L-1 untitled library fallback | **VERIFIED FIXED LIVE** | "Senza titolo / Sin título" |
| L-3 Present/No-show English on Performance | **STILL OPEN** | seen in it/es/fr/de |
| L-4 password-change UI | **STILL OPEN** (endpoint fine, no UI anywhere) | grep + welcome-email promise |

---

## 5. Emails verified

| Trigger | Recipient inbox | Arrived (UTC) | Subject | Locale | Link |
|---|---|---|---|---|---|
| Teacher invite (school form, UI locale it) | qa-r2-teacher-t1 | 10:12:17 (invite 10:12:12) | ✉️ Sei stata invitata nel team di Danza Classica No Under 40 | it ✓ | `/it/setup-account?uid&token` → completed via UI ✓ |
| Teacher invite | qa-r2-teacher-t2 | 10:12:29 | same | it ✓ | link → completed via API ✓ |
| Student self-registration | qa-r2-teacher-s1 | 10:16:12 | 🩰 Benvenuta in Danza Classica No Under 40! | it ✓ | `/it/student/profile?for=…` present |
| Student self-registration | qa-r2-teacher-s2 | 10:16:14 | 🩰 Welcome to Danza Classica No Under 40! | en ✓ | `/en/student/profile?for=…` present |
| Booking confirmed (×8 S1 it, ×7 S2 en, ×1 mailprobe it) | s1 / s2 / mailprobe | 10:17:47–10:18:50, 10:45:25 | ✅ Prenotazione confermata — … / ✅ Booking confirmed — … | ✓ | `/<loc>/student/bookings?for=…` |
| Credits-low threshold (5 lessons left) | s1 (it) / s2 (en) | 10:17:49 / 10:17:51 | 💳 Il tuo pacchetto sta per finire — 5 lezioni rimaste / 💳 Your package is running low — 5 lessons left | ✓ | – |
| New booking (school copy, ×18) | qa-r2-school-c | 10:17:47–10:45 | 📅 Nuova prenotazione: … | it ✓ (school language) | – |
| No-show marked (3×: earlier-today lesson, yesterday via UI, colleague lesson via staff) | qa-r2-teacher-s2 | 10:19:14, 10:24:57, 10:36:22 | 👻 We missed you today — … | en ✓ | `/en/student/book?school_id=C&for=…` ✓ (wording: TCH-R2-10) |
| Lesson cancelled by the school (L_P20) | qa-r2-teacher-s2 | 10:36:29 (cancel 10:36:2x) | 🚫 Lesson cancelled — QA R2 Corso Base T1, 27-09-2026 | en ✓ | – |
| Forgot password (login page) | qa-r2-teacher-t1 | 10:43:16 (request 10:43:13) | 🔑 Reimposta la tua password | it ✓ | `/it/reset-password?uid&token` → worked; reuse → expired ✓ |
| Staff add/remove student, present marks, profile email change | – | – | none sent | by design (no template) | – |

No expected email failed to arrive.

---

## 6. Test data created (all on QA R2 School C unless noted)

- Attendance statuses: `65be8ae6` "QA R2 Presente" (#16a34a, default), `8ee8ba61` "QA R2 Assente" (#dc2626, counts-as-absence ON), `1f192c58` "QA R2 Ritardo" (no colour), `0b9199c3` "QA R2 Excused" (#f59e0b, OFF). Compensation plan `f6ea3071` "QA R2 Plan" (20 / threshold 2 / 5 per student / max 10). Location `7c9ce259` "QA R2 Sede Centrale", room `cbb92ccc` "QA R2 Sala 1".
- Courses: `b89592e1` "QA R2 Corso Base T1" (T1, plan attached, credit 1, lesson type DCN40-BF); `95b80a6d` "QA R2 Corso T2" (T2, DCN40-TI).
- Lessons (created in the future, students booked, then PATCHed by the school into the past where noted): `7408d12c` 06/09 08:00 (empty, → past), `711226b7` 06/09 10:00 (→ past; S1 Ritardo, S2 Excused), `8cfcd76d` 06/09 17:00 (bonus lesson → past; S1,S2,S3 present), `0e0d8d33` 06/09 15:00 T2 (→ past; marked by T1 as staff: S1 present, S2 no-show), `4d79f33d` 07/09 06:00 (→ earlier today; S1 present, S2 no-show), `122cabc4` 07/09 22:30 (later today, S1+S2, unmarked), `37691258` 08/09 10:00 (S1+S2), `6b5cd63b` 08/09 18:00 cap 2 (S1+S2), `99adf747` 08/09 15:00 T2 (S1), `8c906f2c` 14/09 (S1), `0f68c0bd` 27/09 (**cancelled by the school**, S2 refunded).
- Credit grants: 10 each to S1, S2, S3 (cash, "QA R2 Manual 10"). Balances left: S1 3, S2 4, S3 9.
- Chat: `dd44963a` school_teacher (T1↔School C, contains T2's intrusion message and is now `resolved` by T2), `76e64cbd` teacher_support (T1↔HQ, HQ owner replied), `ed8ad14d` school_student (S1↔School C, contains T2's intrusion reply) — **left in place as evidence**.
- Profile: T1 phone +39 3339998877, bio "Bio QA R2 — ünïcödé ✨", photo `/media/public/teacher-photos/de3011d1-5560-4b99-9904-7bfcd924a3b0.png`; email and names restored; passwords of T1/T2 restored to `QaRound2!2026`.
- Staff grants on T1: set and **revoked** (both false now).
- HQ Library rows `e205afdc`, `a7b10e52`, `818cb5e4` ("QA R2 Library Video/Broken/PDF") — **deleted**.
- Not created: the optional QA Test School teacher-probe onboarding (skipped, see §7).

## 7. Not tested and why

- Multi-school teacher (a true second school) — out of my tenant scope; the per-link grant design (`TeacherSchool`) was read but not exercised across two schools.
- The pending teacher-probe invite on QA Test School — skipped: T1 already covered the full UI onboarding journey, and the coordinator's throttle rules discouraged extra login-form traffic.
- mp4/H.264 playback — Playwright's Chromium has no H.264 decoder (the MDN mp4 fixture hit the error box); verified with WebM instead, plus the CSP header.
- Calendar WebSocket updates for the staff school group, chat attachments, iCal, Google login.
- S3 self-registration via the UI in Spanish — blocked by the shared-IP `register` throttle (5/hour); replaced by the coordinator's pre-registered `qa-r2-mailprobe` linked via `POST /api/student/school/` (welcome email for that account was verified by the coordinator).
- Where the teacher `bio` (accepts HTML) is rendered to students.

## 8. Assumptions / decisions

- Server timezone UTC (`TIME_ZONE = "UTC"`): "earlier today" = 06:00 UTC, "later today" = 22:30 UTC; `_lesson_datetime` compares in UTC.
- Past-dated lessons with bookings were produced exactly as the prior round did: create future → book as the students (real `/api/bookings/`) → `PATCH /api/school/classes/<id>/ {date,start_time,duration_minutes}` as the school.
- "Attach T1 to the compensation plan": there is no API that writes `TeacherSchool.compensation_plan`; the plan is attached per course/schedule (`compensation_plan_id` on the wizard/class) and the dashboard widget falls back to lesson plans — I used that path.
- Throttling (`register` 5/h, `password_reset` 5/h, `login` 10/min per IP) is shared by all five agents on one IP; 429s are an environment effect, logged once in `$SP/reports/REGISTRATION_LEDGER.md` (2 registrations + 1 reset used; 7 `/register` requests in total, 5 of them 429). After the coordinator's notice I switched to one login per account with cached access+refresh tokens (`$SP/pw/session.js`).
- Severity of TCH-R2-01 set to Critical because a teacher can read and act on other roles' private conversations inside the tenant (medical data was readable); TCH-R2-02 High per the "silent wrong attendance numbers" rule; TCH-R2-04 Medium (placeholder copy on the onboarding page in 4 of 5 locales — arguably Low).
- Emails to `mail.tm` were treated as delivered when listed by the API; links were opened with Playwright.

## 9. Screenshot index (`$SP/shots/`)

- Onboarding: `teacher-invite-form-t1.png`, `teacher-invite-done-t1.png`, `teacher-invite-done-t2.png`, `teacher-setup-garbage-after.png`, `teacher-setup-t1real-filled.png` (placeholder copy), `teacher-setup-t1real-after.png` (landing dashboard), `teacher-setup-t1reuse-after.png`.
- Locale sweep (9 pages × 5 locales): `teacher-{en,it,es,fr,de}-{dashboard,calendar,attendance,attendance_711226b7-…,performance,compensation,library,inbox,profile}.png`; mobile: `teacher-mobile-it-*.png` (9).
- Register/attendance: `teacher-register-it-yesterday.png` (grey colourless status), `teacher-register-it-yesterday-s2-assente.png`, `teacher-register-it-tomorrow-error.png` (raw error code), `teacher-register-it-empty.png`.
- Calendar: `teacher-calendar-it-{day,week,month,year,popup}.png`, `teacher-calendar-de-popup.png`.
- Library: `teacher-library-it-video-playing.png`, `teacher-library-it-video-broken.png`, `teacher-library-it-seed-untitled.png`, `teacher-library-it-empty-filter.png`.
- Inbox: `teacher-inbox-it-school_teacher-sent.png`, `teacher-inbox-it-teacher_support-sent.png`, `teacher-inbox-it-list-unread.png`, `teacher-inbox-it-conversation.png`.
- Profile: `teacher-profile-it-edited.png`, `teacher-profile-it-email-collision.png`.
- Staff feature: `teacher-staff-school-switches-on.png`, `teacher-staff-calendar-all.png`, `teacher-staff-attendance-all.png`, `teacher-staff-colleague-register.png`, `teacher-staff-add-remove.png`, `teacher-staff-{en,es,fr,de}-register.png`, `teacher-staff-school-switches-off.png`, `teacher-staff-after-revoke.png`.
- Auth: `teacher-forgot-it-sent.png`, `teacher-reset-it-after.png`; students: `teacher-register-{it,en}-after.png`, `teacher-register-es-after.png` (throttle message).
- Text dumps for the i18n scan: `$SP/teacher/text/*.txt` (54 files); Playwright scripts: `$SP/pw/teacher-*.js`; run logs are in this session's tool output.
