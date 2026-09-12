# QA Regression Round 4 — HQ Panel

> **Artifacts note (coordinator):** paths written as `$SP/...` refer to the QA session scratchpad (Playwright profiles, scripts, ~2,000 screenshots and text dumps) which is not committed; the key-evidence screenshots named in this report are in [docs/qa/round4-screenshots/](docs/qa/round4-screenshots/). Round-4 environment: dev `develop @ f4155c9`, 2026-09-11.

**Agent:** `hq` (Playwright profile `hq`, inbox prefix `qa-r4-hq-`, screenshots `hq-*`, finding IDs `HQ-R4-NN`).
**Environment:** https://dev.danzaclassicanounder40.com — live dev, `develop @ f4155c9` (CI run 34468639545).
**Time window (UTC):** 2026-09-11 ~18:30Z → ~19:10Z.
**Accounts:** qa.hq.{owner,super_admin,finance,analytics,support,tech_support,operations}@qa-nounder40.test (`QaSuite!2026`), all 7 log in. Never touched founders `c.carlo@cfcholding.it` / `hakantimur55@gmail.com` / `h.timur+hqinvite@executionai.net`. Write probes against the hierarchy guards were run from **throwaway** members I invited myself (`qa-r4-hq-invite1/2/3@uberip.com`) as attacker/target; the fixed `qa.hq.*` accounts were used only as refusal targets. No account was left modified (the R3 super_admin-lockout chain was NOT repeated — nothing landed).
**Method:** one `qa.login` per account, `qa.token` after; every UI observation cross-checked with `qa.api` on a `qa.whoAmI`-validated token; real UI via Playwright; e-mails via mail.tm (`qa-r4-hq-*@uberip.com`). One tenant created and deleted through the real UI flow.
**Budgets:** 0 self-registrations, 0 password resets used.

## 0. Executive summary
The round-3 HQ fix wave is **real on dev**. Every Critical/High/Medium HQ item in scope verified fixed **live** with exact request/status evidence: the `PUT`/`PATCH`/`DELETE` team-write takeover (R3-C1) is closed on all three verbs and the invite/approve path; the "can't grant a role above your own" rule (R3-M1) blocks self→operations/owner/super_admin on team edits, invitation create/update and approve while still allowing lateral support/finance invites; a removed HQ member can now be re-invited → approved → **log in 200** (R3-H3); narrow HQ roles are 403 on `/api/documents/<id>/` read (R3-H1) and **refused** on the calendar WebSocket (R3-M13); the school Activate/Deactivate toggle refreshes without reload (R3-M3); and all three invite-honesty surfaces tell the truth when `team_invite` is off (R3-M2: teachers/resend `sent:false`, school-detail "Nothing was sent", Team approve amber warning). R3-L9 batch all good (negative stats→400, dead `/hq/courses/` 404 gone, "1 teacher" singular, per-locale test-send samples, PhoneInput no "+39 +39"). R2 re-checks (C1, H1, H2 owner/operations drill-down, H4, M2, M18) hold.

**Two defects found**, both minor, both e-mail/i18n:
- **HQ-R4-01 (Medium)** — the HQ Emails page references a template variable `package_expiry_line` whose label key `hq.emails.var_package_expiry_line` is **missing in all 5 message files**: the raw key is shown in the variables list and a `MISSING_MESSAGE` console error fires on every locale, desktop and mobile.
- **HQ-R4-02 (Low)** — R3-M14 is **PARTIAL**: `student.after_purchase`/`booking_confirmed`/`booking_cancelled` are fixed, but `school.new_booking` (built-in copy **and** the stored DB rows, all 5 locales) still hardcodes `📍 {{location_name}} · {{room_name}}` instead of `{{location_line}}`, i.e. the exact bare-"📍 · " class the `location_line` var was created to remove — it just wasn't applied to this one key.

Counts: **0 Critical, 0 High, 1 Medium, 1 Low**, + 3 observations. 150-load 5-locale × 2-viewport sweep: 0 raw keys / `{var}` / `undefined` leaks anywhere except the emails page key above.

