# School Panel — Full Regression QA Report

**Date:** 2026-09-06/07 · **Environment:** `https://dev.danzaclassicanounder40.com` (`develop` branch)
**Accounts used:** `qa.school.owner@qa-nounder40.test`, `qa.school.admin@qa-nounder40.test`, `qa.school.staff@qa-nounder40.test` (all `QaSuite!2026`), school = "QA Test School" (`33807f7b-5c55-43e5-ab5a-e84794d07601`), `School.language = "it"`, `School.country = "Italia"`.
**Method:** Direct `curl` + JWT for all backend/authorization testing (reliable, isolated from the shared-browser hazard); Claude Browser (with JWT injected directly into `localStorage` immediately before each UI action) for UI-only verification (forms, sidebar, i18n rendering, Stripe onboarding). Every "surprising" result was cross-checked with a fresh, isolated `curl` call before being recorded as a bug — several apparent failures turned out to be caused by other concurrent QA agents overwriting the shared `localStorage`/cookies on this origin (documented in "What I could not test" below).

This report focuses on the **School panel**. Findings already documented as fixed in `QA_TEST_RESULTS.md` §0 are re-verified here (marked ✅ CONFIRMED FIXED / ❌ REGRESSION) rather than re-discovered from scratch. Coverage goes deep on Teachers/Compensation/Documents/Reports/Locations/Settings/Packages, per the assignment brief, since the prior round flagged those as shallow.

---

## 1. Coverage table

| Page | owner | admin | staff |
|---|---|---|---|
| Dashboard | ✅ full | ✅ (sidebar identical to owner, confirmed) | ✅ visible, correct KPIs |
| Locations (+ Rooms) | ✅ full CRUD, cascade delete, validation | — (permission matrix identical to owner) | ✅ direct-URL blocked → redirect to dashboard; GET allowed (lookup-reader) |
| Calendar | not deep-tested this round (unchanged since last pass) | — | ✅ sidebar-visible |
| Courses (list/new/edit/detail, recurring) | ✅ full CRUD, half-credit bug reproduced, ghost-lesson fix verified | — | ✅ sidebar-visible, direct create/edit not attempted (would 403 by design) |
| Lessons | ✅ verified via course cascade tests | — | ✅ sidebar-visible |
| Teachers | ✅ invite (real email), edit, email-collision, roster GET | — | ✅ GET allowed (lookup-reader), POST/PATCH correctly 403 |
| Compensation (plans + payments) | ✅ plan CRUD, `simulate` math verified by hand | — | ✅ GET plans allowed (lookup-reader), payments GET correctly 403 |
| Students | ✅ roster, manual credit grant (half-credit + boundary crash) | — | ✅ sidebar-visible |
| Packages (+ Subscriptions tab merged in) | ✅ CRUD, half-credit, all-lesson-types regression found (New + Duplicate) | — | ✅ correctly 403 on all methods |
| Payments (transactions) | ✅ endpoint healthy | — | ✅ correctly 403 |
| Documents (+ document types) | ✅ CRUD; live booking-block toggle **not** re-tested live (see §6) | — | ✅ sidebar-visible |
| Inbox | not deep-tested this round (unchanged) | — | ✅ sidebar-visible |
| Reports (summary/detailed/packages/student-classes) | ✅ all 4 endpoints healthy, real data | — | ✅ correctly 403 |
| Settings (profile page) | ✅ field-level restriction confirmed; **new gap found** (identity fields unrestricted) | ✅ can write settings-tier fields, blocked on HQ-only fields | ✅ GET 200 (exposes Stripe/fee fields), settings-tier PATCH 403, **but identity fields PATCH 200 anyway** |
| Credits (manual grants) | ✅ half-credit works; 500 crash on huge amount | — | ✅ correctly 403 write, but GET grants list untested for staff |
| Team | ✅ invite/edit/remove hierarchy re-verified, dropdown UI fix confirmed | ✅ owner-escalation via POST blocked (403) | ✅ correctly 403 |
| Profile (School Profile form) | ✅ | (same endpoint as Settings) | ✅ page renders, writable fields as above |

