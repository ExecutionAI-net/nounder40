# QA Full Regression — Teacher Panel

**Date:** 2026-09-06/07 (dev server clock, UTC) · **Environment:** `https://dev.danzaclassicanounder40.com` (`develop` branch) · **Account:** `qa.teacher@qa-nounder40.test`
**Method:** Direct backend calls (`curl` + JWT) as the primary source of truth, cross-checked against the live UI (Claude Browser) wherever feasible. Backend source was read alongside every finding to confirm root cause, not just symptoms.

> **Session hazard disclosure (read first):** This session ran concurrently with 3 other QA agents sharing one browser instance and one QA database/school. `localStorage` (where the JWT lives) was overwritten by other agents' logins **at least 5 times** during this run (HQ owner, HQ support-ish account, and a student account all appeared unprompted in this tab). Every finding below that relies on a UI screenshot was re-verified by checking the JWT's `user_id`/`role` claim immediately before trusting that screenshot, or was independently reproduced via `curl` with a token I controlled. Findings that could *only* be reproduced through a contaminated UI session were discarded rather than reported. Separately, other agents mutated shared QA fixtures mid-session (see "Environment contamination" under Not Tested). Where this affected a finding, it's called out explicitly and a clean, isolated repro is given instead.

---

## 1. Page-by-page coverage

| Page | Backend endpoint(s) | Covered | Notes |
|---|---|---|---|
| Dashboard | `/api/teacher/lessons/`, `/api/teacher/schools/`, `/api/teacher/profile/` | Yes | Today/Upcoming/Compensation-plan widgets checked against Calendar/Compensation data |
| Calendar | `/api/teacher/lessons/` (calendar alias) | Yes | Day/Week/Month/Year views, lesson-detail popup, locale-aware date formatting (code + partial live) |
| Attendance | `/api/teacher/attendance/{id}/` (GET/POST) | Yes, extensively | Timing boundary (past/today/future), idempotency, custom statuses, empty roster, validation |
| Performance | `/api/teacher/stats/` | Yes | KPI math re-derived by hand from manufactured attendance data |
| Compensation | `/api/teacher/compensation/`, `/api/teacher/compensation-overview/` | Yes, extensively | Cross-checked against manual base-fee/bonus calculation and against Performance |
| Library | `/api/teacher/library/` | Yes | Filters, empty state, video/PDF failure behavior, CSP |
| Inbox | `/api/chat/conversations/` | Yes | New-conversation flow for both `school_teacher` and `teacher_support`, end-to-end with School/HQ side |
| Profile | `/api/teacher/profile/` (PATCH) | Yes | Field-by-field, plus the login-email desync bug |
| Teacher invite → first login | `/api/school/teachers/` (POST), `/api/auth/complete-invite/` | Partial | Invite created and negative-path tested; happy path blocked on email access (see Not Tested) |
| Role isolation | `/api/hq/*`, `/api/school/*` with teacher token | Yes | Clean 403 everywhere tested |

---

## 2. Findings, by severity

### CRITICAL

#### C1 — The "Counts as absence" toggle does the opposite of what it says, silently flipping absences into "present"
**Where:** `backend/bookings/attendance_views.py::_apply_marks()` (lines ~85-90) vs. the on-screen copy at `school.statuses.burnsCredit` / `burnsCreditDesc` in `frontend/messages/*.json`.

The School Settings → Attendance Statuses page lets a school admin create a custom status and toggle a field literally labeled:
- **"Counts as absence"** (`burnsCredit`)
- Description: *"With this status the lesson is recorded as an absence (statistics and emails)."* (`burnsCreditDesc`)

But the actual derivation in `_apply_marks()` when a teacher marks attendance by `status_id` (which is what the Attendance UI always sends) is:

```python
raw["status"] = (
    Attendance.Status.PRESENT
    if status_ref is not None and status_ref.burns_credit
    else Attendance.Status.NO_SHOW
)
```

`burns_credit = True` → the student is recorded **PRESENT**. `burns_credit = False` → **NO_SHOW**. This is the exact opposite of the field's own label and description.