## 1. Coverage
| Page / flow | Sub-roles | Locales | Viewport | Method | Result |
|---|---|---|---|---|---|
| Login + `permissions/mine` for all 7 sub-roles + baseline (team/roles/settings) | all 7 | en | — | API | Pass (all 7 login incl. super_admin) |
| Team-only custom role: PATCH/PUT/DELETE on owner-equiv, self→owner/super_admin/operations, invite create/update/approve, unknown role, self-delete, POST team, perm-boost, section reads | inv1 (custom [dashboard,team]) | — | — | API | Pass — R3-C1/M1 all 403/400/405 |
| Remove → re-invite → approve → login | inv2 throwaway | — | — | API + login | Pass (R3-H3): 401 then **200** |
| `/api/documents/<id>/` GET narrow vs god-mode | support/tech_support/finance/analytics + owner/operations | — | — | API | Pass (R3-H1): 403 vs 200 |
| Calendar WS school+teacher | 6 sub-roles | — | — | Browser WS | Pass (R3-M13): narrow REFUSED, owner/operations OPEN |
| Schools: new (form, auto-invite), detail, resend, Activate/Deactivate (R3-M3), edit, list, delete+cascade | owner | en (+5 sweep) | D+M | UI + API + mail | Pass; armed label "1 teacher" (R3-L9) |
| School admin onboarding via emailed `/it/setup-account`; reuse | — | it | — | API | Pass (school_sub_role=owner, reuse 400) |
| Invite honesty (team_invite off ≤12s): school-detail resend, teachers/resend, Team approve | owner + School A admin | en | D | UI + API + mail | Pass (R3-M2, all 3 surfaces) |
| Team: invite→approve→onboard→login; role assign; remove | owner + throwaways | en | D | UI + API + mail | Pass |
| Packages: dead `/hq/courses/` 404, create/validation/duplicate/delete, image | owner | en (+5 sweep) | D+M | UI + API | Pass (R3-L9 HQ-R3-08) |
| Lesson types: create (blank optionals), explicit null 400, copy, delete | owner | en (+5 sweep) | D | UI + API | Pass (R2-H4) |
| Emails: templates list, per-locale test-send samples, template copy audit, honesty toggle | owner | 5 | D+M | UI + API + mail | **HQ-R4-01, HQ-R4-02** |
| Permissions matrix, HQ↔school chat/inbox (create/send/priority/status/realtime), library/shop/discount CRUD, reports+filters, transactions/shop-sales, translations (tracking + AI 503), brand logo upload/reset/xss, homepage negative stats | owner + narrow (matrix) | en (+5 sweep) | D+M | UI + API + WS | Pass |
| Sub-role dashboards ("—/Not available"), forbidden-page redirect, select-role | support/finance/analytics/tech_support/operations | en | D | UI | Pass (R2-M2) |
| Auth matrix: `/api/school/*` per role, `/hq/*` GET by school/anon token, section guard | all 7 + school + anon | — | — | API | Pass (R2-H2, R2-M18) |
| 5-locale sweep (22 pages D + 8 pages M) | owner | 5 | D+M | Playwright | 150 loads, 0 key leaks except HQ-R4-01 |

## 2. Findings by severity

### 🟡 Medium
#### HQ-R4-01 — HQ Emails page shows a raw i18n key `hq.emails.var_package_expiry_line` (missing in all 5 locales) + console error
**Where:** `frontend/src/app/[locale]/hq/emails/page.tsx:160,178` list `package_expiry_line` in `PACKAGE_VARS` / `student.credits_low` vars; the variables-reference chip renders `t('var_package_expiry_line')`, but the key **`hq.emails.var_package_expiry_line` does not exist in any of `frontend/messages/{en,it,es,fr,de}.json`** (`grep -c` = 0 in all five; every sibling `var_*` key incl. `var_package_expiry` exists).
**Repro:** load `/{locale}/hq/emails` for any of the 5 locales, desktop or mobile → the variables list shows the literal text `hq.emails.var_package_expiry_line` and the console throws `MISSING_MESSAGE: hq.emails.var_package_expiry_line ({locale})` (thrown at `f3bda94ff56ff70e.js` render). Reproduced on all 5 locales × 2 viewports (10/10 emails loads in the sweep).
**Expected vs Actual:** expected a translated variable description (like the other chips); actual is the raw key + a red console error every render.
**Impact:** a raw translation key visible on a core HQ page in every language; the admin editing templates sees an untranslated internal key where a description belongs. Functionally the `{{package_expiry_line}}` variable still substitutes correctly (verified in test-send); only its help label is broken.
**Evidence:** `$SP/reports/dumps/hq-sw-*-emails.txt` (all locales), `$SP/work/hq/20_sweep.log`, `grep` in `frontend/messages/*.json`.
**vs R3:** NEW (regression: the `package_expiry_line` variable was added without its label key).