Sidebar visibility (owner/admin: 17/17 sections + Profile; staff: 8/8 — `dashboard, calendar, courses, lessons, students, documents, inbox, manualCredits` — + Profile) was screenshot-verified for **owner** and **staff**; **admin**'s sidebar was screenshot-verified on the Team page and matches owner (consistent with `GET /api/school/permissions/` returning identical `permissions` arrays for `owner` and `admin`).

---

## 2. Findings, by severity

### 🔴 High

#### H1 — Course `credit_cost` half-credit value is still silently truncated to an integer end-to-end (regression not actually fixed)
`QA_TEST_RESULTS.md` §0 credits commit `7281fc5` with fixing this ("Course `credit_cost` yarım kredi (1.5) artık formda sessizce tam sayıya yuvarlanmıyor"). That commit **only fixed the frontend form** (`new/page.tsx`, `edit/page.tsx` now use `parseFloat` with `step="0.5"`). The **backend still truncates with `int()`**:
- `backend/catalog/course_views.py:355` (create wizard): `credit_cost=int(course_level("credit_cost", 1) or 1)`
- `backend/catalog/course_views.py:527` (edit): `course.credit_cost = int(data.get("credit_cost") or 1)`

**Live repro (both API and UI):**
1. `POST /api/school/courses-create/` with `"credit_cost": 1.5` → `200`, course created.
2. `GET /api/school/courses/{id}/` → `"credit_cost": 1.0` (silently rounded down).
3. Confirmed identically via the real UI: New Course wizard, entered `1.5` in "Credits per single lesson," submitted, course created — reopened Edit Course, field now shows `1`.
4. Also reproduced on the **edit** path: `PUT /api/school/courses/{id}/full/` with `"credit_cost": 2.5` → persisted value `2.0`.

`Course.credit_cost` itself is a correct `DecimalField(max_digits=5, decimal_places=1)` (`backend/catalog/models.py:60`) — this is purely a view-layer bug. Because the **frontend form no longer visibly rounds** the value as the user types (that part is fixed), this is actually **more dangerous** than the originally-reported bug: a school owner enters `1.5`, sees `1.5` in the form, submits, and gets no error — but the persisted value is `1`. They will not notice until students are charged the wrong number of credits per lesson. `Package.credits` (a different model/view) correctly supports `12.5`, `2.5`, etc. — confirmed via UI (package form) and API.

**Fix location:** `backend/catalog/course_views.py:355` and `:527` — change `int(...)` to `Decimal(...)` / let DRF's serializer handle it, matching what `Package`'s serializer already does correctly.

#### H2 — Package "all lesson types" is now **unfixable to create or duplicate**, not just uneditable (regression narrower than reported, but still broken)
`QA_TEST_RESULTS.md` §0 credits commit `7281fc5` with fixing this via a `was_already_empty` check in `catalog/serializers.py::PackageSerializer.validate()`:
```python
def validate(self, attrs):
    if self.instance is None or "allowed_lesson_types" in attrs:
        was_already_empty = self.instance is not None and not self.instance.allowed_lesson_types
        if not attrs.get("allowed_lesson_types") and not was_already_empty:
            raise serializers.ValidationError({"allowed_lesson_types": "Pick at least one lesson type."})
```
This correctly fixes **editing an existing "all types" package in place** (`self.instance is not None`, `was_already_empty=True`) — confirmed via `PATCH /api/school/packages/{id}/ {"allowed_lesson_types":[]}` on the pre-existing "QA Credit Pack" → `200 OK`.

**But `self.instance is None` on every CREATE**, so `was_already_empty` is always `False` for a brand-new package or a **Duplicate** (which the frontend implements as a `POST`, i.e., a create, with `editing` reset to `null` — `PackagesManager.tsx:324-332`). Result: **it is now impossible to create a new "all lesson types" package, or to Duplicate any existing one, via the UI or the API** — every attempt fails with `400 {"allowed_lesson_types":["Pick at least one lesson type."]}`.

**Live repro (UI, screenshots taken):**
1. Owner → Packages → New Package → filled in name/credits(`12.5`)/price, checked "All lesson types" → **Create Package fails**, form shows in-place error "Pick at least one lesson type."
2. Owner → Packages → existing "QA Credit Pack" (which has `allowed_lesson_types: []`) → **Duplicate** → form pre-fills "All lesson types" checked (inherited) → **Create Package fails** with generic "Something went wrong" (note: the *New* path shows the specific validation message inline; the *Duplicate* path swallows it into a generic error — a secondary UX inconsistency).
3. Confirmed via raw API: `POST /api/school/packages/` with `allowed_lesson_types: []`, or the field omitted entirely → `400` every time.