**Live repro (uncontaminated, via `curl` with my own token):**
1. The QA school's seeded "Assente" ("Absent") status has `burns_credit: true` — created by `qa_platform.py` and indistinguishable from what a real school admin would configure after reading "Counts as absence."
2. `POST /api/teacher/attendance/949fab52.../ [{"student_id":"...B...","status_id":"<Assente id>"}]` → `200`.
3. `GET` the same lesson's roster back: `{"booking_status":"attended","attendance_status":"present","attendance_status_id":"<Assente id>"}`.

The teacher clicked/selected "Assente" (Absent) for a student who did not show up, and the system recorded them as **present and attended**.

**Downstream impact, all confirmed:**
- Performance page: no-show rate / attendance rate / "Students Followed" are corrupted (an absence is counted as a presence).
- Compensation: `students_count = Attendance.objects.filter(status="present").count()` — an absent student marked this way **counts toward the bonus-per-student headcount**, so a school could pay a teacher a bonus that was never earned.
- Notifications: `_dispatch_email(booking, "no_show")` only fires for `Booking.Status.NO_SHOW`; a genuinely absent student marked via this status **never triggers the no-show email**.

**Contrast (control case, correctly working):** the status I created myself, "Excused (QA)" with `burns_credit=False`, correctly derived to `no_show` when applied to the same lesson — proving the derivation logic itself is consistent, it's the *label* that is backwards, and any school that follows the app's own instructions will misconfigure their statuses.

**Fix direction:** either invert the code's condition to match the label, or invert the label/description to match the code — but as shipped, following the UI is guaranteed to produce wrong attendance data. Also fix `catalog/admin.py`'s Django-admin help text (`"burns_credit è la colonna che conta: decide se la presenza consuma credito"`), which asserts a third, different (also wrong) meaning — attendance never touches credits at all (see "Verified correct" section).

---

#### C2 — Teacher Compensation page pays out for lessons that have not happened yet (regression of the previously "fixed" bug)
**Where:** `backend/teachers/views.py::TeacherCompensationOverviewView.get()` (backs `GET /api/teacher/compensation-overview/`, which is what `/teacher/compensation` actually calls — see `frontend/src/app/[locale]/teacher/compensation/page.tsx` line 76).

`QA_TEST_RESULTS.md` records this bug class as fixed in PR #53 for the *attendance-marking* endpoint and in `teachers/services.py::monthly_compensation()`. That fix was never applied to `TeacherCompensationOverviewView`, which computes the "My Compensation" page independently and has **no exclusion for future dates at all**:

```python
lessons = (
    Lesson.objects.filter(teacher=teacher, school=school, date__gte=start, date__lte=end)
    .exclude(status="cancelled")
    ...
)
```
— `end` is the last calendar day of the selected month; there is no `date.today()` clamp anywhere in this view, unlike its sibling function in `services.py`.

