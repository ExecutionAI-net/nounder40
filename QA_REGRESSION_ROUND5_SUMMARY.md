# QA Regression Round 5 — Local, on the 2026-09-13 feature batch

**Date:** 2026-09-13 (evening)
**Environment:** local Docker stack (`http://localhost`, nginx → Next dev server + Django), `develop` @ `7f0bd1b` (the seven commits `4f98540..7f0bd1b` made the same day), fixtures from `manage.py qa_platform seed` plus a second QA school, a two-school teacher and credit packages for the QA student. **Nothing was pushed before this round.**
**Why this round exists:** Carlo asked for a QA pass "as in the previous days" on everything built on 2026-09-13 before any push/merge: Tutorials (HQ + public student page + sidebar toggle), the school calendar format filter, the invite wording and the `team_added` e-mail, the teacher school switcher, and permanent deletion of cancelled lessons.
**Method:** one coordinator + 3 parallel live agents (Playwright + API through the round-4 harness) + an 8-angle code review of the diff (`478c7ac..HEAD`). Every finding was fixed the same evening (`0b4a1f6`) and re-verified live (`reports/verify-fixes*.txt`, 13 checks).

Per-area detail (repro steps, request/response evidence, screenshot names):

- [QA_REGRESSION_ROUND5_TUTORIALS.md](QA_REGRESSION_ROUND5_TUTORIALS.md) — findings `TUT-R5-*`
- [QA_REGRESSION_ROUND5_SCHOOL.md](QA_REGRESSION_ROUND5_SCHOOL.md) — findings `SCH-R5-*` (format filter, cancel → purge, team notices)
- [QA_REGRESSION_ROUND5_TEACHER_HQ_I18N.md](QA_REGRESSION_ROUND5_TEACHER_HQ_I18N.md) — findings `TCH-R5-*`, HQ Team flow, 150-cell locale/viewport crawl
- [docs/qa/round5-screenshots/](docs/qa/round5-screenshots/) — key evidence (13 files)

---

## Outcome

| Severity | Live QA | Code review | Fixed |
|---|---|---|---|
| Critical | 0 | 0 | — |
| High | 0 | 0 | — |
| Medium | 3 | 2 | 5/5 |
| Low | 6 | 8 | 14/14 |

No Critical/High. Every Medium and Low was fixed in `0b4a1f6` and re-verified live. The full backend suite passes (1,477 tests, 26 new today), `tsc` and `eslint` are clean, every new dictionary string parses as ICU in all five locales.

## Findings and fix status

### Live QA

| Finding | Severity | Fix | Verified |
|---|---|---|---|
| TUT-R5-1 — HQ Emails → "Aggiunta al team" preview: the CTA rendered broken because `login_url` was not a sample variable and sat inside `href` | Medium | `login_url`, `invite_org`, `invite_role` added to `SAMPLE_VARS` | preview CTA `href=…/it/login`, screenshot `fix-emails-preview-team-added` |
| TUT-R5-2 — YouTube thumbnail fallback stuck on the cached 120×90 placeholder on warm loads (video without `maxresdefault`) | Medium | `VideoThumbnail` probes the candidates with `Image()` objects and only renders the first real one (no reliance on `<img onLoad>`, which a cached image can beat) | 3 consecutive warm loads: `hqdefault.jpg`, `naturalWidth 480`, box 16:9 |
| SCH-R5-1 — course page filtered cancelled classes out, so its new "Elimina definitivamente" button could never render | Medium | cancelled classes listed with an "Annullata" badge, excluded from bulk-cancel selection (checkbox disabled) | badge + button visible, two-click delete → `purge/ 200`, screenshot `fix-course-cancelled-row` |
| TUT-R5-3 — raw keys `hq.emails.var_login_url / var_invite_org / var_invite_role` in the variables panel | Low | labels added in 5 locales | no `hq.emails.var_` in page text |
| TUT-R5-4 — React controlled/uncontrolled warning when switching Video ⇄ PDF | Low | distinct `key`s on the URL and file inputs | — |
| TUT-R5-5 — `GET /api/tutorials/?language=IT` returned nothing (case-sensitive filter) | Low | language/type CSV filters lower-cased (+ test) | `?language=IT` → rows |
| SCH-R5-2 — `team_added` sent in the admin's language instead of the recipient's | Low | recipient's `language_preference` wins (school locale as fallback) (+ test) | test `…follows_the_recipients_language…` |
| TCH-R5-01 — `/api/teacher/library/?school=<not hers>` ignored the filter | Low | returns `[]` like lessons/stats (+ test) | live `len=0` |
| TCH-R5-02 — compensation page filtered entries client-side but the 6-month trend stayed all-schools | Low | `?school=` on `compensation-overview` narrows entries **and** trend; page passes it (+ test) | live: entries = B only, trend 6 months |

### Code review (8 angles on `478c7ac..HEAD`)