Net effect: a school can never again create a package meant to work for every lesson type — the only surviving "all types" packages are ones that predate this validation and are never duplicated, only edited in place.

**Fix location:** `backend/catalog/serializers.py::PackageSerializer.validate()` — the "at least one lesson type" rule needs an explicit "all types" signal (e.g., a real `lesson_type_restriction: "all"` flag, which the model already has and the frontend already sets — `"lesson_type_restriction":"all"` shows in the API response) instead of using "empty array" as the trigger, so creating with that flag set doesn't require `allowed_lesson_types` at all.

#### H3 — Any authenticated school member (including `staff`, who holds **no** `settings` permission) can rewrite the school's identity fields via `PATCH /api/school/profile/`
The Critical bug from the prior round (`staff` could write `platform_fee_percentage`/`stripe_account_id`/`active`/`cancellation_policy_hours` etc.) **is fixed** — confirmed live:
- `staff` → `PATCH {"cancellation_policy_hours":999}` → `403 {"error":"forbidden","fields":[...]}`
- `staff` → `PATCH {"platform_fee_percentage":0}` → `403`
- `staff` → `PATCH {"stripe_account_id":"acct_HACKED"}` → `403`
- `staff` → `PATCH {"active":false}` → `403`
- `admin` (has `settings`) → `PATCH {"cancellation_policy_hours":48}` → `200` (correct); `admin` → `PATCH {"platform_fee_percentage":0}` → `403` (correctly HQ-only, blocked even for admin/owner)

This is implemented in `backend/schools/views.py::SchoolProfileView.patch()` via two field sets:
```python
_SCHOOL_SETTINGS_FIELDS = {"cancellation_policy_hours","min_booking_notice_hours","free_first_lesson",
    "show_teacher_to_students","block_booking_on_documents","language"}
_SCHOOL_HQ_ONLY_FIELDS = {"id","slug","active","owner","platform_fee_percentage","shop_commission_percentage",
    "stripe_account_id","stripe_onboarding_complete","grace_period_days","free_trial_ends_at","ical_token",
    "created_at","updated_at"}
```
**But any field not in either set — `name`, `email`, `phone`, `address`, `address_line2`, `city`, `province`, `country`, `vat_number`, `website`, `logo_url` — passes through completely unchecked, for any school member with a membership row, regardless of `sub_role` or permissions.**

**Live repro (isolated `curl`, no browser session risk):**
```
staff → PATCH /api/school/profile/ {"website":"https://qa-staff-edit-test.example.test"} → 200, persisted
staff → PATCH /api/school/profile/ {"name":"QA Test School STAFF EDITED"}                 → 200, persisted
staff → PATCH /api/school/profile/ {"email":"qa.staff.hijack@qa-nounder40.test"}          → 200, persisted
```
All three changes were reverted immediately via the owner account after confirming the behavior. This is also independently reachable from the "School Profile" page in the UI, which every role (including `staff`) can open directly — the page is not gated by `SchoolSectionGuardMiddleware` at all (the `profile` URL segment is deliberately absent from `SECTION_BY_SEGMENT` — comment in `backend/core/section_guard.py`: "memberships / profile / permissions: infrastruttura, sempre consentiti").

**Why this matters:** `email` is the school's contact address used for platform/Stripe/customer communications; `name`/`address`/`vat_number` feed invoicing and legal correspondence. A `staff` account — the lowest tier, meant only for day-to-day operations (calendar/courses/students/documents) — can silently redirect the school's contact email or rename the business, with zero permission check and zero audit trail visible to the owner.

**Fix location:** `SchoolProfileView.patch()` — either add a third field set (`_SCHOOL_IDENTITY_FIELDS`) gated behind the same `settings` permission check as `_SCHOOL_SETTINGS_FIELDS`, or gate the entire endpoint behind "has any membership" **and** a minimum permission for anything beyond read-your-own-membership.

**Related, lower-severity note:** `GET /api/school/profile/` itself returns `stripe_account_id` and `platform_fee_percentage` to **every** authenticated member including `staff` (confirmed: `staff` GET → `200` with both fields populated) — a read-only information-exposure gap alongside the write gap above. See L1.

