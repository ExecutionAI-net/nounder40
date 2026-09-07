> Round-2 live regression, 2026-09-07 — per-panel detail report written by the hq QA agent. Entry point: [QA_REGRESSION_ROUND2_SUMMARY.md](QA_REGRESSION_ROUND2_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…` or `$SP/reports/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round2-screenshots/](docs/qa/round2-screenshots/).

# QA Full Regression Round 2 — HQ Panel

**Agent:** HQ-panel QA agent (Playwright profile `hq-agent`, inbox prefix `qa-r2-hq-`, screenshots `hq-*`).
**Environment:** https://dev.danzaclassicanounder40.com — live dev, `develop @ 8153889`. Server date 2026-09-07 UTC.
**Time window:** 2026-09-07 ~10:05Z → ~11:00Z UTC.
**Accounts used:** qa.hq.{owner,super_admin,finance,analytics,support,tech_support,operations}@qa-nounder40.test (QaSuite!2026); created member qa-r2-hq-invite1@uberip.com; created School A admin qa-r2-hq-schoola@uberip.com; read-only student qa.student.a@…, teacher qa.teacher@….
**Tenant created (per rules):** 1 school "QA R2 School A" (id e4ce9717-…, later deleted). NOTE side effect: creating it emailed the real HQ staff (`hq.new_school_registered`) — confirmed delivered (see Emails). Only 1 school created (budget ≤2).
**Throttle rule:** switched to cached tokens (one login/account, `/auth/refresh/` after) per coordinator notice; 0 registrations, 1 password-reset logged (evidence for the takeover finding, link unused). Ledger updated.

---

## 1. Coverage

| Area | Sub-roles | Method | Result |
|---|---|---|---|
| Login + dashboard (badge, KPIs, nav) | all 7 built-in + 1 custom | UI (token inject) + curl | Pass; see F/HQ-R2-08 |
| GET team/permissions/invitations authz | all 7 + custom | curl | **Pass — H-1 fixed** (403 for finance/analytics/support/tech_support/operations; 200 owner/super_admin) |
| permissions/mine/ | all 7 + custom | curl | Pass (200 every role, correct label incl. custom) |
| Every HQ write endpoint as support | support | curl | Pass — all 403 (21 POST endpoints) |
| Every HQ read segment as support | support | curl | Pass — all 403 (20 segments) |
| Invite→approve escalation (C-1) | custom "team"-only role | curl | **Pass fixed** for minting owner; **but NEW HQ-R2-01/02** (act-on-existing owner) |
| 4 direct escalation vectors | custom "team"-only role | curl | Pass — all 403/400 |
| Full invite journey + real email | owner→new support member | UI + mailtm | Pass (email, setup, login, badge, reuse-expired) |
| Schools CRUD (create/detail/edit/activate/deactivate/delete/list/filters/sort) | owner | UI + curl | Pass; deactivated-school behaviour documented |
| School fee/commission validation (M-2) | owner | curl (POST+PATCH) | **Pass fixed** (0/100 ok; 101/-1/150/100.01 → 400) |
| Packages CRUD + image + recurring + duplicate + validation (M-1) | owner | UI + curl | **Pass fixed** (credits≤0→400, neg price→400, 12.5 ok) |
| Lesson types CRUD/reorder/image/toggle/delete | owner | UI + curl | **FAIL create+edit via UI — HQ-R2-03**; reorder/toggle/image/delete OK |
| Shop products/variants/images/discount codes/sales/visibility | owner | UI + curl | Pass; discount validation fixed |
| Payments list/filters/date/CSV; reports + detailed | owner, finance, analytics | UI + curl | Pass; CSV inspected; **HQ-R2-04 (500 on bad date)**, **HQ-R2-09 (KPI mismatch)** |
| Inbox HQ↔school (start+reply+status/priority+delete), teacher_support | owner, support | UI + curl | Pass; **HQ-R2-05 (support reads/writes student/teacher chats)** |
| Library video(real mp4)+pdf, scoping, teacher-side, delete | owner, teacher | UI + curl | Pass (teacher sees HQ items; no student page — known gap) |
| Homepage/brand/email settings/templates/locations | owner | UI + curl | Pass; test-send ×5 locales; originals restored |
| Email test-send 5 locales + validation | owner | curl + mailtm | Pass (all 5 arrived, correct locale) |
| Role isolation: HQ token vs school/student/teacher APIs | owner, support | curl | Pass (?school= scoping correct); **HQ-R2-05** |
| Locales ×5 + mobile sweep, every page | owner | Playwright (200 loads) | Pass; i18n gaps HQ-R2-06/07/10/11 |
| /hq/debug, /api/docs, /api/schema, 500s | — | curl + UI | debug=app-404; **docs/schema anon-open (HQ-R2-12)** |