| Finding | Severity | Fix |
|---|---|---|
| CR-1 — purge guard only protected *confirmed* bookings: a past lesson with attendance taken, flagged cancelled via `PATCH status`, could be purged and its attended/no-show bookings and `Attendance` rows cascaded away (burnt credits with no history) | Medium | `409 has_attendance_history` on any non-cancelled booking or Attendance row; bulk purge skips them; `DeleteLessonButton` shows a distinct message per refusal (+ test) |
| CR-2 — school team page keyed its notice on `existing` (row exists), so an invited-but-never-activated teacher was told she "already has credentials" while actually receiving the setup link | Medium | API returns `existing_account` (usable password); the page keys on it (+ test) |
| CR-3 — re-adding an already-active teacher sent a fresh `team_added` mail on every POST | Low | `already_linked`: no mail, teachers page says nothing changed (+ test) |
| CR-4 — `TutorialSerializer.validate` skipped the "video needs a URL" rule when `type` was omitted on create | Low | default `video` applied in validation (+ test) |
| CR-5 — HQ tutorials delete swallowed API errors (card removed anyway) and used native `confirm()` against the platform rule | Low | `ConfirmDeleteButton` two-click for delete and remove-file; error banner; card stays on failure |
| CR-6 — `nu40_teacher_school` survived logout (next teacher on the same browser inherited the filter) | Low | cleared together with the JWT keys |
| CR-7 — non-YouTube/Vimeo links (youtube-nocookie, Loom…) were put in `<video>` and failed | Low | iframe unless the URL is a direct media file (mp4/webm/…) |
| CR-8 — `MB`/`KB` hardcoded next to a dictionary that says "Mo" in French | Low | `sizeMb`/`sizeKb` keys in 5 locales |
| CR-9 — second YouTube regex (`video-preview.ts`) diverging from the new one; unused `getVideoThumbnail` | Low | `youtubeThumbnail()` delegates to `youtubeId()`; dead export removed |
| CR-10 — lessons page computed the purge range twice; student page re-filtered on every render | Low | one `feedRange`; memoised `visible` |

### Follow-ups from the review, done the same evening on Carlo's request (commit "refactor(review): one toggle view, one locale list, one fetch per page")

- One `_PlatformToggleView` base (key per subclass) replaces the four pasted toggle views (homepage stats, shop, credits, tutorials); one `usePlatformFlag` hook replaces the three copied hooks.
- One `core/locales.py` (`LOCALES`, `clamp_locale`) replaces the eight hand-written locale tuples in the backend; `accounts.signals.LOCALES` is gone, its two importers point at the shared one. The two four-language tuples in `catalog/` stay: they mirror the `name_it/en/fr/es` columns, not the UI locales.
- `fetchPlatformStats()` (module-level cached promise, 60 s, invalidated after an HQ toggle) serves the student layout, the logo, the sidebar colours and the flag hooks: `/it/student/tutorials` now issues 1 `GET /platform-stats/` instead of 3–4. `fetchTeacherSchools()` does the same for the scope hook, the sidebar switcher, the dashboard and the profile: 1 `GET /teacher/schools/` per teacher page instead of 2–3.
- `HQLayout.SECTION_PATHS` is derived from the exported `NAV_ITEMS` (one section list; the dashboard is everyone's and not guarded). Verified live: `qa.hq.support` on `/hq/tutorials` is still sent back to the dashboard.

### Noted, deliberately not changed

- `PublicTutorialsView` is unpaginated and uncached (HQ-curated list of dozens); purge cascade is per-row for very large ranges.
- HQ Team "Attiva e manda email" still sends the setup-link invite to an account that already has a password (works as a reset); `team_added` could be used there too — product call.
- With the sidebar toggle off, `/api/tutorials/` stays reachable (UI-only gate, tutorials are public content). A logged-in student whose profile language is `en` gets English preselected on `/it/student/tutorials` — by design (profile wins).
- HQ sub-role labels (`Support`, `Finance`…) are English on every locale: pre-existing, from the role matrix.

## Not run

- Single-school teacher rendering of the switcher in the browser (no one-school QA teacher; confirmed from code and API shape).
- Compensation figures with non-zero amounts (no compensation plan on the QA links).
- `X-Content-Type-Options: nosniff` on the public PDF route: the local nginx container runs a stale `nginx.conf` (pre-existing local drift, not a product finding).
- Real e-mail delivery: no provider locally; every "sent" assertion is on the queued Celery task payload (`key`, `locale`, `context`) captured from Redis / the worker log.

## Cleanup

All QA-created tutorials, lessons, memberships and teacher links removed; the QA student is back at 10/10 credits in both QA schools; e-mail switches restored to on. Residue by design of the invite flows: inactive user stubs `qa.hq.invitee.*@qa-nounder40.test`, `qa.new.member/teacher.*@qa-nounder40.test`, and `qa.hq.support` keeps a `teacher` role from the teacher-invite test. Local only.
