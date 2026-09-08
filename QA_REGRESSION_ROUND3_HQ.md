> Round-3 live regression, 2026-09-08 — per-panel detail report written by the hq QA agent. Entry point: [QA_REGRESSION_ROUND3_SUMMARY.md](QA_REGRESSION_ROUND3_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…`, `$SP/reports/…` or `$SP/work/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round3-screenshots/](docs/qa/round3-screenshots/).

# QA Regression Round 3 — HQ Panel

**Agent:** `hq` (Playwright profile `hq-agent`, inbox prefix `qa-r3-hq-`, screenshots `hq-*`, finding IDs `HQ-R3-NN`).
**Environment:** https://dev.danzaclassicanounder40.com — live dev, `develop @ 6c0cef1` (CI run 34209392001).
**Time window (UTC):** 2026-09-08 ~09:55Z → (see end of file).
**Accounts:** qa.hq.{owner,super_admin,finance,analytics,support,tech_support,operations}@qa-nounder40.test (`QaSuite!2026`); temporary modifications only on qa.hq.tech_support / qa.hq.super_admin (restored, see §6). Never touched c.carlo@cfcholding.it / hakantimur55@gmail.com.
**Method:** one `qa.login` per account (7 logins total), `qa.token` afterwards; every UI observation cross-checked with `qa.api` on a `qa.whoAmI`-validated token; real UI via Playwright for each flow at least once; e-mails via mail.tm (`qa-r3-hq-*@uberip.com`).
**Budgets:** 0 self-registrations used, 0 password resets used (unless stated in §6).