### 🟠 Medium

#### M1 — Manual credit grant crashes with an unhandled `500` on large amounts (no bounds validation)
`POST /api/school/credits/grant/` validates `amount > 0` but not that it fits the underlying field.
`StudentPackage.credits_total`/`credits_remaining` are `DecimalField(max_digits=6, decimal_places=1)` (`backend/students/models.py:62-63`) — max representable value `99999.9`.

**Live repro:**
```
POST /api/school/credits/grant/ {"student_id": "...", "amount": "99999999"} → 500 Server Error (unhandled)
POST /api/school/credits/grant/ {"student_id": "...", "amount": "99999"}    → 201 (exact boundary, works)
```
No `StudentPackage` row was created on the 500 (the DB transaction rolled back cleanly — no data corruption), but this is a real, easily-triggered crash on one of the platform's core financial endpoints (a typo — an extra digit — while granting credits manually is enough to 500 the request instead of getting a clean validation error). **Fix:** validate `amount` against the field's max (or catch `InvalidOperation`/`DataError` and return `400`) in `backend/students/school_views.py` (the credits-grant `post()`, ~line 277).

#### M2 — Packages accept negative/zero credits and negative price with no server-side validation
```
POST /api/school/packages/ {"credits": -5, ...}    → 201, created with credits: -5.0
POST /api/school/packages/ {"price": -10, ...}     → 201, created with price: -10.0
POST /api/school/packages/ {"credits": 0, ...}     → 201, created with credits: 0.0
```
A package that "sells" `-5` credits for `€10` is nonsensical and, if ever purchased, would *subtract* credits from a student's wallet instead of adding them — a direct violation of CLAUDE.md §4.2 ("Krediler `Decimal`... asla `float`/`int` değil" implies careful handling of the credit ledger, which a negative-credit package would corrupt). All three test packages were deleted immediately after confirming. **Fix:** add `MinValueValidator` (credits ≥ 0.5, price ≥ 0) to `Package.credits`/`Package.price` or to `PackageSerializer.validate()`.

#### M3 — Discount codes accept negative and >100% percentage values with no range validation
```
POST /api/school/discount-codes/ {"type":"percentage","value": -50, ...}  → 201
POST /api/school/discount-codes/ {"type":"percentage","value": 999, ...} → 201
```
Uniqueness on `(school, code)` **is** correctly enforced (`400 non_field_errors` on a duplicate code — verified). But nothing stops a `type: "percentage"` discount from being saved with a value outside `[0, 100]`, which — if ever redeemed at checkout — would compute a negative or wildly-wrong final price. All test codes deleted after confirming. **Fix:** add range validation for `type=percentage` in the discount-code serializer.