### 🟢 Low
#### HQ-R4-02 — `school.new_booking` e-mail still hardcodes `📍 {{location_name}} · {{room_name}}` (R3-M14 partial)
**Where:** `backend/notifications/brand_templates.py:233-238` (`_t("school.new_booking", …)`) — all 5 locales use the literal `📍 {{location_name}} · {{room_name}}` line, and the stored `EmailTemplate` rows match (GET `/api/hq/email-templates/`, 5/5 locales still carry `{{location_name}}` and `{{room_name}}`). The PR-#110/`location_line` fix was applied to the `_LESSON_*` fragment (so `student.after_purchase` now uses `{{package_summary}}`, and `student.booking_confirmed`/`booking_cancelled` use `{{location_line}}` — all verified clean), but not to this key.
**Repro:** `GET /api/hq/email-templates/` (owner) → `school.new_booking` × 5 all contain `{{location_name}}`/`{{room_name}}`; `booking_email_context` (`backend/bookings/services.py:304-307`) supplies `location_line` too, so a booking with no room renders the bare `📍 <location> · ` / `📍  · ` line — the exact ST-R2-15 defect `location_line` exists to remove.
**Expected vs Actual:** the brief requires `school.new_booking` to no longer contain `📍 {{location_name}} · {{room_name}}`; it still does.
**Impact:** cosmetic; only the school-facing new-booking e-mail, and only degraded when a lesson has no room/location assigned. `{{lessons_total}}` is gone from all four keys (the receipt bug is fixed).
**Evidence:** `$SP/work/hq/13_m14_l9.log` (STILL BAD rows), `brand_templates.py:233-238`.
**vs R3:** R3-M14 / ST-R3-02 **PARTIAL** (3 of 4 keys fixed live; `school.new_booking` missed).

### Observations (not filed)
- **Library page third-party embeds:** `/hq/library` logs console 404/403 + CSP `Refused to frame 'https://upload.wikimedia.org/'` / `X-Frame-Options` on `w3.org` in every locale — seed library rows pointing at external video/iframe URLs the CSP correctly blocks. The page itself renders; this is external-content noise + working CSP, not an HQ regression.
- **PhoneInput edge case:** typing a full `+39 06 9999 8888` **character-by-character** into the national field (Playwright `.type()`, one input event per key) mangled the stored value to `+3 90699998888`. The realistic paths are clean: paste/`fill` of `+39 06 1111 2222` → `+39 06 1111 2222` (no doubling, R3-L9 HQ-R3-12 fixed) and national-only `06 3333 4444` → `+39 06 3333 4444`. Filed only as a note — the "+39 +39" doubling the fix targeted is resolved.
- **Brand logo synthetic file:** a 1×1 PNG POSTed to `/hq/brand-settings/logo/` returned `invalid_type`; a real 5906×3207 PNG uploaded fine (200, served with `nosniff` + `image/png`). The strict image validation (R3-C2) is working; not a bug.