## Progress log (appended as the session goes)
- 09:53Z all 7 HQ accounts logged in once; baseline captured (team=10 rows, roles=7 builtin, email-settings all true, enabled.team_invite=true)
- 09:54Z security script 01 (custom role `qa-r3-team-coordinator` [dashboard,team] on qa.hq.tech_support): R2-C1 PATCH vectors all 403 ✔; **PUT /hq/team/<super_admin>/ → 200 (email+sub_role rewritten) — NEW CRITICAL HQ-R3-01**; PUT self sub_role=owner → 200 (mine → Owner). Side effect: the PUT downgraded super_admin to `support`, so the following invite→approve (201/201) and `DELETE /hq/team/<super_admin>/` (204) succeeded against a no-longer-owner-equivalent target → qa.hq.super_admin was removed and `revoke_hq_membership` deactivated the account (is_active=false, roles=[], tokens blacklisted).
- 09:56Z script 02: re-invite of the removed super_admin as owner → 201/201 (`email_sent:true`), HQMember row back with sub_role=super_admin, but `POST /auth/login/` → 401 "No active account" — **HQ-R3-02 (removed member cannot be re-added; account left inactive)**. Clean R2-H1 re-run against qa.hq.owner target: invite create/PATCH/PUT → 403 ✔. team-only role PATCH self → operations 200 and PATCH pending invite role_detail → operations 200 (HQ-R3-03). tech_support restored (real login 200, sub_role tech_support), custom role deleted, no pending invitations.
- 09:58Z script 03: R2-M18 all 14 HQ GETs → 403 school / 401 anon (only `/hq/lesson-types/` 200 for a school token — catalog read, by design). R2-M1: 500s gone (400/404/405/503); `homepage-settings` accepts negative `-5` (restored to 0); `?month=2026-13`, `?from=x` on transactions/shop-sales/reports silently ignored (200) rather than 400.
- 10:00Z UI schools (owner, en): dashboard greeting "Welcome, QA HQ Owner [OWNER]" renders correctly (R2-L1 fixed, screenshot hq-dash-owner-en); New School form → "QA R3 School A" `35f841ea-12b6-43b5-9ee6-5af6b3eb8ef6` (POST 201, `?new=1` auto-invite "Invite email sent successfully."), invite e-mail in 3 s, IT, subject "✉️ Invito da QA R3 School A — Titolare" (R2-M20 fixed); Resend Invite → "Invite email sent." + second e-mail; Edit saved fee 12.5 (phone got "+39 +39 …" — see edit form note). Admin onboarded via e-mailed /it/setup-account link → `school_sub_role: owner` (R2-M4 fixed), link reuse 400.
- 10:05Z UI toggle re-check: Deactivate/Activate PATCH 200 each time, but the button label + status badge do NOT change until a manual reload (`SchoolActions.toggleActive` → `router.refresh()` only) → a second click re-sends the same state (HQ-R3-04, Low/Medium).
- 10:07Z script 12 R2-H2 matrix vs School A: finance/analytics/support/tech_support → 403 `hq_school_access_forbidden` on GET profile/courses/locations/students/closures, POST locations, PATCH profile, DELETE closures (also for School B); owner/operations → 200 (profile 400 `no_active_school` for any HQ token). Chat: support/tech_support list only hq_school(5)+teacher_support, school_student read/post → 404; finance/analytics see 0 conversations. R2-M19b: deactivated School A → admin 403 `school_deactivated`, refresh 401 blacklisted, login 401 `school_deactivated`; reactivate → 200 again.
- 10:06Z UI team: Invite Member (support) → 201 → pending row → "Activate" modal ("Grant access") → approve 201, "QA R3 Invite One activated."; e-mail in 2 s (EN, "✉️ Invitation from No Under 40 HQ — Support", setup link without locale prefix → /en/); onboarding through /setup-account UI → landed on /en/hq/dashboard as support: KPIs "—" + "Not available for your role" (R2-M2 fixed; 2 console 403s from /hq/reports/ + /hq/schools/). Member id 3a901e07.
- 10:08Z UI team 2: row role select → analytics ("Role updated."), edit modal name → API ok. R2-H15: `enabled.team_invite=false` → UI invite #2 + approve: API `email_sent:false` ✔, no e-mail ✔, but team UI says only "activated." (no warning) and school detail "Resend Invite" shows **"Invite email sent."** although API returned `email_sent:false` (HQ-R3-05). Setting restored to true. Remove member #2 via UI two-click → DELETE 204 → login 401 (R2-M19a fixed). Member #2 d4a39678 removed (account now inactive per HQ-R3-02).
- 10:09Z reports API: /hq/reports/ monthly_revenue = current-month completed tx (172.5/6 rows matched transactions list for Sept before a new €25 purchase landed); tab totals differ by design (link rows vs unique). finance: reports/transactions 200, shop-sales 403; analytics: transactions 403; operations: reports 403, shop-sales 200 — matrix-consistent.
- 10:11Z UI permissions: labels localized keys present (en shows "Create/Edit Schools" etc. — will check other locales in the sweep); "+ Add Profile" → `qa-r3-custom` (201), toggled Dashboard/Inbox/Library → "Save changes (1)" → PATCH 200 → API perms match; owner cells disabled; school-roles matrix: staff+reports toggled → saved → API true → reverted → API equals baseline; team row select lists custom profile, assigned → `permissions/mine` = custom; delete while in use → "assigned to 1 member(s) — reassign them first."; after unassign delete 204.
- 10:12Z API: lesson-type create/PATCH with blank optionals 201/200, explicit null 400 (R2-H4 backend contract OK); LT image upload `?lang=` 200; HQ package create requires lesson types unless all-types (400 "Pick at least one lesson type." — validation OK).
- 10:14Z UI lesson types (R2-H4): New with only code+IT/EN names → 201 (name_fr/description "" not null); Edit → Save with no changes → 200; description+video saved; Deactivate/Activate PATCH; per-language image upload `?lang=it` 200 (file input in edit form); Copy → 201; two-click Delete ×2 → catalog back to 12. Reorder POST 200 (API check: new row gets sort_order on reorder). 1 console 404 on the page (resource unknown).
- 10:16Z UI packages: New Package (IT tab) → 201 `9d950947` (school=null, 12.5 credits, €99, 30 days, all types); Edit → image upload 200 + recurring monthly saved; Duplicate → 201 "QA R3 HQ Package (copia)" (IT suffix in EN UI, Low) → deleted via confirm dialog 204; Deactivate → active=false (re-activated via API). Package KEPT active for the Student agent.
- 10:20Z UI inbox: New Message → School A → conv `0c0e91c5` → message sent (201), priority/status PATCH 200 (selects: first=priority, second=status), School A admin sees the thread (API); realtime: School A reply via API → sidebar badge 24→25 in ≤1 s without reload (`/ws/inbox/` frame `inbox_event/new_message`), back to 24 after reading (PR #105 OK). Quick replies: not available to HQ (POST → 400 "No active school for this user.", no button). Conversation set to Closed stays Closed after a new school reply (observation).
- 10:22–11:04Z UI library/shop/reports/payments/settings/emails, 5-locale desktop+mobile sweep (150 loads), cleanup (School A deleted via UI, members removed, product deleted). Details below.

**Time window end:** 2026-09-08 11:05Z.

---

## 0. Executive summary

The round-2 HQ fixes are **mostly real on dev**: the PATCH-based account takeover (R2-C1), the invite→approve demotion (R2-H1), the four round-1 escalation vectors, the HQ role matrix on `/api/school/*` and chat (R2-H2), lesson-type create/edit (R2-H4), HQ settings GET gating (R2-M18), member/school de-authorization (R2-M19), dashboard fake zeros (R2-M2), the malformed-input 500s (R2-M1), the HQ i18n Lows (R2-L1/L3/L4) and the invite e-mail honesty at API level (R2-H15) all verified live. The realtime inbox badge of PR #105 works (24→25 within 1 s over `/ws/inbox/`).

**But the Critical hole is not closed:** PR #86 guarded only `partial_update`; **`PUT /api/hq/team/<id>/` is still unguarded** and lets a `team`-only role rewrite a super_admin's e-mail + sub_role and promote *itself* to owner (HQ-R3-01). Reproduced live and reverted — with a costly side effect: because the PUT had silently downgraded the super_admin, my subsequent R2 re-tests removed `qa.hq.super_admin`, and the new R2-M19a removal logic **deactivated the user account irreversibly** — re-inviting creates the HQMember row but the account stays `is_active=false` with no `hq` role (HQ-R3-02, High). `qa.hq.super_admin@qa-nounder40.test` is therefore **currently unusable and needs a one-line DB repair by Hakan** (see §8). A `team`-only role can also promote itself to `operations`, which carries cross-school god-mode (HQ-R3-03, Medium). R2-H15 is only half-fixed: the school-detail "Resend Invite" still says "Invite email sent." while the API returns `email_sent:false` (HQ-R3-04).

Counts: **1 Critical, 1 High, 3 Medium, 8 Low**, plus observations. 150 page loads across 5 locales × 2 viewports: zero raw i18n keys / `{var}` / `undefined` leaks.

## 1. Coverage

| Page / flow | Sub-roles | Locales | Viewport | Method | Result |
|---|---|---|---|---|---|
| Login (cached) + dashboard (greeting, KPIs, recent schools) | owner + all 6 sub-roles + new support member | 5 | D+M | UI + API | Pass (R2-L1, R2-M2 fixed) |
| Team-only custom role: PATCH/PUT/DELETE on owner-equivalents, self-edit, invite create/PATCH/PUT/approve, 4 R1 vectors, self→operations | tech_support w/ custom role | — | — | API | **FAIL HQ-R3-01 (PUT)**, HQ-R3-03; PATCH paths pass |
| Re-invite of a removed HQ member | owner | — | — | API + login | **FAIL HQ-R3-02** |
| Schools: list/filters/sort, New (form), detail (`?new=1` auto-invite), Resend Invite, Deactivate/Activate, Edit, Delete w/ linked data | owner | en (+5 in sweep) | D+M | UI + API + mail | Pass; HQ-R3-05 (stale toggle UI), HQ-R3-09 ("1 courses") |
| School admin onboarding via e-mailed `/it/setup-account` link; link reuse | — | it | — | API | Pass (owner membership, reuse 400) |
| Team: invite → pending → Activate modal → approve → e-mail → `/setup-account` UI → dashboard; row role select; edit modal; remove (two-click); R2-H15 toggle | owner; new member | en | D | UI + API + mail | Pass; **HQ-R3-04** (no UI warning) |
| Permissions: custom HQ profile, cell toggles, save, owner locked, assign/unassign via team, delete in-use/after; school-roles matrix toggle + revert | owner | en (+5 sweep) | D | UI + API | Pass |
| Packages (HQ, school=null): create, image, recurring, duplicate, delete, deactivate/activate | owner | en (+5 sweep) | D+M | UI + API | Pass; HQ-R3-10 ("(copia)"), HQ-R3-08 (404) |
| Lesson types: New, Edit-no-change, edit desc/video, reorder, toggle, per-lang image, Copy, Delete | owner | en (+5 sweep) | D | UI + API | Pass (R2-H4 fixed) |
| Payments list/filters/date/CSV; Reports 3 tabs + date filter + export | owner, finance, analytics, operations, support | en (+5 sweep) | D+M | UI + API | Pass (R2-L2 by design) |
| Inbox: new conversation, send, priority/status, school reply, realtime badge, read; visibility per HQ role | owner, support, tech_support, finance, analytics | en (+5 sweep) | D+M | UI + API + WS | Pass (PR #105 OK; R2-H2 chat fixed) |
| Library: create/edit/delete own row; seed rows intact | owner | en (+5 sweep) | D | UI + API | Pass |
| Shop: product create (sizes/prices/shipping), image, stock, toggle, preview, Sell modal, delete; Sales tab; discount code | owner | en (+5 sweep) | D | UI + API | Pass |
| Homepage settings (edit+restore, preview), Brand settings (logo upload + reset), Locations, Translations (banner, AI → 503), Emails (edit IT subject, test-send IT/EN, per-template toggle, restore), Account, Debug | owner | en (+5 sweep) | D+M(emails) | UI + API + mail | Pass; HQ-R3-06/07/11 |
| Malformed input on HQ endpoints (39 probes) | owner | — | — | API | Pass — no 500 (R2-M1 fixed) |
| HQ settings GETs by school/anon tokens (14 endpoints) | school B admin, anon | — | — | API | Pass (R2-M18 fixed) |
| `/api/docs/`, `/api/schema/` anon; `/ws/nope/` | anon | — | — | API | see §5 |
| Locale sweep: 22 pages × 5 locales desktop, 8 pages × 5 locales mobile; scanText + English-token check + console errors | owner | 5 | D+M | Playwright | Pass (0 key leaks) |

## 2. Findings by severity

### 🔴 Critical

#### HQ-R3-01 — `PUT /api/hq/team/<id>/` bypasses every hierarchy guard: a `team`-only role rewrites a super_admin's e-mail and role, and promotes itself to owner
**Where:** `backend/accounts/hq_views.py` `HQMemberViewSet` — PR #86 moved the owner-equivalent guard into `partial_update()` only; `update()` (HTTP PUT, exposed by `ModelViewSet`) is not overridden and `HQMemberSerializer` has `email`, `name`, `sub_role`, `active` writable.
**Repro (live 09:54Z, reverted):** owner created custom role `qa-r3-team-coordinator` `[dashboard, team]` and assigned it to `qa.hq.tech_support` (`permissions/mine` → `["dashboard","team"]`). As that user:
- `PATCH /api/hq/team/37016cc9…(super_admin)/ {"email":…}` / `{name}` / `{phone}` / `{active:false}` / `{sub_role:"support"}` → **403** each (R2-C1 fix works for PATCH).
- `PUT /api/hq/team/37016cc9…/ {"email":"qa-r3-hq-takeover@uberip.com","name":"QA HQ Super Admin","sub_role":"support","active":true}` → **200** — row now `email: qa-r3-hq-takeover@…, sub_role: support` (confirmed by owner GET).
- `PUT /api/hq/team/<own id>/ {"email":…,"name":…,"sub_role":"owner","active":true}` → **200**; `GET /hq/permissions/mine/` → `{"key":"owner", … 18 permissions}`.
- Knock-on: with the target now `support`, the R2-H1 vector (`POST /hq/invitations/` with the super_admin's e-mail + approve → 201/201) and `DELETE /hq/team/<super_admin>/` → **204** both succeed — the whole R2-C1/H1 protection collapses behind one PUT.
Note: PUT writes `HQMember.email` but not `User.email` (the sync lives in `partial_update`), so the *login* e-mail is not changed by PUT alone; the role change however is fully effective (`effective_hq_sub_role()` reads `HQMember.sub_role`), so self→owner is a complete privilege escalation, and target→support is a complete demotion/lockout of every owner/super_admin.
**Expected:** PUT must apply the same target-hierarchy and `only_owner_assigns_owner` checks as PATCH (or be disabled: `http_method_names` without `put`).
**Impact:** full privilege escalation to Owner by any custom role holding `team`; demotion and removal of all owner-equivalent accounts. **vs R2:** R2-C1 **NOT FIXED in effect** (PATCH closed, PUT open — same class as the "residual surface" pattern that produced R2-C1 itself). Evidence: `$SP/work/hq/01_security.log`, `02.log`.

### 🟠 High

#### HQ-R3-02 — Removing an HQ member permanently deactivates the whole user account; re-inviting cannot bring it back
**Where:** `backend/accounts/security.py::revoke_role()` (PR #98 / commit `ee646cf`, R2-M19a) sets `is_active=False` when no other role/profile remains and blacklists tokens; `PendingInvitationViewSet.approve()` re-uses the existing `User` row but never re-adds `Role.HQ` to `roles`/`role` nor resets `is_active`; `complete-invite` only sets the password.
**Repro (live 09:56Z):** after `DELETE /hq/team/37016cc9…/` (204) on `qa.hq.super_admin`: `/auth/me/` with the old access → 401 `user_inactive`; refresh → 401 blacklisted (as designed). Then as owner: `POST /hq/invitations/ {type:hq_member, email:qa.hq.super_admin@…, role_detail:super_admin}` → 201, `…/approve/` → **201** (`email_sent:true`, HQMember row back as super_admin, listed on the Team page) — but `POST /auth/login/` → **401 "No active account found"**. Same for the two throwaway members I removed via the UI (`qa-r3-hq-invite1/2@uberip.com`): removed → login 401 → no product path re-enables them.
**Expected:** re-inviting an e-mail that belongs to a deactivated, role-less user should restore `hq` in `roles`, set `role`, and `is_active=True` (or removal should not deactivate). At minimum the Team page should not show a "member" who cannot log in.
**Impact:** any HQ staff member removed once can never be re-added through the product — a ghost row appears on the Team page while the person is locked out. **Environment hazard:** `qa.hq.super_admin@qa-nounder40.test` is in this state now (see §8 for the repair). **vs R2:** NEW (regression introduced by the R2-M19a fix).

### 🟡 Medium

#### HQ-R3-03 — A `team`-only role can promote itself (or a pending invite) to `operations`, which carries cross-school god-mode
**Repro:** as the `[dashboard, team]` coordinator: `PATCH /hq/team/<own id>/ {"sub_role":"operations"}` → **200**, `permissions/mine` → operations (11 permissions incl. `schools_create_edit`, `schools_activate`, `shop`, `packages`, `library`…); `PATCH /hq/invitations/<pending>/ {"role_detail":"operations"}` → 200. `operations` = `hq_school_godmode()` on every `/api/school/*` and every chat conversation (PR #89). Only `owner`/`super_admin` are protected by `_HQ_OWNER_EQUIVALENT`.
**Expected:** a caller should not be able to assign a role with more permissions than its own (or at least not `schools_create_edit` / `permissions` / `team` holders). **Impact:** lateral escalation from "manage the roster" to "write every tenant's data". **vs R2:** NEW (widened by the R2-H2 fix making `schools_create_edit` the god-mode key).

#### HQ-R3-04 — Invite UIs still claim success when the invite e-mail was not sent (`email_sent:false`)
**Repro (10:08Z, `enabled.team_invite=false`, restored):** HQ Team → Invite → Activate: API `POST …/approve/` → 201 `{"email_sent": false}`, UI shows "QA R3 Invite Two activated." with **no warning**; School detail → "Resend Invite": API `{"success":true,"email_sent":false}`, UI shows **"Invite email sent."** (`SchoolActions.tsx` sets `success` on any 2xx). No e-mail arrived in 45 s (inbox `qa-r3-hq-invite2`). **vs R2:** R2-H15 **PARTIAL** — API fixed by PR #106, the HQ frontend follow-up the PR itself flagged is not done; the school-detail message is actively wrong. Evidence: `hq-team-approve2-disabled.png`, `hq-school-resend-disabled.png`.

#### HQ-R3-05 — School Deactivate/Activate button and status badge don't update until a manual reload; a second click re-sends the same state
**Where:** `frontend/src/app/[locale]/hq/schools/[id]/SchoolActions.tsx::toggleActive` → `PATCH {active}` then `router.refresh()`; the page fetches the school client-side (`apiFetch` in `page.tsx`), so `refresh()` re-renders nothing. **Repro:** detail page → "Deactivate" → PATCH 200, API `active:false`, button still reads "Deactivate", badge still "Active"; clicking again sends `active:false` again; after reload the UI is correct. Reproduced in both directions. **Impact:** an admin cannot tell whether the toggle worked; double-click leaves the school in the opposite state from what they think. **vs R2:** NEW. Evidence: `hq-school-detail-after-activate-noreload.png`.

### 🟢 Low

- **HQ-R3-06** — `POST /hq/homepage-settings/ {"students": -5}` → 200 and `stat_students="-5"` is persisted (shown on the public homepage when real-stats is off). Non-integer is now 400 (R2-M1 fixed) but sign is not validated. Restored to `0`.
- **HQ-R3-07** — Unsupported filter names are silently ignored instead of 400: `/hq/transactions/?month=2026-13`, `?from=x&to=y`, `/hq/shop-sales/?month=2026-99`, `/hq/reports/?from=x`, `/hq/students/?school=x` all 200 with the full list (the page uses `date_from`, which is validated). Not a 500 — informational.
- **HQ-R3-08** — `/hq/packages` requests `GET /api/hq/courses/?active=true` → **404** on every load in every locale/viewport (console error). `components/PackagesManager.tsx:254` fetches `${panelBase}/courses/`, an endpoint that only exists for the school panel.
- **HQ-R3-09** — School delete armed label: "Sure? **1 courses** will be removed too — click again" (`hq.schools.linkedCourses` not pluralised for count 1). Evidence `hq-school-delete-armed.png`.
- **HQ-R3-10** — "Duplicate" package names the copy "… **(copia)**" in the EN UI (Italian suffix). Evidence `hq-packages-after-dup` dump.
- **HQ-R3-11** — E-mail template test-send sample context is Italian for every locale: EN/DE test mails read "Invitation from Dance Studio Roma — **Amministratrice**". (`locale` only selects the sample data; the mail body is whatever the editor holds — correct.)
- **HQ-R3-12** — School edit `PhoneInput`: typing a full "+39 02 …" into the national-number field stores "+39 +39 02 …" (no normalisation; the field accepts "+"). My first edit did this; fixed by re-entering.
- **HQ-R3-13** — Library page title/subtitle "Metodo Library" appears untranslated in it/es/fr/de (only English UI token found by the sweep; likely intentional brand name — flagged for a decision).

### Observations (not filed)
- `GET /hq/lesson-types/` is readable by a school token (200) — the course wizard needs the Metodo catalog; every other HQ segment is 403 (R2-M18). By design.
- HQ↔School conversation set to "Closed" stays Closed after a new school message (list shows "Closed · this minute"); the unread badge still counts it. Product decision.
- HQ has no quick replies (`POST /chat/quick-replies/` → 400 "No active school for this user."; no button in the HQ thread). Task item not applicable.
- Brand settings "Save" writes 8 new `sidebar_*_bg/text` keys with default values (not present before; harmless, left in place).
- `/hq/debug` = app 404 page (HTTP 200), as in R2. Two console 403s on a support member's dashboard (`/hq/reports/`, `/hq/schools/`) — expected, now rendered as "Not available for your role".
- Reports "Schools" tab KPI `total_students` 25 vs dashboard 27 (link rows vs unique students) — documented as by design in PR #109; still visible on the same page.
- Lesson-type ▲ reorder on a just-created row (sort_order `null`) did not move it in the UI run; the API reorder assigns sort_order and moves it. Not reproduced twice — noted only.

## 3. Round-2 fix re-verification

| R2 item | Verdict | Evidence |
|---|---|---|
| **R2-C1** owner/super_admin takeover via team PATCH | **PARTIAL / NOT FIXED IN EFFECT** — PATCH on email/name/phone/active/sub_role → 403 ✔; **PUT → 200** (HQ-R3-01); self-edit 200 ✔; owner editing owner (PATCH name) — could not re-verify on super_admin after its removal, verified on owner→tech_support restore (200) | 01_security.log |
| **R2-H1** demote owner-equivalent via invite→approve | **VERIFIED FIXED** (clean run vs owner target): create 403 `forbidden` (also upper-case e-mail), PATCH/PUT e-mail→owner 403, role_detail owner 403 `only_owner_assigns_owner`; owner-created invite for a new address PATCHed to `operations` by coordinator → 200 (HQ-R3-03) | 02.log |
| R1 vectors: self→owner, self→super_admin, self perm boost, delete owner, self-delete, POST team | **VERIFIED FIXED**: 403 / 403 / 403 `forbidden` / 403 / 400 `cannot_remove_self` / **405** (HQ-R2-13 fixed) | 01_security.log |
| **R2-H2** HQ matrix on `/api/school/*` + chat | **VERIFIED FIXED**: finance/analytics/support/tech_support → 403 `hq_school_access_forbidden` on GET profile/courses/locations/students/closures, POST locations, PATCH profile, DELETE closures, for School A and School B; owner + operations 200; support/tech_support list only `hq_school`(5)+`teacher_support`, school_student read/post → 404; finance/analytics 0 conversations. HQ UI school drill-down (detail page → `/school/locations/?school=`) works for owner ("Locations (1)") | 12.log |
| **R2-H4** lesson types UI create/edit 400 | **VERIFIED FIXED**: New (blank optionals) 201, Edit→Save no change 200, desc/video saved; explicit `null` still 400 (contract) | 18.log, 17.log |
| **R2-H15** invite e-mails silently dropped | **PARTIAL**: API `email_sent:false` on approve + school resend-invite ✔, no e-mail ✔; HQ Team and School detail UIs still report success (HQ-R3-04); toggle restored `true` | 15.log |
| R2-M1 malformed input (HQ part) | **VERIFIED FIXED**: `POST /hq/team/` 405, homepage `students:"abc"` 400, `reports/detailed?from=notadate` 400, `?tab=xyz` 400, bad UUID 404/400, garbage JSON 400, auto-translate/auto-fill **503** (was 500). 39 probes, zero 500s | 03.log |
| R2-M2 dashboard fake zeros | **VERIFIED FIXED**: support/new member → "—" + "Not available for your role" (en/it/de) | hq-new-member-dashboard.png, hq-dash-support-it/de.png |
| R2-M4 first school account is `admin` | **VERIFIED FIXED**: School A admin `school_sub_role: owner` after setup | 10/complete-invite log |
| R2-M11 setup-account placeholder copy | **VERIFIED FIXED** it/de/es/fr real sentences | 40.log, hq-setup-copy-it.png |
| R2-M18 HQ settings GETs | **VERIFIED FIXED**: 14 endpoints 403 for school token, 401 anon | 03.log |
| R2-M19a removed member still logs in | **VERIFIED FIXED** (login 401, tokens blacklisted) — with regression HQ-R3-02 | 15.log, 40.log |
| R2-M19b deactivated school not locked out | **VERIFIED FIXED**: 403 `school_deactivated`, refresh 401, login 401 `school_deactivated`, reactivation restores | 12.log |
| R2-M20 invite names school/role | **VERIFIED FIXED**: "✉️ Invito da QA R3 School A — Titolare", "✉️ Invitation from No Under 40 HQ — Support" | §4 |
| R2-L1 greeting `{name}` | **VERIFIED FIXED** in 5 locales (Welcome/Benvenuto/Bienvenido/Bienvenue/Willkommen, QA HQ Owner + badge) | hq-sweep-*-dashboard |
| R2-L2 report numbers differ | **BY DESIGN** (PR #109 comment) — still visibly 25 vs 27 | 22.log |
| R2-L3 HQ-R2-08 permissions labels / HQ-R2-10 school buttons | **VERIFIED FIXED**: it "Crea/Modifica scuole", "Gestione Team"; fr "Créer/Modifier les écoles"; de "Schulen anzeigen"; school detail it "Modifica Scuola" | sweep dumps |
| R2-L4 `citiesLabel` plural | **VERIFIED FIXED**: "2 città · 11 scuole / 1 città · 1 scuola", "1 ciudad · 1 escuela", "1 ville · 1 école" | hq-sweep-*-locations |
| R2-L5 / HQ-R2-12 `/api/docs/`+`/api/schema/` anon; X-R2-15 unknown `/ws/` 500 | **VERIFIED FIXED** (11:05Z): anon 401, school token 403, HQ 200 on both; `/ws/nope/` → HTTP 400, not 500 | API check |
| H-2 translations disconnected | **VERIFIED**: tracking-only banner, no Deploy button, "Auto-fill" → clean "Error: ANTHROPIC_API_KEY not configured" (503) | hq-translations-autofill.png |
| PR #105 realtime unread badge | **VERIFIED**: `/ws/inbox/?as=hq` connected, `inbox_event/new_message` frame, badge 24→25 in ≤1 s on dashboard and on inbox list, 25→24 after reading | 20.log, hq-dashboard-badge-realtime.png |
| HQ-R2-13 `POST /hq/team/` 500 | **VERIFIED FIXED** (405 with message) | 03.log |

## 4. E-mails verified (mail.tm, `@uberip.com`)

| Trigger | Inbox | Delivery | Subject | Locale | Links |
|---|---|---|---|---|---|
| School create `?new=1` auto-invite | qa-r3-hq-schoola | 3 s | ✉️ Invito da QA R3 School A — Titolare | IT (School.language) | `/it/setup-account?uid&token` → worked (complete-invite 200), reuse → 400 |
| School "Resend Invite" | qa-r3-hq-schoola | 0 s | same | IT | — |
| HQ member approve | qa-r3-hq-invite1 | 2 s | ✉️ Invitation from No Under 40 HQ — Support | EN (user language) | `/setup-account?uid&token` (no locale prefix → /en/) → completed in UI |
| HQ member approve with `team_invite` disabled | qa-r3-hq-invite2 | **none in 45 s** (expected; API `email_sent:false`) | — | — | — |
| Template test-send, IT tab (UI) | qa-r3-hq-tsend | 2 s | [TEST] ✉️ Invito da Dance Studio Roma — Amministratrice [QA R3] | IT | — |
| Template test-send, EN tab (UI) | qa-r3-hq-tsend | ≤2 s | [TEST] ✉️ Invitation from Dance Studio Roma — Amministratrice | EN body | — |
| Template test-send via API `locale=en` / `locale=de` with EN content | qa-r3-hq-tsend | ≤3 s | [TEST] ✉️ Invitation from … — Amministratrice | EN body both (content = payload) | — |
| New-school HQ notification (`hq.new_school_registered`) | real HQ members | not observed (no HQ inbox of mine) | — | — | — |

## 5. Verified good (passed)
- All 7 HQ accounts log in; `permissions/mine` correct for each; owner/super_admin/operations keep cross-school access, finance/analytics/support/tech_support do not (R2-H2).
- `/api/docs/` and `/api/schema/`: anon **401**, school token **403**, HQ **200**; unknown `/ws/nope/` no longer 500 (see 11:05Z check below).
- Schools: form validation (name/e-mail/fee), auto slug, IT default language + Europe/Rome timezone, counts on list, Active/Inactive filters, sort, edit (fee 12.5 saved), linked-records summary, delete cascade (school 404, admin user removed → login 401, HQ↔school thread gone), financial-records blocker logic present (`blocking.transactions/shopOrders`).
- Team: invite form role list (7 roles + custom profiles), pending list, Activate/Grant-access modal, approve, "Role updated." via row select, edit modal (name), two-click Remove, member gone + de-authorised.
- Permissions: custom profile CRUD, cell toggles + "Save changes (n)", owner column locked, in-use delete refused with count, school-roles matrix editable and revert verified equal to baseline (owner:17/admin:17/staff:8).
- Packages: validation (lesson types required unless all-types), image upload, recurring monthly, duplicate, delete confirm, deactivate; HQ package excluded from student storefront (31 school packages listed anonymously, none HQ).
- Lesson types: full CRUD + copy + per-language image + reorder API; catalog back to 12.
- Payments: status/school/date filters, CSV export (12 columns, filtered rows); Reports: 3 tabs, date filter, Export CSV present; monthly revenue = current-month completed transactions (matches list).
- Inbox: create/send/priority/status, school side sees the thread, realtime badge, read resets badge; support/tech_support cannot see or post into school↔student threads.
- Library: create video (IT, intermediate, 120 s), edit title + visible-to-students, delete only own row; 3 seed rows untouched.
- Shop: product with sizes S/M, sale/full price, shipping, image, stock 5/3 (`shop_product_variants`), toggle, preview, Sell modal (not submitted), Sales tab (4 sales), discount code create/list/delete.
- Settings: homepage stats save/restore + preview, brand logo upload → `/media/public/brand/…` and reset via `DELETE …/logo/` → `/Logo.png` (public `/platform-stats/` confirms), locations (IT 2 cities/11 schools, ES 1/1; School A shown after creation; calendar link copy), translations banner + AI error, e-mails: 27 templates, subject edit/save, test-send, per-template switch persists in `email-settings`, "All emails: On" untouched, account page (change password form), debug (404 page).
- i18n sweep: 150 loads, 0 raw keys, 0 `{var}`, 0 `undefined`, no locale redirects; greeting/permissions/school buttons/plurals localised.
- Malformed input: no 500 anywhere in 39 probes.

## 6. Test data created / settings changed (all ids)
- **School** "QA R3 School A" `35f841ea-12b6-43b5-9ee6-5af6b3eb8ef6` (slug `qa-r3-school-a`, e-mail `qa-r3-hq-schoola@uberip.com`) — **DELETED via UI** (200, cascade). Admin user `77bd271f-d5d7-488c-bc74-ece37bbd0a32` cascaded (login 401). Location `765fcb81…` + course "QA R3 Corso A" `3da20cb5…` (created by its admin) cascaded. HQ↔A conversation `0c0e91c5…` (4 messages) cascaded.
- **HQ members:** `qa-r3-hq-invite1@uberip.com` user `3a901e07…` (support→analytics→custom→support) — **removed via UI**; `qa-r3-hq-invite2@uberip.com` user `d4a39678…` — **removed via UI**. Both user rows remain **inactive & role-less** (HQ-R3-02); harmless throwaways.
- **Invitations:** all consumed or deleted; `GET /hq/invitations/` → `[]`.
- **Custom roles:** `qa-r3-team-coordinator` (created twice, deleted twice), `qa-r3-custom` (deleted). Roles back to the 7 builtins.
- **Package** "QA R3 HQ Package" `9d950947-e938-4a95-8ba1-7d9a7a2b6d16` (school=null, 12.5 credits, €99, 30 days, recurring monthly, image) — **KEPT, active** for the Student agent (R2's `3f43fd4b` also still there). Duplicate `65fac939…` deleted; API package `QA R3 HQ Pkg API` never created (400).
- **Shop product** "QA R3 HQ Product" `6a81359d…` — created then **deleted via UI**; R2 product `d8221b60` untouched. Discount code `QAR3HQ10` `41ad1335…` deleted.
- **Lesson types** `QA-R3-LT-API` `a32edfc5`, `QA-R3-LT-UI` `0274eaf7`, `QA-R3-LT-COPY`, `QA-R3-LT-ORD` — all deleted (catalog = 12).
- **Library** "QA R3 HQ Library Video" `5de51e68…` — deleted; seed rows `8957b4eb`, `e96797c0`, `5a656c1c` intact.
- **Chat:** no quick reply created (400). 
- **Accounts modified & restored:** `qa.hq.tech_support` (sub_role → custom → operations → owner(PUT) → custom → tech_support; name unchanged) — restored, real login 200, `permissions/mine` = tech_support. `qa.hq.super_admin` — **NOT restorable by me** (see §8).
- **Settings:** `homepage-settings.stat_students` `0→-5→0`, `0→123→0` (restored); brand logo `/Logo.png → /media/public/brand/62867ddf….png → /Logo.png` (restored via DELETE logo); brand Save added `sidebar_{hq,school,teacher,student}_{bg,text}` defaults (new keys, left); `email-settings.enabled.team_invite` `true→false→true` (twice, restored; final dump identical to baseline); `team_invite/it` subject `… → … [QA R3] → …` restored byte-equal (body too); school-roles `staff` +reports → reverted.
- **Orphan media** (harmless): lesson-type PNGs `9a1e77f2`, `b91e5f2b`; package PNGs `76f0e7e8`, `85c12b43`; brand PNG `62867ddf`; shop image for the deleted product.
- **Budgets:** 0 self-registrations, 0 password resets; logins: 7 initial + 1 tech_support re-verify + 1 super_admin check + 3 negative-check logins (removed users/deleted admin, all 401).

## 7. Screenshots (217 files `hq-*.png` in `$SP/shots/`, 210 dumps in `$SP/reports/dumps/`)
Key evidence: `hq-dash-owner-en`, `hq-dash-support-{it,de}`, `hq-new-member-dashboard`, `hq-school-new-filled`, `hq-school-detail-new`, `hq-school-detail-resent`, `hq-school-detail-after-activate-noreload` (HQ-R3-05), `hq-school-resend-disabled` (HQ-R3-04), `hq-school-delete-armed` (HQ-R3-09), `hq-team-*` (invite journey, approve modal, approve2-disabled, remove-armed), `hq-setup-account`, `hq-permissions-{en,saved,delete-inuse}`, `hq-lesson-type-*`, `hq-package-*`/`hq-packages-*`, `hq-inbox-*`, `hq-dashboard-badge-realtime`, `hq-library-*`, `hq-shop-*`, `hq-reports-*`, `hq-payments-*`, `hq-homepage-settings-*`, `hq-brand-settings-*`, `hq-locations-*`, `hq-translations-*`, `hq-emails-*`, `hq-account-en`, `hq-debug-en`, `hq-setup-copy-it`, full sweep `hq-sweep-<locale>-<page>[-mobile]`. Summary JSON: `$SP/reports/dumps/hq-sweep-summary.json`. Scripts + logs: `$SP/work/hq/`.

## 8. Assumptions, decisions, hazards
- **HAZARD — `qa.hq.super_admin@qa-nounder40.test` is unusable** (is_active=false, roles=[], HQMember row present as super_admin). Caused by my HQ-R3-01 probe chain (PUT downgrade → R2-H1/DELETE re-tests succeeded against the downgraded row). No product flow can repair it (HQ-R3-02). Django-shell repair for Hakan: `from accounts.models import User; u=User.objects.get(email='qa.hq.super_admin@qa-nounder40.test'); u.is_active=True; u.role='hq'; u.roles=['hq']; u.hq_sub_role='super_admin'; u.save()` (the HQMember row already exists). Other agents relying on super_admin this round should use `qa.hq.owner` instead.
- Filed HQ-R3-01 as Critical (same class as R2-C1; a `team`-only custom role reaches Owner) and HQ-R3-02 as High (irreversible lockout of a core admin flow, no data loss).
- Treated `GET /hq/lesson-types/` for school tokens, conversation status persistence and HQ quick replies as design, not bugs.
- The e-mail "EN tab sent Italian" mid-run observation was my locator hitting the sidebar language button; the API check proved test-send mails the payload content. Not filed.
- Reports/transactions "month/from" params: the UI uses `date_from`; filed only as Low strictness note.
- "Metodo Library" untranslated is filed as Low for a decision; likely a brand name.
- Kept one HQ package (`9d950947`) active for the Student agent; everything else I created is gone.
- Did not test Stripe onboarding for School A (hCaptcha) nor the manual "Sell" submission (would create a financial record on a student of another tenant).
