> Round-3 live regression, 2026-09-08 — per-panel detail report written by the teacher QA agent. Entry point: [QA_REGRESSION_ROUND3_SUMMARY.md](QA_REGRESSION_ROUND3_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…`, `$SP/reports/…` or `$SP/work/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round3-screenshots/](docs/qa/round3-screenshots/).

# QA Regression Round 3 — Teacher Panel

- **Agent:** teacher · Playwright profile `teacher-agent` (desktop 1366×900) / `teacher-agent-mobile` (390×844) · inbox prefix `qa-r3-teacher-`
- **Environment:** https://dev.danzaclassicanounder40.com (develop @ 6c0cef1, CI run 34209392001), server clock UTC, school timezone Europe/Rome
- **Time window:** 2026-09-08 09:54 – (see end) UTC
- **Tenant:** QA R3 School C `e59729c8-1af6-4168-92b7-10c095797aa1` (owner `qa-r3-school-c@uberip.com`, lang it). Nothing outside this tenant was mutated except three HQ-owned Library rows created by `qa.hq.owner` (deleted again at the end, see §6) and one `teacher_support` thread T1 ↔ HQ.
- **Accounts created/used (password `QaRound3!2026`):**
  - T1 `qa-r3-teacher-t1@uberip.com` — teacher_id `0262f2f3-e796-4681-8d25-241677502988`, user `cb19cfd1-9399-45af-9f48-d39faf18276c` (invited through the school UI form, onboarded through the e-mailed link + `/it/setup-account` UI)
  - T2 `qa-r3-teacher-t2@uberip.com` — teacher_id `9a26ddca-1162-47f3-9000-77a057fcc56c`, user `2c6a2b17-a778-40e1-be9e-eb04d5aa1ccc` (invited + completed via API; isolation probes)
  - S1 `qa-r3-teacher-s1@uberip.com` (it) — student_id `ef11b79d-ed23-46f9-b85c-febfb4948dbf`, user `de4bcf2d-3797-4f5b-baa6-8ec358bdec6c` (registered through the mobile `/it/register` UI; later also invited as a teacher → multi-role, teacher_id `01181bc5-2ab2-4f85-ae76-87caf65c8497`)
  - S2 `qa-r3-teacher-s2@uberip.com` (en) — student_id `904e5a9d-e551-47c6-8305-0cd9bb289bb9`, user `036d5c0b-e120-45a2-85b9-ffe940bde846` (registered via API)
  - `qa.hq.owner@qa-nounder40.test` (Library fixtures, read), `qa-r3-school-c@uberip.com` (all school-side setup)
- **Method:** every flow exercised at least once through the real UI (Playwright) and cross-checked with independent `qa.api` calls on tokens validated with `qa.whoAmI`; e-mails verified end to end on mail.tm; 5 locales × desktop + mobile text dumps scanned with `qa.scanText`. Scripts: `$SP/work/teacher/*.js`, screenshots `$SP/shots/teacher-*.png`, dumps `$SP/reports/dumps/teacher-*.txt`, state `$SP/work/teacher/state.json`.

(report in progress — sections appended as the run proceeds)

## 0. Executive summary