## 3. Round-3 (and round-2) fix re-verification — every HQ-scope item
| Item | Verdict | Evidence (exact) |
|---|---|---|
| **R3-C1** PUT/PATCH/DELETE team-write guard | **VERIFIED FIXED LIVE** | inv1 (`[dashboard,team]`): PATCH super_admin {email/name/phone/active}→403 `forbidden`, {sub_role:operations}→403 `role_exceeds_caller_permissions`, {sub_role:super_admin}→403 `only_owner_assigns_owner`; **PUT super_admin takeover→403** (row unchanged), DELETE super_admin→403; PATCH/PUT owner→403; DELETE owner→403; PATCH/PUT self→owner/super_admin/operations→403. `02_security.log` |
| **R3-M1** cannot grant a role above own | **VERIFIED FIXED LIVE** | self→operations (PATCH+PUT)→403 `role_exceeds_caller_permissions`; invite create role_detail=operations→403, =owner/super_admin→403 `only_owner_assigns_owner`; PATCH+PUT pending invite→operations/owner/super_admin→403; approve() an operations invite as inv1→403 (defense-in-depth); unknown sub_role→400 `unknown_sub_role`; **lateral** support & finance invites→201; perm-boost own role→403. `02_security.log`, `02b.log` |
| **R3-H3** removed member re-invitable | **VERIFIED FIXED LIVE** | inv2: DELETE→204, login→401 `No active account`; re-invite+approve→201 (`email_sent:true`); **login→200**, `me` role=hq roles=[hq] hq_sub_role=support. `03_h3_h1.log` |
| **R3-H1** (read-only half) narrow HQ on `/api/documents/<id>/` | **VERIFIED FIXED LIVE** | round-3 doc `b9198927…`: support/tech_support/finance/analytics GET→**403**; owner+operations GET→**200** (student "QA R3 X E1 Student"). Doc still exists (not a ghost). GET only, never DELETE. `03_h3_h1.log` |
| **R3-M2** invite-honesty | **VERIFIED FIXED LIVE** | team_invite=false 12s: school-detail Resend UI "Nothing was sent…" + API `email_sent:false`; `POST /school/teachers/resend/`→`sent:false`; Team approve banner "was activated, but the invitation e-mail was not sent…" (amber); no mail arrived; restored true. `12_r3m2.log` |
| **R3-M3** Activate/Deactivate refresh | **VERIFIED FIXED LIVE** | detail page: Deactivate (no reload)→API active=false, "Activate" button now visible; Activate (no reload)→active=true, "Deactivate" visible; badge "Active". `10_ui_schools.log` |
| **R3-M13** calendar WS scope | **VERIFIED FIXED LIVE** | `wss://…/ws/calendar/school/<A>/?token=` support/tech_support/finance/analytics→**REFUSED (1006)**, owner/operations→**OPEN**; teacher WS same; `/ws/nope/`→REFUSED; bad token→REFUSED. `14_ws.log` |
| **R3-M14** stored e-mail copy | **PARTIAL** | `student.after_purchase`→`package_summary` ✓; `student.booking_confirmed`/`booking_cancelled`→`location_line` ✓ (no `{{lessons_total}}` anywhere); **`school.new_booking` ×5 still `📍 {{location_name}} · {{room_name}}`** → HQ-R4-02. `13_m14_l9.log` |
| **R3-L9** nit batch | **VERIFIED FIXED LIVE** | negative homepage stats (students -5 / teachers -1)→**400** `integer >= 0`, values unchanged; non-int→400; `/api/hq/courses/` console 404 **gone** (0 console errors on Packages); armed delete "**1 teacher** will be removed" (singular); test-send samples per-locale (it Amministratrice / en Administrator / de Administratorin / fr Administratrice / es Administradora + localized doc/summary); PhoneInput paste "+39 …"→no doubling; "(copia)"/"Metodo Library" were declared not-bugs by the fix. `13_m14_l9.log`, `13b_testsend.log`, `15_packages.log`, `30_cleanup.log`, `17b_phone.log` |
| **R3-H1/L14 residues** | **VERIFIED** | R3 orphan blobs `teacher-photos/c2cabceb.html`, `66b9d849.svg`, `5c6860bd….html`→**404** (purged, R3-C2); `/Logo.png`→200 `nosniff` `image/png`; `qa.hq.super_admin`→login 200 ACTIVE (R3 hazard repaired). R3 throwaways invite1/2 still inactive (401) — DB rows remain but harmless. `23_brand.log` |
| **R2-C1** takeover via team PATCH | **VERIFIED FIXED** | all PATCH vectors on owner-equiv→403 (see R3-C1). `02_security.log` |
| **R2-H1** demote owner via invite→approve | **VERIFIED FIXED** | invite create/PATCH/PUT/approve with owner-equiv target/role_detail→403 `forbidden`/`only_owner_assigns_owner`. `02_security.log` |
| **R2-H2** HQ matrix on `/api/school/*` + drill-down | **VERIFIED FIXED** | owner/super_admin/operations→200 on courses/locations/students/teachers/closures (?school=A); finance/analytics/support/tech_support→403 on all. `16_matrix.log` |
| **R2-H4** lesson types create/edit | **VERIFIED FIXED** | create all-names 201, blank optionals 201 (name_fr=""), explicit null→400. `17_lt_phone.log` |
| **R2-M2** dashboard fake zeros | **VERIFIED FIXED** | support/tech_support/operations dashboards show "Not available for your role"; forbidden page → clean redirect to dashboard. `21_subroles.log` |
| **R2-M18** HQ settings GET gating | **VERIFIED FIXED** | 13 HQ endpoints→403 school token / 401 anon; only `/hq/lesson-types/`→200 for school token (catalog read, by design). `16_matrix.log` |