---

## 2. Findings by severity

### 🔴 Critical

#### HQ-R2-01 — A `team`-permission holder (non-owner) can take over an owner/super_admin account by changing its email, then password-reset
**Where:** `backend/accounts/hq_views.py` `HQMemberViewSet.partial_update()` (~lines 60–95). It guards **only** `sub_role` (blocks setting/altering owner-equivalent roles); `email`, `name`, `phone`, `active` are written with **no hierarchy check**. Email is the login (`user.email` synced from the payload).
**Repro (live, reverted):** created custom role "QA R2 Team Coordinator" `[dashboard, team]`, assigned it to qa.hq.tech_support.
1. As coordinator: `PATCH /api/hq/team/<super_admin id>/ {"email":"qa-r2-hq-takeover@uberip.com"}` → **200**, super_admin's email rewritten.
2. `POST /api/auth/login/ {qa.hq.super_admin@…, QaSuite!2026}` → **401** (old email dead); login with the new email + old password → **200**.
3. Anonymous `POST /api/auth/password-reset/ {"email":"qa-r2-hq-takeover@uberip.com"}` → `{"found":true}` and the reset email **arrived** at the attacker inbox (msg 6a9e8ebd…, subject "🔑 Reset your password", working link uid=MzcwMTZjeQ…). Setting a new password there yields full super_admin access.
**Expected:** a caller who is not owner-equivalent must not be able to modify an owner/super_admin member's login-bearing fields.
**Impact:** full account takeover / privilege escalation of the two highest-privilege HQ accounts by any `team`-only role — same severity class as the previously-fixed C-1, via the field the C-1 fix left open. **Reverted immediately** (email restored, super_admin login re-verified 200).
**NEW.**

#### HQ-R2-02 — Same `team`-only caller can silently demote an existing owner/super_admin via invite→approve
**Where:** `PendingInvitationViewSet.approve()` — `_invitation_owner_guard` only blocks `role_detail ∈ {owner, super_admin}`; it does not protect an **existing** owner-equivalent target from being overwritten *downward*. `approve()` does `HQMember.objects.update_or_create(user=user, defaults={sub_role: invite.role_detail, name:…})`.
**Repro (live, reverted):** as coordinator, `POST /api/hq/invitations/ {type:hq_member, email:"qa.hq.super_admin@qa-nounder40.test", name:"QA R2 Demoted", role_detail:"support"}` → **201**; `POST …/approve/` → **201** and the super_admin row is now `sub_role: support` (verified `permissions/mine/` → support). Restored to super_admin.
**Impact:** a `team`-only role can strip every owner/super_admin down to `support` (locking them out of team management), a denial-of-control step that pairs with HQ-R2-01. **High/Critical** (privilege manipulation of higher accounts by a lower one). Reverted.
**NEW.** Suggested fix: in both `partial_update` and the invite guard, reject any mutation whose **target member** is owner-equivalent when the caller is not.

### 🟠 High