The teacher panel is in strong shape on dev @ 6c0cef1. **All Round-2 Critical/High/Medium teacher findings I could re-test are VERIFIED FIXED LIVE**: the chat privacy leak (R2-C2), the staff-marked-attendance attribution bug (R2-H10), the unknown-`status_id` accept (R2-M10), the malformed-body 500 (R2-M6/M1), the school-side not-yet-occurred guard (R2-M5), the over-capacity silent overbook (R2-M12, now a 409 + explicit `allow_overbooking`), and all the Low i18n/UX items (R2-L3/L6/L7/L9 — year-view initials, "not yet occurred" badge, empty-roster state, profile name/bio validation, `lesson_already_started` reason). The R2-H14 timezone fix holds: at 23.5 h vs 24.5 h ahead in Europe/Rome the UI warning and the server refund decision agree exactly. Multi-role "one role per panel" chat (PR #105) and the realtime unread badge work. E-mails (invite, welcome, booking, no-show, cancelled, credits-low) arrive in the right locale in 1–3 s, and the two R2-M20 copy bugs (invite names school+role; no-show no longer says "today") are fixed.

**One new High**: any authenticated teacher can upload an arbitrary `.html`/`.svg` file through the profile-photo endpoint; it is stored under the app's own origin (`/media/public/…`) and served with `Content-Type: text/html` and **no `X-Content-Type-Options: nosniff`**, so an inline `<script>` in it executes on the app origin — a stored-XSS / JWT-theft vector (TCH-R3-01). Plus a couple of Lows (blank package-expiry in the credits-low e-mail; raw level/language badges on library cards; base fee still paid for a 0-booking lesson — an unchanged R2-L8 policy question).

Counts: 1 High, 3 Low. No Critical, no Medium.

## 1. Coverage table

| Page / flow | As | Locales (desktop) | Mobile | Result |
|---|---|---|---|---|
| School → invite teacher (UI form) | School C admin | it | – | PASS (T1+T2 invited; e-mail in ≤1 s, names school+role) |
| `/setup-account` real link + reuse | T1 | it | – | PASS; landing = `/it/teacher/dashboard`; reuse → "link scaduto/usato" |
| Student self-registration | S1 (UI mobile it), S2 (API en) | it | mobile it | PASS; welcome e-mails it/en |
| Dashboard | T1 | en it es fr de | it | PASS (today / next-7 / plan widget) |
| Calendar day/week/month/year + popup | T1 | en it es fr de | en it es fr de | PASS; **year-view initials localized** (LMMGVSD/MDMDFSS/LMXJVSD/LMMJVSD/MTWTFSS) |
| Attendance list (Today/Upcoming/Past 60-day, badge) | T1 | en it es fr de | it | PASS; future → disabled "not yet occurred" badge; Past shows Registra/Fatto |
| Register (mark/no-show/custom, burns_credit, unknown id, future, empty, re-mark, over-cap) | T1 | en it es fr de | it | PASS; all guards correct |
| Performance | T1, T2 | en it es fr de | it | PASS; stats follow Lesson.teacher; Present/No-show localized |
| Compensation (overview+detail, month nav, payment) | T1, T2 | en it es fr de | it | PASS; totals hand-derived €85; foreign-teacher payment → 404 |
| Library (filters, WebM video, PDF, broken) | T1 | en it es fr de | it | PASS; WebM plays (readyState 3); filter options localized |
| Inbox (list/thread/reply, unread, realtime badge) | T1, T2, S1, School, HQ | en it es fr de | it | PASS; privacy scoping correct |
| Profile (name/bio/email/photo/schools) | T1 | en it es fr de | it | PASS except photo type (TCH-R3-01) |
| Multi-role /select-role + RoleSwitcher + one-role-per-panel chat | S1 (student+teacher) | it | – | PASS (API-level; see §2 note) |
| Role isolation (T1/T2/S2/school/anon cross-panel) | all | – | – | PASS (clean 403/401) |
| Booking-side (cancel in/out policy TZ, started lesson, free first lesson) | S1, S2 | it | – | PASS |

Raw-key / `{var}` / `undefined|NaN|null` scan over all 5-locale × desktop+mobile dumps (≈150 pages incl. 4 calendar views each): **zero hits, zero console errors, zero horizontal overflow, no 5xx** on any teacher page.

## 2. Findings

### HIGH

#### TCH-R3-01 — Teacher photo-upload accepts arbitrary HTML/SVG, served same-origin as `text/html` without `nosniff` → stored XSS / JWT theft — NEW
- **Where:** `backend/core/media_views.py` `ModelImageUploadView.post()` + `core/storage.py:save_public()` — the file is saved with its original extension and **no content-type / extension allow-list**. `backend/teachers/image_views.py TeacherImageUploadView` (`POST /api/teacher/<id>/image/`) uses it. nginx serves `/media/public/…` with the file's own `Content-Type` and **no `X-Content-Type-Options: nosniff`** (verified: the app pages carry `nosniff`, the media response does not).
- **Repro (T1's own token):**
  1. `POST /api/teacher/0262f2f3…/image/` multipart `file=evil.html` (`Content-Type: text/html`, body `<script>alert(1)</script>`) → **200 `{"photo_url":"/media/public/teacher-photos/c2cabceb….html"}`**.
  2. `GET https://dev.danzaclassicanounder40.com/media/public/teacher-photos/c2cabceb….html` → **200, `Content-Type: text/html`, body `<script>alert(1)</script>` rendered as HTML** (no `Content-Disposition`, no `nosniff`).
  3. Same with `file=x.svg` containing `<script>`/`onload` → **200**, served `image/svg+xml` (SVG scripts run when the URL is opened directly).
- **Why it matters:** `/media/` is the **same origin** as the SPA, and the JWT lives in `localStorage` (per CLAUDE.md invariant #1). The page CSP is `script-src 'self' 'unsafe-inline'`, so an inline script in a same-origin HTML file executes and can read `localStorage.nu40_access` / `nu40_refresh` and exfiltrate them → full account takeover of whoever opens the link. Any authenticated teacher (self-onboarded via invite) can do this; the same shared view backs course/package/other image uploads, so the blast radius is every image endpoint.
- **Impact:** stored XSS on the app origin → session/JWT theft → account takeover. Rated High (needs a victim to open the crafted `/media/` URL; not auto-embedded in the app UI). Would be Critical if a teacher photo is rendered to students via an `<img src>` that a browser could be coaxed to sniff.
- **Expected:** reject non-image content types / extensions on upload, and/or serve `/media/public/` with `X-Content-Type-Options: nosniff` and a neutral `Content-Type` (or `Content-Disposition: attachment`).
- **Evidence:** run log of `$SP/work/teacher/24-photo.js` + the header dump in the session output; `photo_url` values above. The malicious rows were **overwritten** by restoring a real PNG (T1 `photo_url` is now `/media/public/teacher-photos/062e2f5f-…png`); the orphaned `.html`/`.svg` blobs remain in public storage (I cannot delete raw media) — flagged for the coordinator.
- **vs R2:** NEW (not probed in R2).

### LOW

#### TCH-R3-02 — Credits-low e-mail shows an empty expiry: "(scade il )" / "(it expires on )" — NEW
- **Where:** `notifications` credits-low template. A manual credit grant with no `expires_at` (the default when the school grants raw credits, no package chosen) renders the parenthetical with a blank date.
- **Repro:** S1/S2 got `💳 Il tuo pacchetto sta per finire — 5 lezioni rimaste` / `💳 Your package is running low — 5 lessons left` with body "…ti restano 5 lezioni (scade il )." / "…has 5 lessons left (it expires on )." (mail ids in §4).
- **Impact:** cosmetic; a stray empty "(expires on )" clause. Same "blank clause" class the ST-R2-15 email fix addressed for booking e-mails, missed here.
- **vs R2:** NEW.

#### TCH-R3-03 — Library cards show raw `level`/`language` values ("Entry", "Intermediate", "Advanced", "EN", "IT", "FR") — NEW (sibling of R2-L3)
- **Where:** `frontend/src/app/[locale]/teacher/library/page.tsx` card badge. The filter dropdown options are now localized (R2-L3/PR #110 fixed), but each card still prints the stored `level`/`language` verbatim, untranslated in all 5 locales.
- **Impact:** minor i18n; the localized filter says "Intermedio" while the matching card badge says "Intermediate".
- **Evidence:** `$SP/shots/teacher-r3-library-it.png` ("Intermediate FR", "Advanced IT", "Entry EN").
- **vs R2:** NEW (the filter-option half of R2-L3 is FIXED; card badges are a separate spot).

#### TCH-R3-04 — A past lesson with zero bookings still pays the base fee — STILL OPEN (R2-L8, policy)
- `L_PAST_EMPTY` (06-09 08:00, 0 students, never marked) appears in `compensation-overview`/`compensation` with `students:0, fee:20, threshold_gap` and adds €20 to the month total (T1 total €85 = 3×€20 base + €25 bonus). Unchanged from R2; `compute_lesson_fee()` pays base fee per scheduled lesson regardless of attendance. Flagged again as the documented policy question, not a regression.
- **vs R2:** STILL OPEN (re-tests TCH-R2-12).

## 3. Round-2 fix re-verification (teacher scope)

| R2 finding | Verdict | Live evidence |
|---|---|---|
| R2-C2 teacher can read/answer/delete every school conversation (TCH-R2-01) | **VERIFIED FIXED LIVE** | Created S1 school↔student thread (PII), school↔HQ thread, T1 school_teacher+support threads. T2 (plain teacher) `GET/msgs/POST/read/PATCH/DELETE` on **all four** → **404 every verb** (incl. forged `X-Panel-Role: school`/`hq`); `GET /chat/unread/` → `{total:0}`; `DELETE /chat/messages/<S1 msg>/` → 404. S1 thread intact, still `open`. |
| R2-C2 WebSocket leak | **VERIFIED FIXED LIVE** | T2 `/ws/inbox/?as=teacher` opens but receives **no** events when S1/school/T1 threads get new messages; `/ws/chat/<foreign conv>/?token=T2` → close 1006 (incl. `as=school`); `no token` → 1006. Positive control: T1 `/ws/inbox/` + `/ws/chat/<own>/` receive the `inbox_event`/`message` and the sidebar badge goes 0→1 in ~1 s. |
| R2-H10 staff-marked attendance credited to marker (TCH-R2-02) | **VERIFIED FIXED LIVE** | T1 (both grants) marks T2's past lesson [S1 present, S2 absent] → **T2** stats move `attendance_marked 0→2, present 1, no_show 1, rate 0.5`; **T1** unchanged `5/2/1/0.8`. Compensation still follows Lesson.teacher (T2 fee €0/€0-plan, T1 €85). |
| R2-M10 unknown/foreign `status_id` accepted as present (TCH-R2-03) | **VERIFIED FIXED LIVE** | `POST` with bogus `status_id` → **400 `invalid_status_id`**, roster stays unmarked; a mixed valid+invalid batch writes **nothing** (all-or-nothing). |
| R2-M6/M1 malformed attendance body 500 (TCH-R2-06) | **VERIFIED FIXED LIVE** | `POST … body "hello"` → **400 `{"body":["Expected a JSON object."]}`**, no 500. |
| R2-M5 school marks a not-yet-occurred lesson (SCH-R2-08) | **VERIFIED FIXED LIVE** | school `POST /school/attendance/<tomorrow>/` → **400 `lesson_not_yet_occurred`**. |
| R2-M12 staff add ignores capacity (TCH-R2-05) | **VERIFIED FIXED LIVE (decision made)** | staff add to a full lesson → **409 `lesson_full` + `allow_overbooking_required`**; retry `allow_overbooking:true` → 200, `overbooked`, roster 2/1. Product chose soft-stop-with-explicit-override. |
| SCH-R2-21 `lessons_upcoming` counts cancelled (PR #112) | **VERIFIED FIXED LIVE** | school cancels a future booked lesson → T1 `lessons_upcoming 7→6`; `/teacher/lessons/` shows it `cancelled` but stats exclude it. |
| SCH-R2-24 `can_view_all_lessons:"false"` string stays true (PR #112) | **VERIFIED FIXED LIVE** | PATCH `"false"` → grant off; PATCH `"garbage"` → **400 `'garbage' is not a valid boolean.`** |
| R2-L3 teacher i18n (year initials, Present/No-show, filters, error codes) | **VERIFIED FIXED LIVE** | year initials localized per locale; Performance "Présente/Absente" etc.; filter options translated; `email_taken` mapped in UI. |
| R2-L6 future "Mark" + raw error / empty-roster (TCH-R2-07, PR #108) | **VERIFIED FIXED LIVE** | list shows disabled "Non ancora svolta"/"Not yet occurred" badge; register page hides Save + friendly notice; empty lesson → "Nessuna allieva iscritta a questa lezione." |
| R2-L7 profile empty first name / bio bound (TCH-R2-11, PR #108) | **VERIFIED FIXED LIVE** | empty/blank first & last name → **400 "may not be blank"**; bio 5001 → **400 max 5000**. |
| R2-L9 past-lesson booking reason (TCH-R2-13, PR #108/#91) | **VERIFIED FIXED LIVE** | booking a 06-09 lesson → **400 `lesson_already_started`** (not `min_notice`); started lessons dropped from `/student/lessons/` (only future shown, anon too). |
| R2-H14 timezone cancellation boundary (PR #88) | **VERIFIED FIXED LIVE** | 23.5 h ahead → server `outside_policy` no refund + UI "Non più rimborsabile / 23.4 ore … fuori dalla politica"; 24.5 h → `within_policy` refund + UI "rientri nella politica (24 ore)". UI and server agree. |
| R2-H13 free first lesson reachable (PR #103) | **VERIFIED FIXED LIVE** | `purchase-options` returns `free_lesson_available` (true after school enables it, false for anon/after use); booking deducts 0 credits (`access_source: free_lesson`), flag flips, restored on cancel. |
| R2-M20 invite names school+role; no-show no "today" (PR #106/#110) | **VERIFIED FIXED LIVE** | invite subject "Invito da QA R3 School C — insegnante" / "Invitation from QA R3 School C — teacher"; no-show subject "👻 We missed you —" (no "today"), body "we didn't see you in the studio for … on 06-09-2026". |
| PR #105 multi-role one-role-per-panel chat | **VERIFIED FIXED LIVE** | S1 (student+teacher): `X-Panel-Role: student` lists her school_student thread, `teacher` lists none, forged `school` still only student scope; creating `school_teacher` from teacher panel → 201 sender_role `teacher`, from student panel → 403. |

## 4. E-mails verified (recipient / subject / locale / delivery)

| Trigger | Inbox | Subject | Locale | Delivery | Link |
|---|---|---|---|---|---|
| Teacher invite (UI form) | qa-r3-teacher-t1 | ✉️ Invito da QA R3 School C — insegnante | it ✓ | ~1 s | `/it/setup-account?uid&token` → completed via UI ✓ |
| Teacher invite (API) | qa-r3-teacher-t2 | ✉️ Invitation from QA R3 School C — teacher | en ✓ | ~1 s | `/en/setup-account…` → completed via API ✓ |
| Student welcome | qa-r3-teacher-s1 / s2 | 🩰 Benvenuta… / Welcome… | it / en ✓ | 1–2 s | `/…/student/profile?for=` ✓ |
| Booking confirmed (×many) | s1 (it) / s2 (en) | ✅ Prenotazione confermata / Booking confirmed | ✓ | ≤2 s | `/…/student/bookings?for=` |
| Booking cancelled (student) | s1 (it) | ❌ Prenotazione annullata — …, 09-09-2026 | it ✓ | ≤2 s | `/it/student/book…` |
| No-show marked | qa-r3-teacher-s2 | 👻 We missed you — QA R3 Corso Base T1, 06-09-2026 | en ✓ | 1 s | `/en/student/book…` ✓ (no "today") |
| Lesson cancelled by school | qa-r3-teacher-s2 | 🚫 Lesson cancelled — …, 27-09-2026 | en ✓ | 1 s | `/en/student/book…` |
| Credits low (5 left) | s1 (it) / s2 (en) | 💳 …sta per finire — 5 lezioni / running low — 5 lessons left | ✓ | 1 s | `/…/student/bookings?for=` — **blank expiry "(scade il )" TCH-R3-02** |
| School "new booking" copy (×many) | qa-r3-school-c | 📅 Nuova prenotazione: … | it (school lang) ✓ | ≤2 s | – |

No expected e-mail failed to arrive. Staff add/remove and profile edits send nothing (by design).

## 5. Verified good (live, no finding)

- **Onboarding:** school invite form (2 teachers listed, IT success banner naming the teacher), IT/EN invite e-mails with correct locale-prefixed setup link, `/setup-account` validates names+password (weak → 400 `weak_password`, token survives), completion lands on `/it/teacher/dashboard`, reuse → 400 `invalid_or_expired_token` / "link scaduto".
- **Attendance semantics:** status "counts as absence" ON (`QA R3 Assente`, burns_credit) → `no_show/no_show` + no-show e-mail; OFF (`Presente` default, colourless `Ritardo`, `Giustificata`) → `attended/present`, no e-mail. Attendance never touches credits (S2 credits unchanged by the no-show). Re-marking overwrites (`update_or_create`); a lesson flips to `completed` when marked; marking a not-yet-occurred / cancelled-future lesson → 400; foreign teacher's lesson → 404; random/non-uuid id → 404.
- **Performance:** `lessons_taught`=4 (earlier-today counted, later-today/future excluded, cancelled excluded), `lessons_upcoming` excludes cancelled, `attendance_marked/present/no_show/rate` follow Lesson.teacher, "Students followed" = distinct present students, labels localized in 5 locales.
- **Compensation:** T1 month total €85 = 3×€20 base + €25 bonus (threshold 1, 2 present → +1×€5, `has_bonus`, `bonus_lessons:1`); later-today/future/cancelled excluded; school `compensation-summary` matches (T1 €85/1 bonus, T2 €0 no plan); recorded payment appears in the teacher overview (`payment.amount 85 status paid`); foreign-teacher payment → 404 `teacher_not_at_school`; bad month/date params → clean 400.
- **Staff feature:** grants persist, scope toggle (`?scope=mine` 11 vs all 14), colleague lessons carry teacher name, colleague register markable and attributed to the lesson teacher's stats, student search names-only, add over-cap → 409, remove restores credit, already-booked → 400, unknown student → 404; T2 without grants → 404 on T1's lesson, 403 on the students endpoint of her own lesson; T1 cannot self-grant (403 `not_a_school_member`).
- **Library:** WebM plays (readyState 3, error null); PDF + broken-URL items list; filters localized; teacher sees only HQ-wide + own-school content; `type=x` filter → 200 (no crash).
- **Profile:** email change updates the login credential (new → 200, old → 401), collision incl. case-insensitive → 400 `email_taken`; photo PNG upload served 200 `image/png`; `POST /teacher/<id>/image/` by T2 on T1 → 403 "Not yours to edit."; `schools` assignments page returns the plan.
- **Role isolation:** T1 token → 403 on every `/api/hq/*` and `/api/school/*` and `/api/student/*` tried; `POST /bookings/` → 403; student/school tokens on `/api/teacher/*` → 403, anon → 401.
- **change-password endpoint:** works (wrong current → 400) — but still **no UI** anywhere (R2-L10 STILL OPEN; out of my new-finding scope, noted).

## 6. Test data created (all QA R3 School C `e59729c8…` unless noted)

- Teachers: T1 `0262f2f3-e796-4681-8d25-241677502988` (user `cb19cfd1…`), T2 `9a26ddca-1162-47f3-9000-77a057fcc56c` (user `2c6a2b17…`). S1 also linked as teacher `01181bc5-2ab2-4f85-ae76-87caf65c8497` (multi-role).
- Students: S1 `ef11b79d…` (user `de4bcf2d…`), S2 `904e5a9d…` (user `036d5c0b…`). 10 credits granted each (grants `0a7f1e8e…`, `b73ac4cb…`, cash "QA R3 Manual 10"). Balances left: S1 2, S2 4 (after cancels/refunds).
- Location `35d9cd81…` "QA R3 Sede Centrale", room `72eceb3b…` "QA R3 Sala 1" (cap 10).
- Attendance statuses: `db3ae73a…` Presente (#16a34a, default), `944964b1…` Assente (burns ON), `2b9b097a…` Ritardo (no colour), `0249f0d6…` Giustificata (#f59e0b).
- Compensation plan `4bccd7f4…` "QA R3 Plan" (base 20 / **bonus_threshold changed 2→1** for testing / 5 per student / max 10) — left at threshold 1.
- Courses `198bdbed…` "QA R3 Corso Base T1" (T1, plan), `fd9a0b29…` "QA R3 Corso T2" (T2, no plan).
- Lessons (12+2 wizard): PAST1 `48c01277…`, PAST_EMPTY `ca076c26…`, BONUS `d5a395ac…`, EARLIER_TODAY `37d2c616…`, LATER_TODAY `8cd5645b…`, TOMORROW `01bd1cca…`, 23_5H `0fbe9e8c…`, 24_5H `dbbe34ea…`, CANCEL `ee156310…` (**cancelled by school**), CAP1 `5fcb668f…`, T2_PAST `5c5993af…`, T2_FUTURE `a56315bb…`, plus wizard singles `64323371…`/`35400340…`. Several PATCHed into the past for attendance/comp tests.
- Bookings/attendance: PAST1 marked (S1 present, S2 no_show→then re-marked), BONUS both present, EARLIER_TODAY S2 present, T2_PAST marked by T1-as-staff (S1 present, S2 no_show); 23_5H/24_5H cancelled by S1 (policy test); T2_FUTURE free-lesson booked+cancelled by S2.
- Compensation payment `808e2a97…` (T1, 2026-09, €85, paid) — recorded, left in place.
- Chat threads left in place: `66ec702a…` school_student (S1↔school, PII), `6b36daa1…` hq_school (school↔HQ), `99c6662e…` school_teacher (T1↔school), `9e80527a…` teacher_support (T1↔HQ), `a612506e…` school_teacher (S1-as-teacher↔school). No intrusion messages were injected (every T2 probe was refused with 404).
- **Settings changed & restored:** T1 staff grants set then **revoked** (both false); `free_first_lesson` set true then **restored to false**; T1 profile phone/bio/email changed then **email restored** to original (phone/bio left as QA values); plan bonus_threshold left at 1 (test value).
- **HQ Library fixtures** `d079c3d4…`/`d7c883ae…`/`00dfa598…` — **deleted**.
- **Not restorable:** the orphaned malicious `.html`/`.svg` blobs from TCH-R3-01 in `/media/public/teacher-photos/` (`c2cabceb….html`, `66b9d849….svg`, and 2 stray PNGs) — no delete API for raw media; T1's `photo_url` was overwritten with a clean PNG. Flagged for coordinator/ops cleanup.
- Inboxes (mail.tm): `qa-r3-teacher-{t1,t2,s1,s2}@uberip.com`.
- Ledger: 1 self-registration used (S1, UI /it/register) + 1 API register (S2) = 2 of the 2-registration budget; 0 password resets.

## 7. Screenshots (`$SP/shots/`, prefix `teacher-`)

Onboarding: `teacher-r3-invite-form-{empty,filled}`, `teacher-r3-invite-done-t1`, `teacher-r3-setup-t1-{empty,filled,after,reuse}`, `teacher-r3-mobile-register-it-{empty,filled,after}`.
Locale sweep: `teacher-{desktop,mobile}-{en,it,es,fr,de}-{dashboard,calendar(+day/week/month/year/popup),attendance,register-past1,register-tomorrow,register-empty,register-colleague,performance,compensation,library,inbox,inbox-thread,profile}`.
Evidence: `teacher-r3-student-bookings-it`, `teacher-r3-student-cancel-dialog-{L_23_5H,L_24_5H}`, `teacher-r3-student-cancel-after-*`, `teacher-r3-realtime-badge`, `teacher-r3-library-{it,video-playing}`.

## 8. Assumptions / decisions / hazards

- Server clock UTC; "now" in Rome captured at run time (~11:59 CEST). Past-dated lessons produced by create-future → book as students → PATCH date into the past (same method as R2).
- I injected the cached JWT for most UI sweeps (`qa.injectJwt`) but performed each *flow* (invite, onboarding, registration, cancellation, library video) through the real forms at least once, per the brief.
- Node 20 has no `WebSocket` global, so the negative WS isolation probe was run from a Playwright page context (real browser WS) for authenticity; both the negative (T2) and positive (T1) controls behaved as expected.
- 0 password-reset budget → the teacher-side reset UI (school Team modal) was **not** tested, as instructed. Forgot-password from the login page was likewise skipped to conserve the shared reset throttle.
- Multi-role `/select-role` + RoleSwitcher were verified at the API/claims level (`roles:["student","teacher"]`, `/auth/my-role/`, per-panel chat scoping) rather than by driving the RoleSwitcher widget, to avoid burning a second S1 login against the 10/min throttle; the chat one-role-per-panel rule (the security-relevant part) was fully exercised.
- TCH-R3-01 severity set to High not Critical because exploitation needs a victim to open the crafted `/media/` URL; if a teacher photo is ever rendered to students via a sniffable `<img>`, re-rate to Critical.
- I did not create a genuine second school for T1, so cross-school teacher assignment/compensation aggregation was read but not exercised across two tenants (out of single-tenant scope).