## 4. E-mails verified (mail.tm, `@uberip.com`)
| Trigger | Inbox | Delivery | Subject | Locale | Links |
|---|---|---|---|---|---|
| HQ member approve (inv1/inv2/inv3) | qa-r4-hq-invite1/2/3 | 0–1 s | ✉️ Invitation from No Under 40 HQ — Support | EN | `/setup-account?uid&token` → complete-invite 200; reuse 400 |
| HQ member re-invite (R3-H3) | qa-r4-hq-invite2 | 1 s | same | EN | login 200 after |
| School create `?new=1` auto-invite | qa-r4-hq-schoola | 1 s | ✉️ Invito da QA R4 School A — Titolare | IT | `/it/setup-account?uid&token` → complete-invite 200 (school_sub_role owner) |
| School "Resend Invite" | qa-r4-hq-schoola | 1 s | same | IT | — |
| Teacher invite (School A) | qa-r4-hq-teachera | 1 s | ✉️ Invito da QA R4 School A — insegnante | IT | — |
| Template test-send ×5 locales | qa-r4-hq-tsend | ≤2 s | [TEST] R4B `<loc>` `<localized role>` | per-locale | body samples per-locale (HQ-R3-11 fixed) |
| Invite while `team_invite` off | qa-r4-hq-invite3 / teachera | none (expected) | — | — | API `email_sent/sent:false` |

## 5. Verified good (passed)
- All 7 HQ accounts log in; `permissions/mine` correct per role (owner/super_admin 18 perms, operations 11, finance 5, analytics 3, support/tech_support 2).
- Team hierarchy guard is unified across PATCH/PUT/DELETE + invitation create/update/approve; lateral (support/finance) invites still work; roster intact after all probes (founders + owner + super_admin untouched).
- Schools: form validation, auto-slug (`qa-r4-school-a`), IT default language + Europe/Rome tz, list count/subtitle, edit (fee 12.5), R3-M3 toggle, delete cascade (school 404, admin+teacher login 401, HQ↔A conversation 404), linked-records blocker logic.
- Team invite→approve→onboard→login journey; remove→re-invite→login (R3-H3).
- Auth matrix (R2-H2/M18) and section guard for narrow roles all consistent; sub-role dashboards show "Not available".
- Packages create/validation (empty types→400 "Pick at least one lesson type", negative credits→400), no `/hq/courses/` 404; lesson-types CRUD; library CRUD; shop product create/delete; discount create + validation (pct>100→400, max_uses<1→400, R2-M9 holds).
- Reports: unsupported filters ignored (by design), detailed tab/date validated (400), transactions 29 / shop-sales 6.
- Chat/inbox: hq_school thread, cross-side visibility, priority PATCH, status open/in_progress/resolved (choices match UI), realtime `inbox_event/new_message` WS frame on reply.
- Brand logo upload (real PNG → nosniff/image/png), reset to /Logo.png, `.html` upload rejected 400.
- Calendar WS scoping; `/ws/nope/` refused; bad token refused.
- Translations: 2284 tracking rows, AI auto-fill + email auto-translate → 503 `ANTHROPIC_API_KEY not configured` (disconnected, by design).
- i18n: 150 loads, 5 locales × 2 viewports, 0 raw keys / `{var}` / `undefined` / EN-chrome leaks except HQ-R4-01; 0 redirects; "1 teacher" plural correct; per-locale test-send samples.

