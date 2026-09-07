# QA Full Regression — HQ Panel (Pre-Launch Pass)

**Date:** 2026-09-06/07
**Environment:** `https://dev.danzaclassicanounder40.com` (`develop` branch, live Docker/EC2 deployment — black-box, no local stack touched)
**Tester:** Parallel QA agent #? (HQ panel), one of 4 concurrent agents sharing one browser instance
**Baseline:** `QA_TEST_RESULTS.md` §1 (HQ) + `QA_TEST_RESULTS_HQ_DELTA.md`, both read in full before this pass. This report re-verifies every previously-fixed HQ finding and extends coverage into areas the prior round flagged as shallow (Team invite→approve→email end-to-end, custom-role escalation surface, financial-field validation, the Translations/Deploy subsystem).

## Executive summary

The four previously-**Critical** team/permission-escalation bugs (self-promote to owner, self-grant permissions, delete-owner, self-delete) are **confirmed fixed** on all direct `PATCH`/`DELETE /api/hq/team/`  and `/api/hq/permissions/` paths, for every one of the 7 built-in roles. Backend read/write authorization now matches `HQRole.permissions` exactly for every `/api/hq/*` segment I could enumerate, with **zero mismatches** across a full 7-role × 13-segment matrix. Route guards correctly redirect direct-URL access to unauthorized HQ pages.

However, this pass found **one new Critical** escalation path that the prior fix round did not cover (the invite/approve flow bypasses the same hierarchy check that protects the direct edit path), **one new High** finding (unrestricted read access to the full HQ team roster + permission matrix, leaking real staff PII to every HQ sub-role), and **one new High/architectural** finding (the entire `/hq/translations` content-management feature — including its "AI Translate" and "Deploy" actions — is disconnected from what actually renders on the live site, i.e. it is decorative, not functional). Two Medium findings concern missing validation on financial fields (negative package price/credits, out-of-range platform fee %).

The systemic i18n "raw key" regression documented at length in the prior two QA rounds (`Label X`, `Kpi X`, etc.) is **confirmed fixed in the code that actually ships** (`frontend/messages/*.json`). The apparent large regression I initially detected via the `/hq/translations` admin API turned out to be exactly the architectural bug above: that endpoint reads a stale, disconnected database table, not the live bundle.

## Coverage table