#### HQ-R2-03 — HQ Lesson Types cannot be created or edited from the UI (400 on every New / Edit-Save)
**Where:** `frontend/…/hq/lesson-types/page.tsx` builds the payload as `name_fr: form.name_fr || null`, `description_*: … || null`, `video_url_*: … || null`; `backend/catalog/serializers.py::LessonTypeSerializer` is `fields="__all__"` with non-nullable CharFields and no `allow_null`. DRF rejects the nulls.
**Repro:** UI "New" (all visible fields filled — the FR name field was removed from the page's `LANGS` so `name_fr` stays null) → `400 POST /api/hq/lesson-types/`, banner "Something went wrong". "Edit" any row → **Save with no changes** → `400 PATCH …` (9 fields `"This field may not be null."`). Confirmed via curl with the exact UI payload: `{"name_fr":["This field may not be null."], "description_*":[…], "video_url_*":[…]}` 400.
**Works:** reorder (▲/▼), activate/deactivate toggle (`PATCH {active}`), per-language image upload, delete, "Copy" (sends `?? ''`). Only create + full-field edit break.
**Expected:** HQ staff can create/edit the Metodo catalog (which gates every school's course wizard).
**Impact:** a core HQ admin flow is entirely broken through the product UI; names/descriptions/videos of lesson types can't be edited at all. API-level create works only if you omit the null fields. **NEW / REGRESSION-class** (the page ships nulls the serializer refuses). Evidence: `hq-lesson-type-edit-error.png`.

### 🟡 Medium

#### HQ-R2-04 — `GET /api/hq/reports/detailed/?from=notadate` → 500; `POST /api/hq/homepage-settings/ {students:"abc"}` → 500
Unhandled parse errors. `reports/detailed` 500s on a non-ISO `from`/`to`; `homepage-settings` 500s on a non-integer stat (`int()` ValueError). Both need malformed input, low real-world odds, but they are raw 500s with no validation. (Valid inverted ranges `from>to` correctly return empty, not 500.) **NEW.**

#### HQ-R2-05 — HQ `support`/`tech_support` (scoped to dashboard+inbox) can read AND post into every school's private student & teacher conversations
**Where:** chat visibility grants HQ broad access; the HQ inbox **UI** only surfaces `hq_school`, but the API exposes more.
**Repro:** with qa.hq.support token: `GET /api/chat/conversations/?type=school_student` → 200 (4 convs, student names + school), `?type=school_teacher` → 200, `GET /chat/conversations/<school_student id>/messages/` → 200 (message bodies), and `POST …/messages/ {content:…}` → **201** (posted as `sender_role: hq` into a school↔student thread). Deleted the probe message (204).
**Impact:** the lowest-trust HQ roles can read every tenant's private student/teacher chat content (PII) and inject messages, well beyond what their own panel shows. May be intended "HQ oversight", but the scoping is broader than the role's stated `inbox` remit and than the UI implies — worth a conscious decision. **NEW.**

#### HQ-R2-06 — Dashboard never greets the user by name and mashes into the role badge ("WelcomeOWNER")
**Where:** `hq/dashboard/page.tsx` renders `{t('welcome', {name: user.full_name||user.email})}` immediately followed by a `<span>` role badge, but `messages/*.json` `hq.dashboard.welcome` is just `"Welcome"` / `"Benvenuto"` / … with **no `{name}` placeholder** — so the name param is dropped and the greeting abuts the uppercased role pill, reading "WelcomeOWNER", "BenvenutoOWNER", etc. in all 5 locales.
**Impact:** every HQ user, every dashboard load. Cosmetic/content but the prior round already flagged the "missing space" symptom — root cause is the missing placeholder. **STILL OPEN / NEW root-cause.** Evidence: hq-dash-owner-{en,it,es,fr,de}.png.

#### HQ-R2-07 — Roles without the `reports` permission see a dashboard of zeros (misleading), because the dashboard KPI card calls `/hq/reports/` which 403s
**Where:** `hq/dashboard/page.tsx` always `apiFetch('/hq/reports/')`; `.catch(()=>{})` leaves `report=null` → KPIs render `0/0/0/0` and "No Schools". support, tech_support, operations, and the custom `[dashboard,team]` role all show "ACTIVE SCHOOLS 0 / TOTAL STUDENTS 0 / No Schools" although 8 active schools exist. This reproduces the F-scenario "coordinator saw 0/0/No Schools" — it is a **loading/permission artifact, not wrong data** (owner/super_admin/finance/analytics show the true 8/15/44). **Medium** because it looks like the network is empty to those roles. **NEW (F reproduced).**

### 🟢 Low

- **HQ-R2-08 — /hq/permissions labels hardcoded English.** `lib/hq-permissions.ts::PERMISSION_LABELS` (e.g. "Create/Edit Schools", "Metodo Library") is a static English map; the Permissions page shows Create/Edit/Activate/Deactivate/Settings/Email in English on it/es/fr/de.
- **HQ-R2-09 — Reports numbers disagree across tabs/endpoints.** `/hq/reports/` total_students=19; `reports/detailed?tab=schools` KPI total_students=16/18 (varies with date), `tab=students`=20, teachers totals 15↔16↔23. Different scopes/windows/distinct-vs-rows; visibly inconsistent on the same page. No financial impact.
- **HQ-R2-10 — School detail action buttons hardcoded English.** `SchoolActions.tsx` / `SendInviteOnNew.tsx`: "Resend Invite", "Deactivate", "Activate", "Sending...", "Invite email sent.", "Sending invite email…" render in English in every locale.
- **HQ-R2-11 — setup-account `welcomeDesc` is a placeholder in 4 locales.** it "Descrizione Benvenuto", de "Willkommensbeschreibung", es "Descripción de bienvenida", fr "Description de bienvenue" (en is the real sentence). Every invited it/es/fr/de user sees a placeholder.
- **HQ-R2-12 — `/api/docs/` and `/api/schema/` are open to anonymous.** Both return 200 without auth, exposing the full endpoint surface. Likely dev convenience; note before prod.
- **HQ-R2-13 — `POST /api/hq/team/` → 500.** The team ModelViewSet exposes POST (router default) but has no working create path (`HQMemberSerializer.id` is read-only source=user_id); owner and coordinator both get a raw 500. The real flow is invitations; the exposed-but-broken verb should 405/400, not 500.

### Observations (not filed as bugs)
- First HQ-created school account is `school_sub_role: "admin"` (not "owner") though `School.owner` points to it (confirmed for School A: me.school_sub_role=admin, School.owner=that user). Consequence analysis is School-agent scope; from HQ the admin lands in the school panel with full nav.
- Deactivating a school does **not** lock its users out: after `POST /schools/<id>/deactivate/`, the school admin still logs in (200) and reads/writes every `/api/school/*` endpoint (profile PATCH 200); the only visible effect is removal from the public `/schools/public/` list and `?school=` booking. Product decision, but worth confirming intent.
- Deleting a school cascaded to its sole admin user (had no other school/role): the cached access token then returns `401 user_not_found` and refresh 500s. Cascade is intended; the refresh-500 on a deleted user is a minor rough edge.
- `/hq/debug` returns the app's own "404 Page not found" (HTTP 200, client `notFound()`); consistent with round-1. Not a bug.
- Library has no student-facing page (documented conscious gap); teacher side correctly shows HQ items (verified qa.teacher → `/api/teacher/library/` lists "QA R2 HQ Library Video/PDF").

---

## 3. Re-verification of prior-round HQ findings

| Prior finding | Verdict (live) | Evidence |
|---|---|---|
| **C-1** invite→approve mints owner (team-only) | **VERIFIED FIXED** for minting owner: coordinator create/PATCH/PUT/approve of owner/super_admin invitation → 403 `only_owner_assigns_owner`; owner-created owner invite, coordinator approve → 403. **BUT** the same class is only half-closed — see **HQ-R2-01/02** (acting on *existing* owner-equivalents via email-change / downward-demote is still open). |
| C-1 companion: 4 direct vectors (self→owner, self-perm-boost, delete-owner, self-delete) | **VERIFIED FIXED** as coordinator: 403/403/403/400; demote super_admin→support via direct PATCH also 403. |
| **H-1** GET team/permissions leak PII to all roles | **VERIFIED FIXED**: GET /hq/team/ & /hq/permissions/ = 403 for finance/analytics/support/tech_support/operations, 200 owner/super_admin; /permissions/mine/ = 200 all; team page still works (falls back to DEFAULT_SUB_ROLES on 403). |
| **H-2** /hq/translations disconnected + Deploy/AI buttons | **VERIFIED FIXED per PR #64**: on-page banner present ("Editing here updates a tracking table only … a developer must copy the value into frontend/messages/*.json via a normal pull request"); **Deploy/Build button removed** (0 found). DB write to `hq.dashboard.title`=ZZZ_QA_R2_PROBE did **not** change the live dashboard `<h1>` (still "Dashboard"). "Auto-fill with AI" now → **500 `ANTHROPIC_API_KEY not configured`** on dev (key not populated — matches PR note). Reverted DB value to "Title". |
| **L-1** custom-role dashboard badge showed raw key | **VERIFIED FIXED**: badge renders "QA R2 Team Coordinator" (label), not the slug. |
| **M-1** package credits/price no validation | **VERIFIED FIXED**: credits ≤0 → 400 "Credits must be greater than zero." (UI + API), negative price → 400 "Price cannot be negative." (UI + API); 12.5 accepted, 12.25 rejected (>1 decimal), 99999999 rejected (>6 digits). |
| **M-2** school fee/commission range | **VERIFIED FIXED**: platform_fee 101/-1 and shop_commission 150/100.01 → 400 "Must be between 0 and 100." on POST and PATCH; 0 and 100 accepted; non-numeric → 400. |
| **L-3** login email placeholder hardcoded IT | **VERIFIED FIXED**: per-locale placeholders (en name@example.com, it nome@dominio.it, es nombre@dominio.es, fr nom@domaine.fr, de name@domain.de). |
| L-2 HQ invite email locale hardcoded EN | **STILL AS-DESIGNED** (no HQ-language concept); HQ member invite arrived in English. School invite correctly threads School.language (School A invite arrived in IT). |

---

## 4. Emails verified (via mailtm)

| Trigger | Inbox | Arrived (UTC) | Subject | Locale | Link worked? |
|---|---|---|---|---|---|
| HQ member invite (approve) | qa-r2-hq-invite1 | 10:16:49 | ✉️ You've been invited to the Danza Classica No Under 40 team | EN (hardcoded) | Yes — setup-account uid/token, completed setup |
| New-school notify (`hq.new_school_registered`) — to a real HQ member's inbox surrogate | qa-r2-hq-invite1 | 10:19:50 | 🏫 New school in the network: QA R2 School A | EN | link → /en/hq/schools |
| School-owner invite (resend) | qa-r2-hq-schoola | 10:19:51 (×4 from create ?new=1 + 2 resends) | ✉️ Sei stata invitata nel team di Danza Classica No Under 40 | IT (School.language) | Yes — setup-account, School A admin created |
| Password reset (takeover evidence) | qa-r2-hq-takeover | 10:15:24 | 🔑 Reset your password | EN | Yes — working reset link (proves HQ-R2-01) |
| Email template **test-send** ×5 | qa-r2-hq-tsend | 10:26:38–43 | [TEST] team_invite subject per locale (EN/IT/ES/FR/DE all distinct & correct) | each locale | delivered; placeholders rendered (Maria etc.); unknown var left literal `{{unknown_var}}` |
| UI test-send (password_reset IT) | qa-r2-hq-tsend | 10:51:42 | [TEST] 🔑 Reimposta la tua password | IT | delivered |

Email-settings finding: **`enabled.team_invite` was FALSE at round start** (per brief) so invites were silently dropped while APIs returned `email_sent:true`; the coordinator set it TRUE at 10:00Z (I did not touch it). All my invites since then delivered. The HQ Emails UI shows per-template on/off switches ("2/2 on" for ACCOUNT group) but **nothing warns the admin that a disabled template still returns success to the caller** — the invite/approve API answers `email_sent:true` regardless. `email-settings` validation is sound: enabling a key without an English template → 400 `english_required`; disabling `emails_enabled` globally is honored. Toggle `team_invite` off/on is the only lever and there is no "invites are being silently dropped" banner anywhere.

---

## 5. Test data created / left behind

All created via real product flows; all cleaned unless noted.
- **School:** "QA R2 School A" e4ce9717-e382-43e3-918a-9b579f75f2af — **DELETED** (UI, cascade summary shown, 200). Its admin user ba80b7af (qa-r2-hq-schoola@uberip.com) cascaded away (had no other school/role).
- **HQ member:** qa-r2-hq-invite1@uberip.com (user fa788793, support) — invited, approved, setup completed, logged in, then **removed** (UI, 204). NOTE: after removal the user row still exists and can log in (role hq, sub_role support) and reach `/chat/` and `/school/*?school=` (200) even though gone from the roster — a removed HQ member is de-listed but not deauthorized (related to HQ-R2-05 breadth; left as-is, low volume).
- **Custom role:** "qa-r2-team-coordinator" — created, assigned to qa.hq.tech_support, used for escalation tests, **reverted** (tech_support→tech_support) and role **deleted** (204). tech_support confirmed back to `tech_support`.
- **Package:** "QA R2 HQ Package 1" 3f43fd4b — created, image-uploaded, made recurring, duplicated; duplicate deleted; **the original remains** (school=null, credits 12.5, €99, recurring monthly) — left as a benign QA artifact per task ("create … and leave it" applies to the HQ product; package left similarly). Can be deleted on request.
- **Shop product:** "QA R2 HQ Product" d8221b60 — created (€29.90, XS/S variants, 1 image), **left in place** (task: "Create 'QA R2 HQ Product' and leave it").
- **Discount codes:** QAR2HQ10, QAR2HQ20 — created and **both deleted** (204).
- **Lesson types:** several QA_R2_* created via API/UI and **all deleted** (204); catalog back to 12.
- **Library:** created "QA R2 HQ Library Video/PDF" and **deleted** them. **Accident:** two clicks hit seed rows via a fallback locator and deleted seed items 0f7ca23f & fb015f9d; another agent had concurrently restored equivalents (8957b4eb, e96797c0) — I re-created and then removed my duplicates, leaving the seed content present (3 rows). Titles of the restored seeds are non-blank (were blank originally; the create API rejects blank titles) — noted for data hygiene.
- **Chat:** started HQ↔School A conversation 4517edca (2 messages, 1 deleted); posted + deleted a probe into E2's school_student conv 7eb32a4f. Left the School A conversation (school deleted → conv 404).
- **Settings touched & restored to captured originals:** homepage stats, brand color/logo, email header image, student-shop-visibility, translations `hq.dashboard.title`, email templates (`password_reset/en` and `team_invite/it` diffed & restored). Final inventory verified all back to baseline (see progress log).

---

## 6. Not tested / why
- **Stripe onboarding for School A** (would touch real Stripe Connect) — verified UI shows "Stripe Connected: No"; did not run onboard.
- **AI features live output** (`translations/auto-fill`, `email-templates/auto-translate`) — both **500 `ANTHROPIC_API_KEY not configured`** on dev, so behaviour documented but no real translation produced.
- **Package image on the student Buy page** — HQ packages (school=null) are correctly excluded from `/student/school-packages/` (verified: my HQ package not present; 24 school packages listed), so there is no student purchase surface for them (matches the single-engine/HQ-package design).
- **Concurrent-agent data** (other schools, other agents' library/chat rows) — read-only; not mutated except the accidental seed-library rows, restored.

## 7. Assumptions / decisions
- Treated the HQ package "leave it" instruction as covering the created HQ Package 1 and Product; left both. Easy to delete if unwanted.
- Classified HQ-R2-01 as Critical (owner/super_admin takeover by a lower role) and HQ-R2-02 as its High/Critical companion; both were reverted within the same test.
- Used cached tokens + `/auth/refresh/` after the coordinator throttle notice; the one password-reset was pre-notice and is the takeover evidence (logged retroactively).
- Where a UI selector was flaky I cross-verified every finding with curl + a freshly-decoded JWT.

## 8. Screenshot index (all under `$SP/shots/`, prefix `hq-`)
Key evidence: `hq-dash-{owner,support,tech_support,operations,customrole}-*` (F/HQ-R2-06/07), `hq-lesson-type-edit-error` (HQ-R2-03), `hq-translations` + `hq-translations-autofill` (H-2), `hq-team-*` (invite journey), `hq-new-member-dashboard`, `hq-setup-account-form`, `hq-school-{new-filled,detail-new,edit,after-edit,delete-armed}`, `hq-schools-{list,after-delete}`, `hq-packages-{form-filled,after-create,after-edit,final}`, `hq-shop*`, `hq-payments`, `hq-reports-{schools,teachers,students}`, `hq-inbox*`, `hq-library-with-items`, `hq-emails*`, `hq-brand-settings`, `hq-homepage-settings`, `hq-locations*`, `hq-login-{en,it}`, plus the full `hq-sweep-{en,it}-<page>[-mobile]` set (5 locales × ~20 pages × 2 viewports scanned; en+it screenshotted). 146 files total.