## 6. Test data created / settings changed (all ids) — all cleaned unless noted
- **School** "QA R4 School A" `b96b3345-5afa-4db8-93cd-cd72aeed104d` (slug `qa-r4-school-a`, admin `qa-r4-hq-schoola@uberip.com` user `f3187957-56ce-4ccc-a895-bbcba1fce5d1`) — **DELETED** (cascade verified). Teacher "QA R4 Teacher A" `5741f9ea-4466-4cb1-9e94-92af6762d970` (never onboarded) — cascaded. HQ↔A conversation `16475e3b-383b-4b67-a907-d5e73fc52e47` (2 msgs) — cascaded.
- **HQ throwaway members** (all **removed**; User rows now inactive per R2-M19a — harmless): `qa-r4-hq-invite1@uberip.com` user `34f6e89e-97e0-4abf-b931-fc12a445127c` (support→custom→removed), `qa-r4-hq-invite2@uberip.com` user `98f8d230-23fa-487d-ae93-e25ed8f17fbf` (removed→re-invited→removed), `qa-r4-hq-invite3@uberip.com` (approved support→removed).
- **Custom role** `qa-r4-team-coordinator` (`[dashboard,team]`) — created, **deleted**. Roles back to 7 builtins.
- **HQ packages** `565e2da4-95bb-49bd-b251-b76d9a769083` + one more create — **deleted**. (R3's `9d950947` "QA R3 HQ Package" left untouched.)
- **Lesson types** `QA-R4-LT` `ad15a73d…`, `QA-R4-LT2` `7f87153d…` — **deleted**.
- **Library** "QA R4 HQ Video" `e4f94a25…` (+1) — **deleted**.
- **Shop** "QA R4 Product" `cab34ee8…` — **deleted**. **Discount** `QAR4HQ10` `7e045d3b…` — **deleted**.
- **Pending invitations** all consumed/removed; `GET /hq/invitations/` → `[]`.
- **Settings changed & restored:** `email-settings.enabled.team_invite` `true→false→true` (12 s window, restored, final dump == baseline); `homepage-settings` stats touched then restored to `0/0/0/0`; brand logo uploaded `/media/public/brand/940bc06f-0137-4463-9fe4-f2cced16bd04.png` then **reset to `/Logo.png`**.
- **Orphan media (harmless):** brand PNG `940bc06f-0137-4463-9fe4-f2cced16bd04.png` (reset repoints the setting, does not delete the byte).
- **Budgets:** 0 self-registrations, 0 password resets. Logins: 7 HQ + inv1/inv2/schoola/teachera onboarding.
- **Final baseline confirmed:** team = 10 (2 founders + h.timur+hqinvite + 7 qa.hq.*), owner=owner, super_admin=super_admin, 7 builtin roles, 0 pending invites, team_invite=true, homepage 0s, logo /Logo.png, 14 schools (no QA R4 School A).

## 7. Screenshots (in `$SP/shots/`)
`hq-dash-owner-en`, `hq-dash-{support,finance,analytics,tech_support,operations}`, `hq-school-new-filled`, `hq-school-detail-new`, `hq-school-detail-resent`, `hq-school-detail-deactivated-noreload`/`-reactivated-noreload` (R3-M3), `hq-school-detail-badge`, `hq-school-resend-disabled` (R3-M2), `hq-team-approve3-disabled` (R3-M2), `hq-school-delete-armed` (R3-L9 "1 teacher"), `hq-school-after-edit`, `hq-schools-list-en`, `hq-packages-en`, `hq-lesson-types-en`, `hq-lt-copy-form`, `hq-inbox-en`/`hq-inbox-thread`, `hq-select-role`, plus full sweep `hq-sw-<locale>-<page>[-m]`. Logs + scripts: `$SP/work/hq/`. Sweep summary: `$SP/reports/dumps/hq-sweep-summary.json`.

## 8. Assumptions / decisions / hazards
- Ran every hierarchy-guard write from **throwaway** members (inv1 attacker / inv2 target); used `qa.hq.super_admin`/`owner` only as refusal targets — all returned 403, so nothing landed and the R3 super_admin lockout was not repeated. super_admin remains ACTIVE.
- Filed HQ-R4-01 as Medium (a raw i18n key visible in all 5 locales + a console error on a core page); the `{{package_expiry_line}}` variable itself substitutes correctly, so no functional data loss.
- Filed HQ-R4-02 as Low and R3-M14 as PARTIAL: the receipt/booking-confirmation bugs are fixed; only the school-facing `school.new_booking` still carries the old placeholders (both built-in and DB), degraded only when a booking lacks a room/location.
- Treated `/hq/lesson-types/` readable by a school token, unsupported report filters ignored, and the library external-embed CSP refusals as by-design (consistent with R3).
- Did not chase the shop `variants` verb (POST→405; it takes PUT) — product CRUD itself works and R3 verified variants via the UI.
- The R3/R4 removed HQ throwaways leave inactive User rows (no product path deletes them); no security impact, flagged for the same DB-hygiene sweep as the R3-L14 items.