#### M4 — School Team invite emails are **always** sent in English, regardless of `School.language` or the inviting admin's UI locale — unlike Teacher invites, which correctly localize
Two invite code paths exist and behave inconsistently:
- **Teacher invite** (`backend/teachers/views.py::_send_teacher_invite_email`) — locale = the new user's `language_preference`, which is set from `request.data.get("locale")` (the inviting admin's *current UI locale*, sent explicitly by the frontend form) at creation time, falling back to the admin's saved preference. This **is** covered by an existing test (`backend/teachers/tests/test_school_invite.py`) and works correctly — confirmed live: invited `h.timur+teacherinvite@executionai.net` with `locale: "it"` (matching `School.language`), got `201 {"email_sent": true}`.
- **School Team invite** (`backend/schools/views.py::_send_school_team_invite_email`) — **does not accept or pass a `locale` at all**:
  ```python
  transaction.on_commit(lambda: send_transactional_email_task.delay(
      to_email=user.email, to_name=user.full_name, key="team_invite",
      context={...},
  ))  # no locale= kwarg
  ```
  `notifications/tasks.py` defaults `locale="en"` when none is passed. The `setup_url` is also built **without** a locale prefix (`f"{settings.FRONTEND_URL}/setup-account?..."` vs. the teacher path's `f".../{locale}/setup-account?..."`) — so even the link the invitee clicks isn't guaranteed to land in a matching-locale page.

**Live repro:** invited `h.timur+schoolinvite@executionai.net` as `staff` (`POST /api/school/team/`) from an `it`-language school — no `locale` parameter is even accepted by this endpoint, so the email will be English regardless of what the school owner is doing in the UI. Recorded for the coordinator's Gmail check (see §5).

**Fix:** thread the same `locale`/UI-locale pattern from the teacher-invite path into `SchoolTeamView.post()`.

#### M5 — `NEXT_LOCALE`/`user_locale` cookie silently overrides an explicitly-specified locale in the URL
`frontend/src/middleware.ts:78-87`:
```js
const preferred = getPreferredLocale(request)   // cookie 'user_locale', else Accept-Language
if (urlLocale && preferred && urlLocale !== preferred) {
  const newPath = pathname.replace(`/${urlLocale}`, `/${preferred}`)
  ...
  return NextResponse.redirect(url)
}
```
Once a `user_locale`/`NEXT_LOCALE` cookie is set (e.g., by using the in-app language switcher once), **every subsequent direct navigation to a URL with a different, explicit locale segment gets silently redirected back to the cookie's locale** — the URL's own locale is never honored again for that browser, even for a fresh, deliberately-typed link.

**Live repro:** with `user_locale=es`/`NEXT_LOCALE=es` cookies present (set by a different account/session earlier in this browser), navigating to `https://dev.danzaclassicanounder40.com/it/school/dashboard` redirected to `.../es/school/dashboard` and rendered fully in Spanish — confirmed by reading `location.href` after navigation (not just visually). Clearing the two cookies and repeating the exact same navigation correctly stayed on `/it/school/dashboard`, rendered in Italian, no raw i18n keys observed.

**Impact:** any shared/bookmarked link with an explicit locale (support docs, an email in a specific language, a QA tester switching locales to check translations) silently redirects to whatever locale the browser last had selected — the user cannot get back to a different language via URL alone; they must find and use the in-app switcher again. This also directly caused several false leads during this test pass (my own tab had `es` cookies left over from a different concurrent QA agent's session on the same shared origin) — worth being aware of for future multi-agent test rounds too.
**Fix location:** `frontend/src/middleware.ts:81-87` — an explicit locale segment in the URL should take priority over the stored preference (only apply `getPreferredLocale()` when the URL has **no** locale segment at all, e.g., bare `/`).

### 🟢 Low

#### L1 — `GET /api/school/profile/` exposes `stripe_account_id` and `platform_fee_percentage` to every school member, including `staff` with no `settings` permission
Confirmed: `staff` → `GET /api/school/profile/` → `200`, response includes `"stripe_account_id":"acct_...","platform_fee_percentage":10.0` alongside ordinary fields. Read-only (write is correctly blocked, see H3), but these are meant to be HQ/owner-level information. Low severity since it requires an existing account with school access, but worth tightening alongside the H3 fix.

#### L2 — Package "Duplicate" swallows the specific validation error into a generic "Something went wrong"
See H2 repro step 2 — the exact same backend `400 {"allowed_lesson_types": [...]}` shows a helpful inline message on **New Package**, but a generic, unhelpful "Something went wrong" on **Duplicate**. Frontend error-handling inconsistency in `PackagesManager.tsx`'s two save paths.

#### L3 — Room `capacity` accepts negative numbers with no validation
`POST /api/school/rooms/ {"capacity": -5, ...}` → `201`, persisted as `-5`. Unlikely to be hit by a real user (no UI path found that would type a negative number into a capacity spinner without deliberately trying), but there is no server-side guard either. Test room deleted after confirming (cascade-deleted correctly when its parent location was removed — see "confirmed working" section below).

---

## 3. Re-verified from the prior round — confirmed still fixed

All of the following were re-tested live this round and hold:

| Prior finding | Re-verification |
|---|---|
| **Critical** — `staff` could `PATCH /api/school/profile/` and change *any* field (`platform_fee_percentage`, `stripe_account_id`, `active`, `cancellation_policy_hours`, ...) | ✅ Fixed for the settings/HQ-only field sets (see H3 above for the *remaining* gap on identity fields, which is new) |
| **High** — `admin` could `POST /api/school/team/` inviting a new member directly as `school_sub_role: "owner"`, bypassing the owner-only guard that existed on `PATCH` | ✅ Fixed: `POST` now returns `403 {"error":"only_owner_assigns_owner"}` identically to `PATCH`. Also independently confirmed the Invite form's Role dropdown no longer lists "Owner" at all for an `admin` caller (previously it did, per the prior report) — screenshot-verified: dropdown shows only `Admin`/`Staff`. |
| **High** — Course delete leaves "ghost lessons" (`Lesson.course = NULL`) behind forever | ✅ Fixed via `cascade_delete_course()` (`backend/catalog/services.py`): created a course, deleted it, confirmed via `GET /api/school/lessons/` that **zero** lessons anywhere had `"course": null` afterward — the lesson was hard-deleted (it had no bookings and was in the future). Documented policy: past lessons → left with `course=NULL` untouched (harmless), future+unbooked → hard-deleted, future+booked → booking refunded/cancelled and lesson marked `CANCELLED` (not deleted, preserves refund audit trail). |
| **High** — Closure Days (`SchoolClosure`) were recorded but never enforced anywhere | ✅ Fixed, enforced in **both** places: (1) course/lesson generation skips closed dates (`catalog/services.py::date_in_school_closure`, called from `course_views.py` for both single and recurring schedules) — live repro: tried to create a single-schedule course *on* an already-closed date → `400 "No classes could be generated..."`; (2) booking creation blocks a pre-existing lesson that later falls on a newly-added closure day (`bookings/services.py:375-382`) — live repro: created a lesson on an open date, then closed that date, then attempted `POST /api/bookings/` as a student → `400 {"error":"school_closed"}`. One residual observation (not a regression, just worth noting): a lesson that already existed before its date was retroactively closed stays visible as `"status":"scheduled"` on the calendar — it isn't auto-cancelled, only new bookings on it are blocked. |
| **Medium/Low** — `PATCH /api/school/teachers/{id}/` returned `500` on an email collision instead of a clean `400` | ✅ Fixed: `{"error":"email_taken"}`, `400`, confirmed live against a real collision (tried to set a teacher's email to the owner's own email). |
| i18n — raw key-name labels (`Label X`, `Col X`, `Title`, etc.) across School pages | ✅ Not reproduced this round on any page visited (Packages, Courses new/edit, Settings, Team, Dashboard, in both `en` and `it`) — consistent with `QA_TEST_RESULTS.md`'s note that PRs #49/#50/#56 already cleared this systemically. |

---

## 4. Domain/permission checks re-verified clean

- **`SchoolSectionGuardMiddleware`** (`backend/core/section_guard.py`) correctly maps every `/api/school/<segment>/` to a permission key and returns `403 {"error":"section_forbidden","section":...}` on mismatch — spot-checked `staff` against `team`, `reports`, `payments` (all correctly `403`), and confirmed the "lookup-reader" exception (`teachers`, `compensation-plans`, `locations`, `closures` GET-only) still applies only to GET — `staff` `POST /api/school/teachers/`, `POST /api/school/locations/`, `POST /api/school/compensation-plans/` all correctly `403`.
- **`GET /api/school/permissions/`** is read-only for the School side — no `PATCH`/`POST` endpoint exists to alter a `SchoolRole`'s permission array (`404` on the only path shape I could construct), so the HQ-side "any role can escalate its own permissions" Critical bug **has no School-side equivalent** — School's permission matrix is HQ-defined and genuinely read-only from the School panel, exactly as CLAUDE.md describes.
- **Team hierarchy** (`SchoolTeamView`): code review confirms `DELETE` requires caller to be `owner`/`admin`, blocks a non-owner from removing an `owner`, and blocks self-removal (`cannot_remove_self`) — all scoped to `request.user.active_school_id`, so cross-school membership tampering isn't reachable through this endpoint. I did **not** re-run the actual delete-hierarchy scenarios live this round (see §6 — too risky on the shared QA owner account with 3 other agents mid-test), relying instead on this code review plus the prior round's dedicated automated test suite (`backend/schools/tests/test_team_delete_permissions.py`, 6 scenarios, cited as passing in the prior report).
- **Compensation math** — created a plan (`base_fee=20, bonus_threshold=5, bonus_per_student=3, bonus_max_threshold=10`) and called `.../simulate/` at `students=3,5,8,10,15`; results (`20, 20, 29, 35, 50`) match hand-calculated `base_fee + min(students-threshold, max_threshold) * bonus_per_student` exactly at every point, including the boundary (`=threshold` → no bonus) and the cap (`students=15` capped at `max_threshold=10` extra-students, not applied to the raw student count).
- **Half-credit manual grant** — granted `2.5` credits to a QA student via `/api/school/credits/grant/`; persisted and displayed correctly as `2.5`, alongside the student's other package showing `8.0` (fractional balances coexist correctly).
- **Location → Room cascade** — created a location with one room, deleted the location, confirmed via `GET` that **both** the location and its room return `404` afterward (real cascade, not a `SET_NULL` orphan like the old Lesson/Course bug).
- **Document-required-before-booking toggle** (`School.block_booking_on_documents`) — confirmed the enforcement code path is unchanged and still present (`backend/bookings/services.py:392`), and it was already deeply, live-verified in both directions by the prior round's deep-dive. I deliberately did **not** flip this school-wide setting live this round (see §6) since other QA agents were actively driving student bookings against this same school concurrently, and toggling it on/off mid-test would have produced false 403s for their in-flight work.

---

## 5. Real invite / Stripe onboarding — timestamps and expectations for the coordinator

**Teacher invite** — `POST /api/school/teachers/` as owner:
- Email: `h.timur+teacherinvite@executionai.net`
- Timestamp: `2026-09-06T23:38:21Z`
- `locale` explicitly passed as `"it"` (to match `School.language = "it"`) → response `{"email_sent": true, "existing_account": false}`
- Expected: transactional email, template key `team_invite`, **Italian** content, link shaped `{FRONTEND_URL}/it/setup-account?uid=...&token=...`

**School Team invite** — `POST /api/school/team/` as owner:
- Email: `h.timur+schoolinvite@executionai.net`, `school_sub_role: "staff"`
- Timestamp: `2026-09-06T23:38:45Z`
- Response: `{"id": "15", "existing": false}` — **no direct accept-link is returned in the API response** (email-only delivery), so the accept/`setup-account` flow could not be walked through end-to-end from this session.
- Expected: transactional email, template key `team_invite`, **English** content regardless of school language (see M4), link shaped `{FRONTEND_URL}/setup-account?uid=...&token=...` (**no locale prefix** — will hit whatever the middleware's `getPreferredLocale()` resolves to for a browser with no `user_locale` cookie, i.e., `Accept-Language` or the `en` default).

**Stripe Connect onboarding** — completed successfully end-to-end:
- `POST /api/stripe/onboard/` as owner → real `https://connect.stripe.com/setup/e/acct_1UCpDD3KWyx5LA5u/...` URL, confirming Stripe is live/functional on this dev deployment.
- Walked the full hosted flow: phone verification (test shortcut), business type (Individual), personal details (`Test Owner`, DOB `1990-01-01`, address `Via Test 1, 00100 Roma`), Italian-citizen + auto-generated test Codice Fiscale, business sector (`Eğlence ve dinlenme kampları` / Entertainment & recreation camps — closest match, no dance/education-specific sector exists in Stripe's IT taxonomy), website `dev.danzaclassicanounder40.com`, bank details (Stripe's pre-filled `STRIPE TEST BANK` test IBAN).
- **Identity verification required an extra loop**: submitting without it left the account listed with an "Eksik" (Incomplete) badge and `stripe_onboarding_complete: false`; going back in, Stripe first asked to confirm the (deliberately fake) personal details didn't match any public record ("Bu doğru" / "this is correct" → proceed anyway), then required a "Selfie + photo ID" simulated capture. The capture step exposes a **"Simüle Et" (Simulate)** control specifically for test-mode accounts, which opens a "Test verification result" dialog defaulting to "Başarılı doğrulama" (Successful verification) — submitting that completed the identity check.
- **Final state, confirmed via `GET /api/stripe/onboard/status/`:** `{"connected": true, "onboarding_complete": true, "account_id": "acct_1UCpDD3KWyx5LA5u"}`, and `GET /api/school/profile/` → `"stripe_onboarding_complete": true`.
- **This unblocks the Student agent's real end-to-end package-purchase/checkout testing as of 2026-09-06T23:59:59Z.** No further Stripe blockers were found for this school.

---

## 6. What I could NOT test, and why

- **Team DELETE hierarchy live re-test** (admin removing owner, self-removal attempts) — the QA owner/admin accounts are shared, live fixtures used by 3 other concurrent QA agents this round; a mistaken or slow-to-revert delete of the owner membership would have broken every other agent's session on this school. Relied on code review (confirmed guards present and correctly scoped) plus the prior round's dedicated automated test suite instead of a live repro.
- **Cross-school data isolation** — no second School-role QA account/school was available to this agent (only one seeded "QA Test School"); did not attempt to touch the real "Danza Clásica Barcelona" production-adjacent school noted in the prior round as accidentally linked to `qa.student`. Not tested this round.
- **Documents-required-before-booking live toggle** — did not flip `School.block_booking_on_documents` on/off live, to avoid producing false 403s for other agents' in-flight student booking tests on the same shared school. Verified the enforcement code path is unchanged instead (§4); this exact scenario was already deeply, live-verified bidirectionally by the prior round.
- **Full end-to-end "accept invite → set password → log in" walk-through** for either the teacher or school-team invite — neither API response included a direct accept-link (both are email-only delivery), and this session has no access to the `h.timur+...@executionai.net` inbox. Recorded exact timestamps/expected subject-template/locale above for the coordinator to verify via Gmail.
- **Subscriptions ("↻ Subscription" badge) creation** — not independently re-created this round; relied on the prior round's live confirmation (badge rendered correctly, single-motor design per `PACKAGE_TO_SUBSCRIPTION.md` respected) since no code in that path showed signs of having changed.
- **Reports CSV export button** — verified all four report API endpoints return healthy, real data (`reports/`, `reports/detailed/`, `reports/packages/`, `reports/student-classes/`), but did not click the actual "Export CSV" button in the browser this round (client-side generation from already-fetched data, per the prior round's finding that it works correctly).
- **Calendar and Inbox deep functional testing** — not re-driven this round beyond confirming sidebar visibility per role; no code changes were evident in these areas and the prior round already covered them reasonably (calendar teacher-filter + lesson popup + "+Add class"; inbox two-way real messaging).
- **Shared-browser session hazard** — this session hit the documented hazard repeatedly: mid-flow, `localStorage`/cookies on `dev.danzaclassicanounder40.com` were overwritten by other concurrent QA agents' logins (observed switching to Student, Teacher, and other sessions unpredictably), and a stray `user_locale=es`/`NEXT_LOCALE=es` cookie pair from another agent's session caused a real, reproducible false lead before being isolated as a genuine middleware bug (M5) rather than a session artifact. Mitigated by re-injecting a freshly-fetched JWT into `localStorage` via `javascript_tool` immediately before every UI action sequence, and by cross-verifying every unexpected result (`not_a_school_member`, unexpected redirects, etc.) with an isolated `curl` call before recording it.

---

## 7. Test-data cleanup

All QA-created data was removed or reverted after use; final state confirmed via `curl`:
- Courses/lessons created for the half-credit and closure-day tests: deleted (`GET /api/school/lessons/` confirms zero `course: null` orphans and zero stray lessons on the test dates).
- Closure days created: deleted (`GET /api/school/closures/` → `[]`).
- Location + room created: deleted (both confirmed `404` afterward).
- Compensation plan created for the math test: deleted (`GET /api/school/compensation-plans/` shows only the pre-existing `QA Base Plan`).
- Invalid packages (negative/zero credits, negative price) and discount codes (negative/>100% value): all deleted.
- Document type created for the toggle spot-check: deleted.
- School profile fields (`name`, `email`, `website`) temporarily changed by the `staff` write-access test (H3): reverted to `"QA Test School"` / `"qa.school@qa-nounder40.test"` / `""` immediately after confirming.
- **Left in place, intentionally:** the `2.5`-credit grant to "QA StudentB" (real functional test data, harmless); the real Teacher invite (`h.timur+teacherinvite@executionai.net`) and School Team invite (`h.timur+schoolinvite@executionai.net`), both pending — needed for the coordinator's Gmail delivery check; the completed Stripe Connect onboarding (intentional, unblocks the Student agent).
- **Left in place, not cleaned up (minor, flagged for awareness):** a `99999`-credit `StudentPackage` on "QA StudentB", created while finding the exact boundary of the M1 crash (no dedicated API endpoint exists to delete an individual student package grant from the School panel — would require Django Admin, out of scope for this pass). Low impact: it's on a QA fixture account already carrying multiple test packages from other agents' concurrent work.
