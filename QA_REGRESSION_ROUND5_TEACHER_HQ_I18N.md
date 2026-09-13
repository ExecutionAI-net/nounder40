# QA Round 5 — Teacher school switcher · HQ Team wording/approve · i18n & mobile crawl

- **Date**: 2026-09-13 (local build, `develop` @ 7f0bd1b; commits under test c0da331, 62bdc09, ad749ef + today's i18n)
- **Base**: `http://localhost` (nginx → Next dev + Django)
- **Accounts used**: `qa.teacher@qa-nounder40.test` (teacher of QA Test School A `aed73f29-…` and B `1a62b32b-…`), `qa.hq.owner@qa-nounder40.test`, `qa.school.owner@qa-nounder40.test`, `qa.student@qa-nounder40.test`, anonymous. HQ invitees created and removed: `qa.hq.invitee.x0l0xj@`, `qa.hq.invitee.hsb7vv@` (both approved, then removed) and a third pending-only invite `61b9f79a-…` (deleted) — see cleanup.
- **Tooling**: `tooling/tchqi18n-{api,switcher,switcher2,hqteam,crawl,leaks,table,parity}.js`; raw logs in `reports/dumps/tchqi18n-*.{log,json,stdout}`; page dumps `reports/dumps/crawl-*.txt`; screenshots `shots/`.

## Findings (most severe first)

| ID | Severity | Title | Repro | Expected | Actual | Evidence |
|---|---|---|---|---|---|---|
| TCH-R5-01 | Low | `/api/teacher/library/?school=<foreign>` silently ignores the filter instead of returning an empty list (inconsistent with lessons/stats) | As qa.teacher: `GET /api/teacher/library/?school=00000000-0000-4000-8000-000000000001` (a school she does not teach at) | Same contract as `/teacher/lessons/` and `/teacher/stats/`: a school she is not assigned to yields nothing (`[]`) | `200`, **3 items** — identical to the unfiltered list (`/teacher/library/` → 3, `?school=A` → 3, `?school=B` → 3). Not a data leak (only content she can already see: all 3 items are HQ-wide, `school: null`), but the `?school=` contract differs per endpoint. Cause: `backend/library/views.py:47-53` — `if school_id and school_id in school_ids:` drops the filter when the id is not hers. Malformed `?school=abc` → `400 {"school":["'abc' is not a valid UUID."]}` (OK). | `reports/dumps/tchqi18n-api.json` keys `lib_all`, `lib_A`, `lib_B`, `lib_random`, `lib_malformed` |
| TCH-R5-02 | Low (by code inspection — not observable with the QA data) | Compensation page: the 6-month trend is not narrowed to the selected school | Select "QA Test School B" in the sidebar, open `/teacher/compensation` with a month where both schools have earnings | Trend bars/totals for school B only (page title/entries/grand total are B-only) | The page filters `entries` client-side (`teacher/compensation/page.tsx:90`) but renders `data.trend` untouched; the server computes the trend across **all** links (`backend/teachers/views.py:382-385`, `sum(... for link in links)`) and the overview endpoint has no `?school=` (`GET /teacher/compensation-overview/?month=2026-09&school=B` still returns both entries). With B selected the trend shows A+B. Not visible in this run: every QA total is 0 and the trend block is hidden when all totals are 0 (`data.trend.some(t => t.total > 0)`). | `reports/dumps/tchqi18n-api.json` key `comp_overview_schoolparam_ignored` (entries A and B returned with `?school=B`); source lines above |

No Critical/High/Medium findings. No raw translation keys, English leaks of today's strings, HTTP ≥ 400, console errors or horizontal overflow on any of the 15 pages × 5 locales × 2 viewports (section C).

## Passed checks

### A. Teacher school switcher (as qa.teacher, locale `it`)

- **A1 desktop sidebar**: block "SCUOLA" with `<select>` options `["Tutte le scuole","QA Test School","QA Test School B"]`, values `["", A, B]` — `shots/tch-switcher.png`, `dumps/tchqi18n-switcher.log`.
- **A1 mobile drawer (390px)**: burger (`aria-label="Apri Barra Laterale"`) → drawer contains the same block/options — `shots/tch-switcher-mobile.png`, `dumps/tchqi18n-switcher2.log`.
- **A2 select B → reload**: `localStorage.nu40_teacher_school = 1a62b32b-5822-40e9-8713-3242a2db6753`, select shows B after the reload.
- **A2 calendar (B)**: page request `GET /api/teacher/lessons/?from=2026-09-14&to=2026-09-20&scope=mine&school=1a62b32b-…` → 2 lessons, all `school_name = "QA Test School B"`; same range without `school=` at the same moment → 7 lessons (A + B). Month view request `from=2026-08-31&to=2026-09-29&…&school=B` → 3 lessons, all B. Visual: 2 cards (B) vs 10 cards (all schools) in week 14–20 Sep — `shots/tch-calendar-B-nextweek.png`, `shots/tch-calendar-B-month.png`, `shots/tch-calendar-all-nextweek.png`.
- **A2 attendance (B)**: request `…/lessons/?from=2026-07-15&scope=mine&school=B` → 3 lessons, all B; page text: 3 "QA Test School B" cards, 0 "QA Test School" (A) cards — `shots/tch-attendance-B.png`. Mobile: before selecting B 10 A-cards + 3 B-cards, after 0 A / 3 B — `shots/tch-attendance-B-mobile.png`.
- **A2 dashboard (B)**: requests `…/lessons/?date=2026-09-13&school=B` → 0 and `…/lessons/?from=2026-09-14&to=2026-09-20&school=B` → 2 (both B); today/upcoming render only those — `shots/tch-dashboard-B.png`.
- **A2 performance (B)**: request `GET /api/teacher/stats/?school=B` → `{"lessons_taught":0,"lessons_upcoming":3,"attendance_marked":0,"present":0,"no_show":0,"attendance_rate":null}`, identical to a direct API call at the same moment; tiles show 0 / 0 / 0% / 0% — `shots/tch-performance-B.png`.
- **A2 compensation (B)**: response entries A (0,00 €) and B (0,00 €); page shows only the "QA Test School B · Milano" entry; grand total 0,00 € = B total. (Weak numerically — both totals are 0, no compensation plan on the QA links.) — `shots/tch-compensation-B.png`.
- **A2 library (B)**: `page.on('request')` captured `GET /api/teacher/library/?school=1a62b32b-5822-40e9-8713-3242a2db6753` — `dumps/tchqi18n-switcher.log`.
- **A2 persistence**: SPA navigation (sidebar link calendar → attendance) keeps select = B, localStorage = B and the request carries `school=B`; `page.reload()` keeps B; every full navigation between the 6 pages kept B.
- **A2 "Tutte le scuole"**: localStorage key removed (`null`), select value `""`; calendar request has no `school=` (`…/lessons/?from=2026-09-07&to=2026-09-13&scope=mine`), compensation shows both entries, library request `GET /api/teacher/library/?` without `school`.
- **A3 API**: `GET /teacher/lessons/?from=2026-09-01&to=2026-10-31` → 8 (A 5, B 3); `?school=A` → 5 (all A); `?school=B` → 3 (all B); `?school=<random uuid>` → `[]`; `?school=6fbd92eb-…` (a real school she does not teach at, id read via HQ list) → `[]`; `?school=abc` → `400 {"school":["'abc' is not a valid UUID."]}`. `GET /teacher/stats/` → upcoming 8; `?school=A` → 5; `?school=B` → 3; random → all zeros; `abc` → 400. `GET /teacher/compensation-overview/?month=2026-09` → 2 entries, each with `school.id/name/city`. `GET /teacher/schools/` → 2 links, `can_view_all_lessons=false` on both. — `dumps/tchqi18n-api.json`.
- **A4 single-school rendering (code)**: `TeacherSchoolSwitcher.tsx` returns `null` while loading or with 0 links, renders label + `school_name` only (no `<select>`) when `schools.length === 1`, the `<select>` with "all" + one option per link otherwise; the API shape (`/teacher/schools/` → `school_id`, `school_name`) matches. Browser check NOT RUN (see below).
- **A5**: with `can_view_all_lessons=false` on both links the "Le mie lezioni / Tutte le lezioni" toggle is correctly absent (`ScopeToggle` gated on `canViewAll`), and the hook forces `scope=mine` on the requests — consistent with `lib/teacher-scope.ts`.

### B. HQ Team wording + approve flow (as qa.hq.owner)

- **B1 it — invite form**: description = `L'invito resta in sospeso finché non premi «Attiva e manda email»: solo allora l'account viene creato e parte l'email di accesso.` (matches `it.json`).
- **B1 it — "Invia invito"**: banner `Invito per qa.hq.invitee.x0l0xj@qa-nounder40.test salvato tra quelli in sospeso. Per mandare l'email premi «Attiva e manda email».`; `POST /api/hq/invitations/` → `201 {"id":"7181ff29-…","type":"hq_member","role_detail":"support",…}`; Celery `key=team_invite` lines before/after: 0 / 0 (no e-mail queued) — `shots/hq-team-pending.png`.
- **B1 it — pending list**: buttons `["Attiva e manda email","Rimuovi"]`.
- **B1 it — modal**: title `Attiva e manda email`, subtitle `Crea l'account HQ e invia subito l'email con il link per impostare la password.`, note `Nessuna password da comunicare: la imposta lei dal link ricevuto. Se ha già un account, il link funziona lo stesso.`, confirm button `Attiva e manda email` — no password to communicate anywhere — `shots/hq-team-modal.png`.
- **B1 it — approve**: `POST /api/hq/invitations/7181ff29-…/approve/` → `201 {"id":"1f9177f0-…","email":"qa.hq.invitee.x0l0xj@…","email_sent":true}`; banner `QA Invitee Uno attivato: email di accesso inviata.`; Celery: new line `email send failed (key=team_invite to=qa.hq.invitee.x0l0xj@qa-nounder40.test): ZEPTO_MAIL_TOKEN not configured` — i.e. the task was queued and ran (no provider locally, expected) — `shots/hq-team-activated.png`.
- **B1 en**: form description, pending button `Activate and send email`, modal title/subtitle/note and confirm button all equal `en.json` — `shots/hq-team-modal-en.png`.
- **B2 template off**: `POST /api/hq/email-settings/ {"enabled.team_invite":"false"}` → `200 {"ok":true}` (GET confirms `"enabled.team_invite":"false"`); approve of invite 2 (`d29e8acc-…`) → `201 {"email_sent":false}`; banner (amber) `QA Invitee Due è stata attivata, ma l'e-mail d'invito non è partita — il modello di invito al team è disattivato in E-mail. Mandale tu il link di attivazione.`; Celery: `email skipped (key=team_invite): switched off in HQ > Emails` — `shots/hq-team-noemail.png`. Restored with `{"enabled.team_invite":"true"}` → 200 (GET confirms).
- **B3 es/fr/de**: form description, pending button, modal title/subtitle/note and confirm button (`Activar y enviar email` / `Activer et envoyer l'e-mail` / `Aktivieren und E-Mail senden`) all match the dictionaries; no raw keys (the only regex hit `hq.invitee` is the invitee's e-mail address) — `shots/hq-team-modal-{es,fr,de}.png`.
- **Cleanup**: `DELETE /api/hq/team/1f9177f0-…/` → 204, `DELETE /api/hq/team/3257b8f8-…/` → 204, `DELETE /api/hq/invitations/61b9f79a-…/` (3rd, never approved) → 204; invites 1–2 already gone (approve deletes them, 404 on DELETE); `GET /hq/team/` has no `qa.hq.invitee.*`, `GET /hq/invitations/` → `[]`. Residue (by design of `revoke_hq_membership`): two inactive User stubs `qa.hq.invitee.x0l0xj@` / `qa.hq.invitee.hsb7vv@` (`is_active=False`, `roles=[]`, unusable password) — left in place, no DB writes outside the API.

### C. i18n + responsive crawl (15 page/role combinations × 5 locales × 2 viewports = 150 loads)

Checks per cell: HTTP status of the document, console errors (`page.consoleErrors`), raw keys (`\b(hq|school|teacher|student|nav|layout|common|auth)\.x.y\b` and `[a-z]+\.[a-z]+[A-Z]…`), English leaks of today's 103 new/changed keys (EN value present as a whole phrase while the locale's value differs; fixture names "QA School Titolare", "QA Lesson Type", "QA Test School" excluded), horizontal overflow (`documentElement.scrollWidth > innerWidth`). Static parity: all 103 new keys exist in it/es/fr/de; the only values identical to English are genuine cognates (fr `Type`/`Description`/`Format`, de `Format`).

| page | en/D | en/M | it/D | it/M | es/D | es/M | fr/D | fr/M | de/D | de/M |
|---|---|---|---|---|---|---|---|---|---|---|
| `/hq/tutorials` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/hq/emails` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/hq/team` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/student/tutorials (anon)` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/student/tutorials (student)` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/school/calendar` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/school/lessons` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/school/team` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/school/teachers` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/calendar` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/attendance` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/dashboard` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/performance` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/compensation` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |
| `/teacher/library` | OK | OK | OK | OK | OK | OK | OK | OK | OK | OK |

Every cell: HTTP 200, 0 console errors, 0 raw keys, 0 English leaks, no horizontal overflow (scrollWidth = 390 on mobile). Dumps `reports/dumps/crawl-*.txt`, scored JSON `reports/dumps/tchqi18n-crawl-scored.json`, screenshots `shots/crawl-_hq_team_*`, `shots/crawl-_teacher_calendar_*`.

## Not run

- **A4 single-school teacher in the browser** — no QA account is a one-school teacher (`qa.teacher` is on A and B) and creating/unlinking one would either touch non-QA accounts or alter the shared fixture other agents rely on. Confirmed from code + API shape only (see A4 above).
- **A5 interplay of "Le mie lezioni / Tutte le lezioni" with the school switcher** — `qa.teacher` has `can_view_all_lessons=false` on both links, so the toggle does not render; granting it would change the shared fixture (`PATCH /api/school/teachers/…`) mid-run. Only the "absent when not granted" half is verified.
- **Compensation total with non-zero amounts** — no compensation plan on the QA links; the entry filter is verified, the sum only trivially (0 = 0).
- **Section C modals/forms beyond page load** — the crawl loads each page; forms/modals were exercised only on `/hq/team` (section B, 5 locales). `/school/lessons` deleteLesson and `/school/calendar` formatOnline strings were checked in the visible page text and statically (parity), not through the delete flow.

## Observations (no action requested)

- Dashboard's "compensation plans" block (from `/teacher/schools/`) lists both schools while B is selected; the brief scopes only today/upcoming, which are B-only.
- HQ sub-role labels (`Support`, `Super Admin`, `Finance`…) are English on it/es/fr/de pages — they come from `/hq/permissions/` / `DEFAULT_SUB_ROLES` (pre-existing since 2026-09-07), not from today's strings.
- Locally the approve e-mail ends in `email send failed … ZEPTO_MAIL_TOKEN not configured` — environment, not product; the assertion is that the task was queued with `key=team_invite`.
- The Next.js dev-mode "N" badge overlaps the bottom-left of the sidebar (over the switcher's left edge) in desktop screenshots — dev overlay only.
- Teacher-panel requests are duplicated in dev (React strict mode double effects) — harmless.