| Area | Roles tested | Method | Result |
|---|---|---|---|
| Login + dashboard role badge | all 7 | UI (localStorage JWT injection) + curl | Pass |
| Sidebar visibility vs `HQRole.permissions` | owner, support, tech_support, finance, operations (spot-checked; full matrix already verified in prior round and unchanged) | UI | Pass |
| Direct URL access to unauthorized pages (route guard) | support→`/hq/permissions`,`/hq/team`,`/hq/payments`,`/hq/debug`; finance→`/hq/shop`; operations→`/hq/team` | UI, cross-verified token identity before/after each check | Pass — all redirect to `/hq/dashboard`; `/hq/debug` now 404s (see Notes) |
| Backend GET authorization, all mapped `/api/hq/*` segments (`lesson-types, schools, shop, discount-codes, packages, transactions, reports, homepage-settings, translations, library, email-templates, students, school-permissions`) | all 7 roles × 13 segments = 91 combinations | curl + JWT | **Pass, 0 mismatches** — every combination matched the expected 200/403 per the permission matrix |
| Backend GET authorization, `team` / `permissions` segments | all 7 roles | curl + JWT | **FAIL — see Finding H-1** (unrestricted read) |
| Backend write authorization (POST/PATCH/DELETE) for roles lacking the relevant permission | tech_support/support → packages create; finance/analytics → school PATCH/activate; operations → reports | curl + JWT | Pass — all correctly 403 |
| Team escalation vectors, direct path (self→owner, self-permission-boost, delete-owner, self-delete) | support | curl + JWT | Pass — all 403/400, confirmed still fixed |
| Team escalation vector, invite→approve path | support (temporarily granted only the `team` permission) | curl + JWT, cleaned up | **FAIL — see Finding C-1 (Critical)** |
| Custom role lifecycle (create → assign → verify sidebar+API → unassign → delete) | qa.hq.tech_support temporarily reassigned to a custom role | curl + JWT + UI screenshot | Pass (functionally) — see Finding L-1 for a cosmetic issue found along the way |
| Team invite → approve → real-email trigger | h.timur+hqinvite@executionai.net, role `support` | UI (form fill) + curl (submit, due to shared-browser race — see Notes) | Done — see "Team invite record" below |
| Validation: missing fields / negative numbers / long strings | Packages, Schools, Lesson Types, Invitations | curl | Mixed — see Findings M-1, M-2 |
| Empty states / list filters | Team (`?sub_role=`), Schools (`?search=`) | curl | Pass (empty list handled cleanly); Schools "search" is client-side only, not a bug |
| `/hq/debug` | support | UI | 404 (see Notes — likely improved from prior round, not a regression) |
| `/hq/translations` (search, edit, AI-translate, Deploy) | owner | curl (API) + live-render probe | **FAIL — see Finding H-2 (architectural)** |
| Email templates (`test-send` validation) | owner | curl | Pass — clean 400 on missing fields |
| Currency/date formatting | Payments list | UI | Pass — `€1413.85`-style amounts, `Sep 05, 2026`-style dates, no `NaN`/raw ISO |
| "Export CSV" label (previously "Export C S V") | owner | UI | Pass — fixed, confirmed live |
| i18n raw-key regression (prior rounds' `Label X`/`Kpi X`/etc.) | — | Static analysis of the actually-deployed `frontend/messages/{en,it,es,fr,de}.json` | Pass — fixed in the files that ship; see Finding H-2 for why the DB-backed admin view still shows the old broken values |

## Team invite record (task-required, real email)

- **Invitee email:** `h.timur+hqinvite@executionai.net`
- **Name entered:** `QA HQ Invite Test`
- **Role invited as:** `support` (built-in role)
- **Invited (PendingInvitation created) at:** `2026-09-06T23:26:38Z`, by `qa.hq.owner@qa-nounder40.test`
- **Approved (real User + HQMember created, email queued) at:** `2026-09-06T23:27:20Z`
- **Resulting HQMember id:** `97bb4347-cd71-4810-a60f-dc35959c481d`, `sub_role: support`, `active: true` — currently live in the HQ Team roster (I left this one in place since it is the real, intentional test artifact the coordinator needs to verify delivery of; it was **not** cleaned up, unlike the throwaway test accounts below)
- **Expected email subject (locale: English, hardcoded — see note):** `✉️ You've been invited to the Danza Classica No Under 40 team`
- **Expected body:** greets "Hi QA 🌸" (first name), one CTA button "Complete my account" linking to the setup URL, plus a note that the link is personal and expires shortly. Exact source: `backend/notifications/brand_templates.py`, `_t("team_invite", en=...)`.
- **Expected link format:** `https://dev.danzaclassicanounder40.com/setup-account?uid=<base64-encoded user id>&token=<django default_token_generator token>` (built in `backend/accounts/hq_views.py::PendingInvitationViewSet._send_invite_email`, `settings.FRONTEND_URL` = `NEXT_PUBLIC_APP_URL`).
- **Note on locale:** the HQ invite flow (`hq_views.py::_send_invite_email`) calls `send_transactional_email_task.delay(...)` **without** a `locale` kwarg, so it always defaults to `"en"` regardless of who sent the invite or any HQ-level language setting — there is no such setting for HQ (only `School.language` exists). This is different from the School-side team-invite flow, which does thread a locale through (see `backend/teachers/views.py:309` and `backend/teachers/tests/test_school_invite.py:54`). Not necessarily a bug (there's no natural "HQ's configured language" to use), but worth a conscious decision — logged as **Finding L-2**.
- I did **not** attempt to complete the `/setup-account` flow myself (no direct signup link was returned outside the email; per instructions I only trigger + document, the coordinator verifies delivery).

## Findings, by severity

### 🔴 Critical

#### C-1 — Any HQ role holding only the `team` permission can mint a brand-new `owner` account via the invite→approve flow, completely bypassing the `only_owner_assigns_owner` guard

**Where:** `backend/accounts/hq_views.py`, `PendingInvitationViewSet.create()` and `.approve()` (lines ~160–216). Contrast with `HQMemberViewSet.partial_update()` (lines 53–68), which correctly blocks a non-owner-equivalent caller from setting `sub_role: "owner"` directly.

**Root cause:** `PendingInvitationViewSet` has **no `initial()` guard at all** on `role_detail`, and `approve()` does:
```python
member, _ = HQMember.objects.update_or_create(
    user=user,
    defaults=dict(email=invite.email, name=invite.name, sub_role=invite.role_detail or "support", active=True),
)
```
with zero check that the caller is owner/super_admin when `invite.role_detail == "owner"`. The `HQ_SECTION_BY_SEGMENT` middleware maps the `invitations` segment to the `team` permission (so a caller needs `team` to reach it at all) — but `team` is a permission that, by design, is meant to let someone manage the team roster, **not** to be owner-equivalent. The direct-edit path (`HQMemberViewSet.partial_update`) correctly separates "has `team` permission" from "is owner/super_admin" via `_HQ_OWNER_EQUIVALENT`; the invite/approve path does not apply that same separation.

**Why this is live-exploitable, not theoretical:** none of the 7 *built-in* roles other than owner/super_admin carry `team` today, but `/hq/permissions` explicitly lets an owner create **custom roles with arbitrary permission subsets** (this is a working, intended feature — see the custom-role lifecycle test above). A perfectly plausible custom role like "Team Coordinator" (`permissions: ["dashboard", "team"]`) — created by an owner who reasonably wants someone to handle onboarding without being an owner — would silently be able to escalate itself (or an accomplice) to full Owner.

**Live repro (performed on dev, fully cleaned up afterward):**
1. As owner: `PATCH /api/hq/permissions/support/ {"permissions":["dashboard","inbox","team"]}` → `200` (temporarily grants only `team` to the built-in `support` role).
2. As `qa.hq.support` (still not owner/super_admin — confirmed by a direct self-promotion re-check: `PATCH /api/hq/team/<self>/ {"sub_role":"owner"}` → `403 {"error":"only_owner_assigns_owner"}`, i.e. the direct path is still safe):
   `POST /api/hq/invitations/ {"type":"hq_member","email":"qa.hq.escalation-test@qa-nounder40.test","name":"QA Escalation Test","role_detail":"owner"}` → **`201`**.
3. Still as `support`: `POST /api/hq/invitations/<id>/approve/` → **`201 {"...,"sub_role":"owner","active":true}"`** — a brand-new, fully active **Owner** HQMember now exists, created entirely by a `support`-level account.
4. Cleanup (as owner): `DELETE /api/hq/team/<new id>/` → `204`; reverted `support` permissions back to `["dashboard","inbox"]`; verified team roster and permission matrix both back to baseline.

**Impact:** full HQ privilege escalation — identical severity class to the four previously-fixed Critical findings, via a code path the earlier fix round did not touch.

**Suggested fix direction:** in `PendingInvitationViewSet`, add the same `_HQ_OWNER_EQUIVALENT` check used in `HQMemberViewSet`: reject `create()`/`approve()` when `role_detail in {"owner","super_admin"}` and the caller's `effective_hq_sub_role()` is not itself owner-equivalent.

### 🟠 High

#### H-1 — `GET /api/hq/team/` and `GET /api/hq/permissions/` are readable by every authenticated HQ role, regardless of the `team`/`permissions` permission keys — leaking real staff PII

**Where:** `backend/core/section_guard.py` — `HQ_SEGMENT_ENFORCED_ELSEWHERE = {"team", "permissions"}` deliberately excludes these two segments from the middleware's blanket enforcement, with a comment saying enforcement "already lives in `accounts/hq_views.py` (`HQMemberViewSet.initial()`/`HQRoleViewSet.initial()`, same round of fixes)". But both of those `initial()` overrides only gate `request.method in ("POST","PUT","PATCH","DELETE")` — **`GET` is never checked**, so the assumption behind the middleware's exemption is only half true.

**Live repro:**
```
GET /api/hq/team/        with qa.hq.support token (permissions: dashboard, inbox only)  → 200
GET /api/hq/permissions/ with qa.hq.support token                                        → 200
```
Same result for `tech_support`, `finance`, `analytics`, `operations` (verified all 5 non-owner-equivalent roles — only `owner`/`super_admin` are *supposed* to see this data per the documented permission matrix in `QA_TEST_RESULTS.md` §1.1).

The `team` response body includes, for every real HQ staff member (not just QA fixtures):
```json
{"email":"c.carlo@cfcholding.it","name":"C. Carlo","phone":"+39 333 1234567","sub_role":"super_admin",...}
{"email":"hakantimur55@gmail.com","name":"Hakan Timur","phone":"","sub_role":"super_admin",...}
```
i.e. the platform founders' real personal emails and one real phone number, plus the full permission matrix for every role (including custom ones), disclosed to the lowest-privilege HQ account (`support`).

This is also not just a theoretical curl-only exposure: the app's own Dashboard page calls `GET /api/hq/permissions/` on every load (confirmed via `read_network_requests` while logged in as `support`) to resolve the role display label — so the endpoint is exercised by ordinary use, not just a hidden route.

**Impact:** PII disclosure (names, personal emails, one phone number) + full internal permission-model disclosure to any HQ account, including the lowest-trust one (`support`/`tech_support`, roles explicitly scoped to `dashboard + inbox` only). Not by itself a privilege escalation, so High rather than Critical.

**Suggested fix:** extend the `initial()` guards in `HQMemberViewSet`/`HQRoleViewSet` to also require the `team`/`permissions` key on **GET**, not just on mutating methods (or remove the middleware's blanket segment exemption and let it enforce reads too, keeping the write-side hierarchy checks in the views as they are today).

#### H-2 — The entire `/hq/translations` page (manual edit, "AI Translate", "Deploy") is disconnected from the live site — it edits a database table that is never read at runtime

**Where:** `frontend/src/i18n/request.ts` loads UI copy exclusively from the git-committed, build-time-bundled `frontend/messages/{locale}.json` files. The `Translation` Django model / `/api/hq/translations/` (`backend/translations/views.py::HQTranslationsView`) is a **separate, independent data store** with no code path that ever merges it into what next-intl renders. `TranslationsView` (`GET /api/translations/?locale=`) is a public endpoint that *also* reads this same table and is explicitly commented as "consumed by the running app" — but no frontend file (`frontend/src/**`) calls it; it appears to be dead code left over from an earlier architecture.

**Live proof (performed on dev, reverted immediately):**
1. `GET /api/hq/translations/` shows `hq.dashboard.title` (en) = `"Title"` — matches the exact "raw key" bug class documented at length in the prior two QA rounds as fixed.
2. But the actually-deployed `frontend/messages/en.json` already has `hq.dashboard.title = "Dashboard"` (correctly fixed, verified by reading the file directly).
3. Logged in live as owner, the Dashboard heading renders **"Dashboard"** — correct.
4. `POST /api/hq/translations/ {"key":"hq.dashboard.title","locale":"en","value":"ZZZ_QA_DB_PROBE_ZZZ"}` → `200 {"ok":true}`.
5. Reloaded the live, authenticated Dashboard page — heading still renders **"Dashboard"**, completely unaffected by the DB write.
6. Reverted the DB value back to `"Title"` to leave the environment as found.

Additionally, both of the page's headline action buttons are non-functional on this environment:
- **"Deploy"/"Build"** → `POST /api/hq/deploy/` → `500 {"error":"Deploy hook not configured"}`. This hits `settings.VERCEL_DEPLOY_HOOK_URL`, a leftover from the pre-monorepo Vercel/Next.js-API-routes architecture that CLAUDE.md explicitly says is retired (`Docker Compose + EC2 + GitHub Actions` now). There is no equivalent hook wired up, so this button can never succeed in the current architecture.
- **"AI Translate" / auto-fill** → `POST /api/hq/translations/auto-fill/` → `500 {"error":"ANTHROPIC_API_KEY not configured"}`.

**Impact:** the page presents itself as a real, working, non-technical-staff-friendly translation management tool (search, per-locale editing, "missing only" filter, AI-assisted fill, and a "Deploy" button implying changes go live) — but in the current architecture, **nothing done on this page can ever reach a real user**. Anyone (HQ staff, or a future developer) who trusts this page to manage live copy will be silently wrong; the "AI Translate" feature, even fixed, would only ever write into the same disconnected table. This deserves attention before launch, either by (a) wiring the DB table into the actual render path (rebuild/redeploy on save — the harder, "real" fix), or (b) removing/disabling the page and its actions and pointing HQ staff at the git-committed JSON files instead, or (c) at minimum fixing/removing the two broken buttons and adding a banner clarifying that saved values require a manual code change to go live.

**Not a regression of the i18n content itself** — see the "Coverage table" row and the note under Executive Summary: the actual shipped `messages/*.json` files are in good shape; I re-ran the prior rounds' raw-key detector against all 5 locale files directly and found no material new raw-key regressions (a handful of legitimate short English/German words like "Status" and "Filter löschen" matched the loose regex as false positives; verified by inspection).

### 🟡 Medium

#### M-1 — No server-side validation on `Package.credits` / `Package.price` — negative values accepted and persisted

**Where:** `backend/catalog/models.py:139` (`credits = models.DecimalField(...)`, no `MinValueValidator`) and `:151` (`price = models.DecimalField(...)`, no `MinValueValidator`). `PackageSerializer` (`backend/catalog/serializers.py`) validates `allowed_lesson_types` but nothing about the numeric fields.

**Live repro:** `POST /api/hq/packages/ {"name_en":"QA Neg Test","credits":"-5","price":"-10.00","allowed_lesson_types":["<valid id>"]}` → **`201`**, package created with `credits: -5.0, price: -10.0`. Cleaned up (`DELETE`, `204`).

**Impact:** a package with negative price/credits makes no business sense per CLAUDE.md §4.2 ("Krediler Decimal, yarım kredi adımlı" — implicitly non-negative) and would very likely break Stripe checkout (Stripe rejects negative `unit_amount`) if a school ever created one, or corrupt a student's credit balance if credits went negative on purchase. Domain rule §4.2 doesn't explicitly forbid negative values in writing, but no reasonable product interpretation allows them.

#### M-2 — No server-side validation on `School.platform_fee_percentage` / `shop_commission_percentage` range

**Where:** `backend/schools/models.py:32-33` — both are plain `DecimalField(max_digits=5, decimal_places=2)`, no `MinValueValidator(0)`/`MaxValueValidator(100)`.

**Live repro:** `POST /api/hq/schools/ {"name":"QA Range Test School","platform_fee_percentage":150,"email":"qa.range.test@qa-nounder40.test"}` → **`201`**, school created with `platform_fee_percentage: 150.0` (i.e. HQ would take 150% of every transaction). Cleaned up (`DELETE`, which also reported clean cascading-delete counts — `{"cascading":{"students":0,...},"blocking":{...}}`).

**Impact:** a fee > 100% is nonsensical and would either break the Stripe `application_fee_amount` call (which cannot exceed the charge total) at the first real transaction, or (if Stripe validates it and 400s) silently prevent that school from ever completing a sale, with a confusing error surfaced far from the root cause (HQ's own school-edit form).

### 🟢 Low

#### L-1 — Custom-role dashboard badge shows the raw role key, not its human label

**Where:** HQ Dashboard "Welcome" badge. When `qa.hq.tech_support` was temporarily reassigned to a custom role created as `{"label":"QA Custom Test","permissions":[...]}` (auto-slugified key: `qa-custom-test`), the dashboard rendered `Welcome QA-CUSTOM-TEST` instead of `Welcome QA Custom Test`. Screenshot evidence captured live. Sidebar itself was correct (exactly `Dashboard / Library / Shop`, matching the 3 granted permissions — no bug there).

**Impact:** cosmetic only, but visible to every user of a custom role — worth a quick fix (render the role's `label` field, not its `key`) since custom roles are an intended, documented HQ feature.

#### L-2 — HQ team-invite email locale is hardcoded to English

Already described under "Team invite record" above. Not necessarily wrong (there is no "HQ language" concept to fall back to, unlike schools), but worth a conscious decision rather than an accidental omission — the School-side equivalent flow does thread a locale through.

#### L-3 (incidental, not HQ-specific) — Login page email placeholder is hardcoded Italian regardless of locale

`frontend/src/app/[locale]/(auth)/login/page.tsx:225,279` — `placeholder="nome@dominio.it"` is a literal string, shown even when navigating to `/en/login`. Noticed while setting up HQ role sessions; flagged for completeness since it affects every HQ user's first touchpoint, but it is a shared/global page, not HQ-specific, so out of this report's primary scope.

## Confirmed still-fixed (re-verified this round)

- All four Critical HQ team-escalation vectors from the prior round (self→owner via direct `PATCH`, self-permission-boost via direct `PATCH /hq/permissions/<own role>/`, delete-owner via direct `DELETE`, self-delete via direct `DELETE`) — all return `403`/`400` as expected, for `qa.hq.support`.
- Granular backend read authorization for all 13 non-team/permissions `/api/hq/*` segments, across all 7 built-in roles (91 combinations) — 100% match with the documented permission matrix, no over- or under-permissioning found.
- Granular backend write authorization (packages create, school edit/activate, reports) for roles lacking the relevant permission — all `403`.
- Route guards: direct URL navigation to `/hq/permissions`, `/hq/team`, `/hq/payments`, `/hq/shop` by roles lacking the permission all correctly redirect to `/hq/dashboard` (spot-checked `support`, `finance`, `operations`).
- Custom role lifecycle: create → assign to a live account → sidebar and API access exactly match the granted permission subset (`dashboard, library, shop` → only those 3 sidebar items, `200` on those 3 segments, `403` elsewhere) → unassign → delete. Full round-trip clean.
- "Export CSV" button text (previously rendered as "Export C S V") — confirmed fixed on the live Payments page.
- Currency and date formatting on the Payments page (`€1413.85`, `Sep 05, 2026`-style) — sane, no `NaN`/raw ISO/`undefined`.
- The systemic i18n "raw key" bug class from both prior rounds — confirmed fixed in the actually-deployed `frontend/messages/{en,it,es,fr,de}.json` (see Finding H-2 for why a *different*, disconnected system still shows the old broken values).
- `/hq/debug` — see Notes below; now returns 404 even in this "dev" deployment, which is a *stricter* result than the prior round found (previously reachable), not a regression.

## Notes — `/hq/debug` now 404s on dev (documentation update, not a bug)

The code (`frontend/src/app/[locale]/hq/debug/page.tsx`) is unchanged from the prior round: it still calls `notFound()` only `if (process.env.NODE_ENV === 'production')`. The prior QA report documented this page as reachable on dev and described that as expected/intentional dev-only behavior. This round found it returns a genuine Next.js 404 on the live dev deployment. The most likely explanation: the Next.js container is built with `next build` (which always produces a production bundle, setting `NODE_ENV=production` internally) regardless of which git branch/environment it's deployed to — "dev" here describes the *deployment target*, not the Next.js runtime mode. This is arguably a **safer** outcome than previously documented (no dev-only debug tool reachable on a real, internet-facing host), so it is not filed as a regression — but `CLAUDE.md` / `QA_TEST_RESULTS.md`'s existing note ("`/hq/debug` sadece NODE_ENV==='production' dışında çalışıyor... dev ortamında bilerek hâlâ açık") should be corrected to avoid future confusion, since it no longer matches observed behavior on this deployment.

## What I could NOT test, and why

- **Actual email delivery/content for the Team invite** — by design (per task instructions): I triggered the invite→approve flow and recorded the exact expected subject/body/link/timestamp, but did not and should not check the `h.timur+hqinvite@executionai.net` inbox myself. The coordinator should verify receipt and that the rendered email matches the "Team invite record" section above.
- **Completing `/setup-account` for the real invite** — no direct signup link was returned by the API (only the internal `PendingInvitation`/`HQMember` objects); the actual `uid`/`token` pair only exists inside the queued email. Per instructions, I did not attempt to guess or reconstruct it.
- **Actually toggling a real school's `active` state or Stripe-onboarding fields** — I verified the permission checks (403 for unauthorized roles) without performing the mutation even for authorized roles, to avoid any risk of touching real Stripe-connected schools' state (`Danza Classica Milano`, `Danza Clásica Barcelona`, `Hakan School`). All destructive/mutating verification was done exclusively against clearly QA-prefixed or newly-created-and-immediately-deleted test data.
- **Deep UI CRUD on Shop, Homepage/Brand Settings, Locations, Email Templates editor** — the prior round's delta report already exercised these thoroughly via UI (product CRUD, discount codes, "hidden from students" toggle, homepage/brand round-trip, email template locale tabs + variables). I re-verified the relevant backend authorization for these segments (all 91 role×segment combinations, including `shop`, `homepage-settings`, `email-templates`, `library`, `locations`-adjacent `school-permissions`) but did not re-click through every form given the significant new findings (C-1, H-1, H-2) that warranted deeper backend investigation instead. No regression signal was found in the areas I did check (list endpoints all `200` with sane payloads, no `500`s encountered anywhere in this pass).
- **Shared-browser interference** — as warned in the task brief, the browser instance is shared with up to 3 other concurrent QA agents testing other panels. I hit this directly and repeatedly: `localStorage` (and therefore the active JWT) was silently overwritten mid-flow at least twice (once mid-navigation to `/hq/permissions`, once mid-submit of the Team invite form, producing a misleading `403` that was **not** a real product bug — confirmed by decoding the JWT `user_id` in-browser each time and finding it belonged to another agent's teacher/student session). Every such incident was cross-verified via a fresh `curl` + JWT call before being ruled out; none of the findings in this report rely on a browser observation that wasn't independently reproduced via curl. Because of this, the actual Team-invite submission was completed via curl rather than a clean end-to-end UI click, after the UI attempt failed due to a cross-agent token swap (documented above); the UI form itself was verified to be correctly wired (fields, role dropdown, submit) before the swap occurred.
- **Exhaustive validation-fuzzing of every form field on every page** — given the scope (16 pages × up to a dozen fields each), I prioritized the fields most likely to have real business impact (financial fields, email format, string length, required fields) rather than fuzzing every field on every form. The two validation gaps found (M-1, M-2) suggest a broader pattern might exist on other numeric fields (e.g. `validity_days`, `weekly_booking_cap`, `sort_order`) that I did not individually fuzz — worth a follow-up pass focused specifically on numeric-field bounds across the whole `/api/hq/*` and `/api/school/*` surface.