**Live repro, cleanly isolated to avoid the environment contamination noted below:**
1. Created a lesson dated **2026-09-20** (14 days after the dev server's "today," 2026-09-06), with the teacher's real compensation plan attached, via `POST /api/school/lessons/` as the school owner. No student was even booked into it.
2. `GET /api/teacher/compensation-overview/?month=2026-09` → the entry list includes this lesson with `"fee": 20.0`, and the school's `total` is inflated by exactly €20 because of it.
3. Confirmed live in the browser too (Spanish locale, screenshotted and text-extracted): the "My Compensation" page's lesson table for September lists **`20 sept 10:00 · QA Course · QA Base Plan · 0 Estudiantes · €20.00`**, and the page header shows **Total €100.00**, while only €60.00 corresponds to lessons that had actually occurred at the time of the check (5 Sept, 6 Sept 20:00, 6 Sept 23:55). The other €40 comes from two lessons that had not happened yet (one later the same day, one 14 days out).
4. For comparison, the sibling endpoint `GET /api/teacher/compensation/?school=...&month=2026-09` (`teachers/services.py::monthly_compensation`, used elsewhere) correctly **excluded** the Sept 20 lesson — proving the fix exists in one code path and was simply never ported to the other, which is the one the actual page uses.

This is a direct, real financial exposure: a school looking at a teacher's compensation mid-month will see (and could act on/pay) amounts that include lessons that may still be cancelled, rescheduled, or simply never taught.

---

#### C3 — Even the "fixed" compensation path leaks lessons scheduled later the same day
**Where:** `backend/teachers/services.py::monthly_compensation()`, line ~53:
```python
lessons = Lesson.objects.filter(
    teacher=teacher, school=school, date__gte=start, date__lte=min(end, date.today())
)...
```
This clamp compares **dates only**, not datetimes. A lesson scheduled later *today* has `date == date.today()`, so it passes the `<=` check and is included — even though `TeacherAttendanceView.post()` (correctly) still refuses to let the teacher mark attendance for it, using the finer-grained `_lesson_datetime(lesson) <= now` check.

**Live repro:** created a lesson today at 23:55 with the compensation plan attached. At 23:30 (25 minutes before the lesson started):
- `POST /api/teacher/attendance/<id>/` → `400 {"error":"lesson_not_yet_occurred"}` (correct — this is the part that was fixed).
- `GET /api/teacher/compensation/?school=...&month=2026-09` → the same lesson already appears in the breakdown with `"fee": 20.0` (incorrect — the lesson hasn't happened, but its base fee is already being counted).

So the boundary that was carefully fixed in one place (attendance marking) was not applied with the same rigor in the sibling calculation, leaving a smaller version of C2's bug alive even in the "protected" endpoint.

**Recommendation for C2+C3 together:** both compensation paths should exclude any lesson where `_lesson_datetime(lesson) > timezone.now()`, exactly like `TeacherAttendanceView` already does — not `date <= date.today()` and not "no check at all."

---

#### C4 — Performance "Lessons Taught" still disagrees with Compensation, for a different boundary than before
**Where:** `backend/teachers/views.py::TeacherStatsView.get()`:
```python
past = Lesson.objects.filter(teacher=teacher, date__lt=date.today())
...
"lessons_taught": past.count(),
```
This uses `date__lt=date.today()` — **strictly before today** — so a lesson that already happened earlier *today* (e.g. this morning, or 20 minutes ago) is not counted as "taught" yet, even though it already has attendance marked and is already generating compensation.

**Live repro:** after marking attendance on 3 lessons that had genuinely occurred (Sept 5, and two on Sept 6 — one at 20:00, one at 23:55, both before "now"):
- Performance page (`GET /api/teacher/stats/`): `"lessons_taught": 1` (only counts the Sept 5 lesson).
- Compensation page for the same month shows fees for 3 already-occurred lessons (€60 legitimately earned that day).

QA_TEST_RESULTS.md flags "Performance lessons-taught vs. Compensation totals disagreeing" as a previously-documented bug. The specific mechanism that was fixed (future dates) is gone, but this sibling boundary (same-day-already-occurred lessons) was never addressed, so the two pages still visibly disagree on how many lessons the teacher has taught, on the same day, for the same teacher.

---

### HIGH

#### H1 — Content-Security-Policy has no `media-src`, so the Metodo Library's videos cannot play at all (not just the seeded fake URLs)
**Where:** `frontend/next.config.ts` lines 38-39:
```
"default-src 'self'; script-src ...; style-src ...; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.anthropic.com"
```
There is no `media-src` directive, so `<video>`/`<audio>` fall back to `default-src 'self'`, which blocks **any externally-hosted media**, real or fake.

**Live repro:** opened a Library video item on `/en/teacher/library`. Browser console:
```
Loading media from 'https://example.test/videos/port-de-bras.mp4' violates the following
Content Security Policy directive: "default-src 'self'". Note that 'media-src' was not
explicitly set, so 'default-src' is used as a fallback. The action has been blocked.
```
Confirmed via `read_network_requests` that **no network request was even attempted** — the browser blocked it before any DNS/HTTP activity, which is different from (and worse than) the known "example.test doesn't resolve" seed-data issue: this would identically block a real, working, valid video URL hosted on any CDN/S3/Vimeo/etc., which is realistically how the Metodo Library's real content will be hosted.

**Also confirmed:** the failure is completely silent to the user. The player shows the native HTML5 controls sitting at `0:00` with a live-but-inert play button; there is no app-level "couldn't load this video" message anywhere (task item 6 asked specifically to verify graceful failure — it does not fail gracefully, it fails invisibly).

**Fix:** add a `media-src` directive listing the actual video/asset host(s) (S3 bucket, CDN, etc.) to the CSP in `next.config.ts`.

---

#### H2 — Teacher Profile's "Email" field is not the login email, with no indication of that, and no uniqueness check
**Where:** `backend/teachers/views.py::TeacherProfileView.patch()` + `backend/teachers/serializers.py::TeacherSerializer` (email is a plain writable field) vs. `frontend/src/app/[locale]/teacher/profile/page.tsx` (a normal `<input type="email">` bound straight to this field, with `t('syncHint')` = *"Name, email, phone and photo are synced with the profile your schools see."*).

**Live repro:**
1. As the teacher, `PATCH /api/teacher/profile/ {"email":"totally-different@example.com"}` → `200`, `"saved": true` in the UI's terms.
2. `POST /api/auth/login/` with the **old** email/password → still `200`, login still works.
3. `POST /api/auth/login/` with the **new** email/password → `401 "No active account found with the given credentials"`.

So `Teacher.email` (shown on the Profile page, and on the School's Teacher roster / compensation summaries) silently diverges from `User.email` (the actual login credential) — the PATCH never touches the `User` row. Contrast with the *School*-side edit endpoint (`SchoolTeacherDetailView.patch()`), which explicitly checks for email collisions and updates `teacher.user.email` too — the teacher's own self-service Profile page has neither protection.

**Impact:** a real teacher who updates their email address here (a completely natural, well-labeled action — the field is just called "Email") will believe they've updated their account and will very plausibly try to log in with the new address next time, getting a confusing "no account found" error while their old email — which they may no longer check — is still their real login. There's also no uniqueness check, so two different teacher accounts could end up displaying the same email.

**Recommendation:** either update `User.email` in lockstep (with the same collision check the School side has), or relabel/clarify the field as "display email" and drop `type="email"`/`required` framing that implies it's the login credential.

---

### MEDIUM

#### M1 — Attendance-status buttons become invisible when the status has no color set
**Where:** `frontend/src/app/[locale]/teacher/attendance/[lessonId]/page.tsx` lines ~196-217. The *selected* status button is styled `{ backgroundColor: s.color, color: '#ffffff' }`. `AttendanceStatus.color` is an optional (`blank=True`) field; both QA-seeded statuses ("Presente", "Assente") and my own API-created one shipped with `color: ""`.

**Live repro:** confirmed via DOM inspection (`getAttribute('style')`) on the live Attendance Register page — the "Presente" button rendered with `style="color: rgb(255, 255, 255)"` and no `background-color` at all, i.e. **white text on the card's white background: invisible**. The only visible indicator of the current selection is a small text label elsewhere on the row, which itself also loses its intended background pill for the same reason (`backgroundColor: color + '20'` → `"20"`, invalid, ignored).

This will hit any school whose statuses were created outside the Settings UI's own color picker (which always defaults to a real hex value) — e.g. via the ETL migration from Supabase, or the API directly. Given the QA seed script itself produces colorless statuses, this is not a hypothetical edge case.

**Fix:** fall back to a default color (e.g. `#6b7280`) when `s.color` is empty, both for the button fill and the label pill.

---

#### M2 — Performance page's breakdown section is permanently titled "No Data," even when it's showing data
**Where:** `frontend/src/app/[locale]/teacher/performance/page.tsx` line 58:
```jsx
<h2 className="text-sm font-semibold text-gray-700 mb-4">{t('noData')}</h2>
{total === 0 ? (
  <p className="text-sm text-gray-400">{t('noData')}</p>
) : ( /* real Present/No-show bars */ )}
```
The section header always renders the `noData` translation ("No Data"), regardless of the `total === 0` branch below it, which is presumably a copy-paste of the intended (and missing) section title.

**Live repro (Spanish, screenshotted):** the Performance page shows a card titled **"Sin Datos"** directly above two real, populated progress bars — "Present 2/3" and "No-show 1/3" with correct percentages. Every teacher with any attendance history will see this contradictory heading.

---

#### M3 — Attendance page has no way to reach past, not-yet-marked lessons
**Where:** `frontend/src/app/[locale]/teacher/attendance/page.tsx`. It fetches `/teacher/lessons/` unfiltered (up to 1000 rows) and buckets client-side into `todayLessons` (`date === today`) and `upcomingLessons` (`date > today`) — there is no "past"/"needs attention" bucket. Any lesson with `date < today` simply disappears from this page forever.

Since the backend has no upper bound on how far in the past attendance can be marked, a teacher who forgot to mark attendance for a class from a few days ago has no way to find it again from the page whose entire purpose is marking attendance — their only paths back to it are knowing the lesson's UUID directly, or navigating the Calendar to that exact date and using the popup's "Mark Attendance" link (verified this workaround does work).

**Recommendation:** add a "Needs Attention" / "Past, unmarked" section, e.g. lessons with `date < today` and `already_submitted === false`.

---

#### M4 — Several Compensation-page strings are hardcoded English in every locale
**Where:** `frontend/src/app/[locale]/teacher/compensation/page.tsx`. Confirmed live on the Spanish-locale page (rest of the page correctly localized — "Mi Compensación", "Mes/Curso/Planes/Estudiantes/Tarifa base" headers all correct):
- `"0 with bonus"` (line ~141) — plain string.
- Payment badge `"Paid"` / `"Pending"` (lines ~194, 209) — plain strings (live-confirmed showing literal **"Pending"** on the Spanish page).
- `"Paid on {date}"` (line ~200) — plain string.
- `"No plan"` (line ~241) — plain string.
- `"{n} to bonus"` (line ~251) — plain string (live-confirmed as **"3 to bonus"**, **"1 to bonus"** on the Spanish page).
- `"Today"` month-nav button (line ~115) — plain string.

---

#### M5 — "Students Followed" KPI counts present *markings*, not distinct students
**Where:** `backend/teachers/views.py::TeacherStatsView.get()`:
```python
present = attendance.filter(status="present").count()
...
"present": present,
```
and `frontend/.../performance/page.tsx`: `{ label: t('studentsFollowed'), value: present }`.

This counts every `Attendance` row with `status="present"`, i.e. one per lesson-attendance, not `Attendance.objects.filter(status="present").values("student").distinct().count()`. A teacher with 5 recurring students attending 8 classes each would see "Students Followed: 40," not "5." I could not empirically diverge the two numbers this session (my two test students each appeared in exactly one present-marking, so 2 present-rows == 2 distinct students by coincidence) but the query itself is unambiguous in the source and will overcount for any teacher with repeat students, which is the entire premise of a dance school.

---

### LOW

- **L1 — Library items with all locale titles blank render with an empty title line** (both the grid card and the video-viewer modal header) — `LibraryContentSerializer.get_title()` correctly falls back through `title_en/it/es/fr` but returns `""` when all four are genuinely blank, and the frontend has no further fallback (e.g. "Untitled"). Currently this only affects the known QA seed data (`title_it/en/fr/es` are all blank on all 3 seeded items) — same category as the already-known `example.test` URL issue — but there's no defensive UI fallback if it ever happens with real content.
- **L2 — Misleading backend comment.** `backend/catalog/admin.py` line 68 documents `burns_credit` as *"decide se la presenza consuma credito"* ("decides if attendance consumes a credit"). The actual, current, tested behavior (per `bookings/services.py::mark_attendance()`'s own comment, dated 2026-08-30) is that **attendance never touches credits** at all — credit only moves on cancellation. This stale/wrong comment is presumably part of how the label bug in C1 came to be.
- **L3 — Hardcoded English strings on the Performance page** outside next-intl: the `!stats` fallback (`"Teacher profile not found."`) and the breakdown row labels `"Present"` / `"No-show"` (confirmed showing in English on the otherwise fully-Spanish page).
- **L4 — No password-change UI anywhere in the Teacher panel.** The generic `POST /api/auth/change-password/` endpoint exists and correctly requires the current password, but a code search of `teacher/profile/page.tsx` found no call to it and no password fields — a teacher who wants to change their password from inside the app appears to have no way to do so (would need the "forgot password" email flow instead). Not confirmed as a regression (may be intentional), flagged as a likely gap.

---

## 3. Verified correct (re-checked, not re-reporting)

- **Attendance timing boundary** — re-verified live and matches the unit tests in `backend/bookings/tests/test_attendance_marking.py`: a lesson dated in the future is rejected (`400 lesson_not_yet_occurred`); a lesson later *today* is rejected; a lesson earlier today (already started/ended) succeeds; the boundary is the full `date+start_time` datetime, not the calendar date.
- **Idempotent re-marking** — marking the same lesson twice with different statuses correctly updates the existing `Attendance`/`Booking` rows in place (`update_or_create`), no duplicates, `already_submitted` flips correctly, `marked_at` timestamp updates.
- **Attendance never touches credits**, confirmed empirically: both students' package balances were unchanged (8.0 → 8.0) after multiple attendance-marking calls with different statuses (present, no-show, custom burns_credit=False). This matches the intentional design documented in `bookings/services.py` (credit moves only on cancellation) — the CLAUDE.md wording ("No-show always burns") is about cancellation policy, not attendance marking, and holds.
- **Compensation table headers** (Month/Course/Plan/Students/Base Fee) are distinct and correctly translated in all 5 locales (`en/it/es/fr/de`) — the previously-reported "Month" copy-paste bug and hardcoded "Students" header are both genuinely fixed.
- **`lessonsTeaught` typo key** now renders "Lessons Taught" in English and is correctly localized in all other locales.
- **No-show rate / Attendance rate render as `%`** (e.g. "33%"/"67%"), not raw numbers — previously-reported bug confirmed fixed.
- **Teacher Inbox "New Message"** works end-to-end for both channels, confirmed via cross-account verification, not just the teacher's own view:
  - `school_teacher`: teacher creates conversation + sends message → **the School owner's own `/api/chat/conversations/` immediately shows it** with the correct `last_message`.
  - `teacher_support`: teacher creates conversation + sends message → **an HQ owner's own `/api/chat/conversations/?type=teacher_support` immediately shows it**, with `teacher_name` correctly populated.
  - Both tabs are present in the UI (`school.tab` / `teacher_support` tab), matching the backend.
- **Role isolation** — teacher JWT gets a clean `403` on `/api/hq/schools/`, `/api/hq/permissions/`, `/api/school/team/`, `/api/school/profile/`, `/api/school/students/`, `/api/school/compensation-plans/`, and a clean `403 {"error":"not_a_school_member"}` on `POST /api/school/credits/grant/`. No data leakage found.
- **Calendar locale-awareness** — code review confirms every date/time render in `teacher/calendar/page.tsx` (header, day names, month names, lesson-detail popup) uses `toLocaleDateString(uiLocale, ...)` with the live `next-intl` locale, not a hardcoded one; this is the same pattern that was previously broken on the student booking calendar. No hardcoded-locale bug found here.
- **Library empty-filter state** — filtering to a combination with zero matches (e.g. Language=French, of which the QA seed has none) renders a clean "No Content" state, no crash, no infinite spinner.
- **Attendance validation** — missing `student_id` → `400` with a field-level DRF error; empty array → `200` no-op; a lesson ID that doesn't belong to the caller → clean `404 {"error":"lesson_not_found"}`, no leakage of another teacher's data.
- **i18n placeholder sweep** — scanned every string under the `teacher.*` namespace in all 5 locale files for the previously-reported `Label X`/`Col X`/`Kpi X`/`Tab X`/etc. raw-key pattern: **zero matches** in any locale. The Teacher panel's share of that bug class is fully fixed.

---

## 4. Not tested / could not verify, and why

1. **Full teacher-invite → first-login journey (task item 9).** I invited a new teacher as the School owner (`POST /api/school/teachers/` with `h.timur+teacherself@executionai.net`) — got `201`, `email_sent: true`. I could not retrieve the actual invite email: the Gmail connector available in this session (`mcp__e21868f2-...`) returned *"This connector requires additional permissions. The user needs to reconnect it."* I could not derive a valid token myself (`default_token_generator.make_token()` requires the server's `SECRET_KEY`, which I don't have). What I *did* verify: the endpoint's negative path is clean (`POST /api/auth/complete-invite/` with a bogus uid/token → `400 {"error":"invalid_link"}`, no 500). **Coordinator action needed:** check the inbox for `h.timur+teacherself@executionai.net` (forwards to `h.timur@executionai.net`) for a "team_invite" email and forward me the `setup-account` link, or re-authorize the Gmail connector for this session type.
2. **Multi-school teacher behavior (task explicit ask).** `qa.teacher@qa-nounder40.test` is linked to exactly one school (confirmed via `/api/teacher/schools/` and the School's own teacher roster). I did not have tooling in scope to create a second school and link the same teacher to it without HQ-level school-provisioning access. Reasoned from code instead: `TeacherCompensationOverviewView`, `TeacherSchoolAssignmentsView`, and the Dashboard's compensation-plan widget all iterate `TeacherSchool.objects.filter(teacher=teacher, active=True)` per-school, so a second school would produce a second independent entry/section on Compensation and Dashboard, and would independently exhibit bug C2 for that school's lessons too — but this was not empirically exercised.
3. **Pixel-perfect UI verification of several lower-priority items** (e.g., re-checking M1's invisible button across every possible status color, a second locale pass over Calendar's popup) was cut short given the repeated session hijacking described above — time was prioritized toward the highest-value, most rigorously cross-checked findings (C1–C4, H1–H2) rather than broad shallow re-screenshots that would need the same expensive verify-before-trust treatment.
4. **Environment contamination from concurrent QA agents.** During this session, shared QA fixtures were modified by other agents in ways that affected my own test data: a lesson I created (`8c6593ad...`, originally 2026-09-07 12:00, scheduled) was later found changed to 2026-09-06 10:00, status `completed`, with an extra booking — clearly someone else's School-panel test touched it. The QA school's teacher roster also gained an unrelated `"QA TeacherInvite"` entry mid-session, and `qa.student.b@qa-nounder40.test` (a student I registered myself for this test) gained two extra packages I did not grant, including one with `99999.0` credits. None of this invalidates the findings above — where it mattered, I re-derived proof from a freshly created, uniquely-dated, unambiguous fixture (the Sept 20 lesson for C2) rather than trusting numbers that could have been touched by someone else — but any exact lesson/attendance counts quoted from `curl` snapshots earlier in the session vs. later may not perfectly reconcile against each other for this reason, and this dev environment is not presently safe for fully unattended parallel QA without per-agent data isolation (this exact caveat was already flagged in the prior QA round's methodology note).
5. **Real email deliverability/content/locale of the `team_invite` template** — not checked, blocked by (1).

---

## 5. Test data created (left in place, all under QA/owned-inbox identities)

- School: `QA Test School` (pre-existing) — added `AttendanceStatus` "Excused (QA)" (`burns_credit=false`), `CompensationPlan` "QA Base Plan" (base €20, bonus €5/student over 2), attached to `QA Course`.
- Lessons created directly via `POST /api/school/lessons/`: 2026-09-05 12:00, 2026-09-06 20:00, 2026-09-06 23:55 (used for the attendance-timing and compensation tests), 2026-09-20 10:00 (isolated future-lesson repro for C2).
- Students: `qa.student.a@qa-nounder40.test`, `qa.student.b@qa-nounder40.test` (self-registered, enrolled at QA Test School, granted 10 credits each, booked into the lessons above).
- Invited teacher: `h.timur+teacherself@executionai.net` (invite sent, not yet completed — see §4.1).
- Conversations: one `school_teacher` and one `teacher_support` conversation with a test message each, left in place as evidence (both `status: open`).
