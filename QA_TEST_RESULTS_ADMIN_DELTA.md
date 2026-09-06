# Django Admin QA — Delta Report

Scope: `http://localhost:8080/admin/` only, local Docker environment
(`C:\Users\hakan\dev\nounder40`, `docker compose ps` confirmed all 7
containers up). Login: `hq@test.local` / `QaSuite!2026` (real superuser).
Followed the QA fixtures in place (`QA Test School`, `Load School A/B`,
`qa.*@qa-nounder40.test` users) and left them untouched. Every throwaway
record created during this pass was deleted by the end of the run and
verified via a follow-up admin list view or a direct DB count
(`User: 14`, `HQMember: 8`, `HQRole: 7`, `School: 3`, `SchoolClosure: 0` —
all match the pre-test baseline).

All 12 `admin.py` files were read first to build the model inventory
(`accounts`, `schools`, `library`, `translations`, `geography`,
`notifications`, `chat`, `commerce`, `teachers`, `bookings`, `catalog`,
`students`). No `ModelAdmin` in the codebase declares `inlines` or a custom
`actions` list beyond Django's default `delete_selected` — confirmed with
`grep -rn "inlines\|actions\s*=" backend/**/admin.py` (no matches), so those
two checklist items are N/A across the board, not skipped.

---

## New Bugs Found

### 🔴 Critical — Django admin login (and any session-authenticated POST) is completely broken through nginx on a non-default port, due to a CSRF Origin check failure

**Repro:**
1. `docker compose ps` — all containers healthy, nginx on `0.0.0.0:8080->80`.
2. Open `http://localhost:8080/admin/login/`, enter valid superuser
   credentials, submit.
3. Django returns **403 Forbidden**: *"CSRF verification failed... Origin
   checking failed - http://localhost:8080 does not match any trusted
   origins."*
4. Reproduced identically with a raw `curl` POST (session cookie + matching
   `Origin`/`Referer` headers, valid CSRF token) — not a browser-automation
   artifact:
   ```
   curl -s -i -b cj -c cj -H "Origin: http://localhost:8080" \
     -H "Referer: http://localhost:8080/admin/login/" \
     --data-urlencode csrfmiddlewaretoken=... --data-urlencode username=... \
     --data-urlencode password=... http://localhost:8080/admin/login/
   → HTTP/1.1 403 Forbidden
   ```

**Root cause (confirmed):** `nginx/nginx.conf` line 34:
```nginx
proxy_set_header Host $host;
```
nginx's `$host` variable **excludes the port**. So when a client hits
`http://localhost:8080/...`, nginx forwards `Host: localhost` (no `:8080`)
to Django. Django's `CsrfViewMiddleware._origin_verified()` builds
`good_origin` from `request.get_host()` (i.e. `http://localhost`, no port)
and compares it against the browser's real `Origin: http://localhost:8080`
header — mismatch, so every POST is rejected. Confirmed via
`docker compose logs django`:
```
Forbidden (Origin checking failed - http://localhost:8080 does not match any trusted origins.): /admin/login/
```
Also confirmed empty `CSRF_TRUSTED_ORIGINS = []` in the active (development)
settings, and `SECURE_PROXY_SSL_HEADER = None` there (so `is_secure()` is
correctly `False` — the scheme isn't the problem, only the missing port on
`Host` is).

**Impact:** Nobody can log into the local Django admin through the normal
nginx entrypoint the way this suite instructs (`http://localhost:8080/admin/`).
By extension, **any** session-authenticated POST/PUT/PATCH/DELETE reaching
Django through nginx on a non-default port is equally broken (Django admin
forms, and DRF's browsable API / `SessionAuthentication` if anything relies
on it) — the JWT-authenticated `/api/*` traffic from the Next.js frontend is
unaffected only because it doesn't use Django session cookies/CSRF. This
does not manifest on a standard port (443/80) since the Host header then
naturally has no port to lose, which is presumably why it was never caught,
but it makes local Django-admin QA/dev against the documented
`localhost:8080` entrypoint impossible out of the box.

**Fix:** change `proxy_set_header Host $host;` to
`proxy_set_header Host $http_host;` in `nginx/nginx.conf` (preserves the
port from the original request). Verified this fixes it: after the edit and
an `nginx` container restart, the same curl repro returned `302 Found` and
a valid session cookie, and browser login succeeded end-to-end.

**Note on how this report was produced:** to be able to do the rest of this
QA pass at all, I applied this one-line fix locally, restarted the `nginx`
container, ran the full sweep below, and then **reverted `nginx.conf` to
its original content** and restarted `nginx` again before finishing (confirmed
clean via `git diff nginx/nginx.conf` — no output). The fix itself was not
committed; it is a recommendation, not an applied change.

---

### 🟢 Low — Several models have no `__str__`, so Django admin surfaces raw `ModelName object (uuid)` instead of anything readable

Observed in list-view FK columns, success-flash messages, and delete
confirmation pages:
- `chat.Conversation` — e.g. `Message` admin's "CONVERSATION" column reads
  `Conversation object (89c0d8a2-a18a-4aa9-879b-e60fb969ad4a)`.
- `schools.SchoolClosure` — add/edit/delete flash messages read
  `SchoolClosure object (5df757e7-...)` instead of e.g. "QA Test School —
  25 Dec 2026".

Not a functional bug, but it's exactly the kind of paper-cut the "detailed
page" bar is meant to catch — an HQ ops person deleting a school closure or
skimming a conversation FK gets a UUID instead of a date/school or a
participant list. Cheap fix: add `__str__` to both models.

### 🟡 Medium — `HQRole.permissions` / `SchoolRole.permissions` (Postgres `ArrayField`) admin widget accepts any garbage silently, with zero validation or guidance

**Repro:** `/admin/accounts/hqrole/add/` → the "Permissions" field renders
as a bare text input with no help text. Entering `["dashboard"]` (a
reasonable guess, since the field conceptually holds a JSON-like list of
section keys) is accepted and saved *without error* — but Django's
`ArrayField` form widget doesn't parse JSON, it splits on commas, so the
whole string including the brackets becomes a single literal array item.
Result: `HQRoleAdmin.permission_count` for that row then displays
`1 — ["dashboard"]`, and the section-guard middleware
(`core/section_guard.py`, referenced in `SchoolRoleAdmin`'s own docstring)
would silently treat this HQ role as having exactly one (bogus) permission
string, not the `dashboard` section — a typo or format mismatch here fails
completely open/closed with no admin-visible error. Correct input syntax is
comma-separated (`dashboard,inbox`), which works fine and matches
existing seeded rows — but nothing in the UI says so.

**Suggested fix:** add `help_text` to the `permissions` field (or better,
a `django.contrib.postgres.forms.SimpleArrayField`-based choice widget /
multi-select scoped to the known section keys used elsewhere in the
codebase) so an admin operator can't create a role with a garbage
permissions entry that silently does nothing.

---

## Per-app results

Legend: PASS = exercised and correct. NOTE = exercised, correct, but with
an observation. N/A = checklist item doesn't apply to this model (no
filter/search/inline/custom action declared).

### `accounts/admin.py`

| Model | List view | Filters | Search | Sort | Add | Edit | Delete | Bulk delete | Notes |
|---|---|---|---|---|---|---|---|---|---|
| User | PASS (14 rows) | PASS (`?role=hq` → 8/14) | PASS (`?q=qa.student` → 1; `?q=zzznomatch` → 0, no error) | PASS (`?o=1`/`?o=-1` email column reverses) | PASS (created throwaway staff user, custom `add_fieldsets` renders Email/Role/Password1/Password2 correctly) | PASS (full `fieldsets` incl. Permissions/Groups/User permissions render; `is_staff`/`is_superuser` checkboxes save correctly and *actually* change what the admin UI exposes — see permissions sanity test below) | PASS (delete confirm correctly listed the 1 cascaded `User_user_permissions` m2m row) | not separately tested (single-record delete used instead) | — |
| HQMember | PASS (8 rows) | PASS (`sub_role`, `active`) | PASS | not explicitly re-tested (ordering is fixed by `name`) | PASS (required `user` FK wasn't obvious from the form layout — see below) | PASS | PASS (cascade summary correctly showed just the 1 object, no phantom cascades) | — | See dedicated `role_choice_form` test below. **Minor UX note**: the add form's required `User` field is easy to miss on first pass since the visual flow reads Name/Email/Sub role first; submitting without it gives a clear "This field is required" error, so it's not a silent failure, just a layout nit. |
| HQRole | PASS (7 rows) | PASS (`builtin`) | PASS | PASS (`key` sortable) | PASS | PASS | PASS (no cascade, since `sub_role`/`permissions` are soft string references, not real FKs) | — | `permission_count` custom `@admin.display` method renders correctly for all seeded rows. See 🟡 Medium bug above re: `permissions` ArrayField input format. |
| PendingInvitation | PASS (0 rows, correctly shows "0 pending invitations" not an error) | PASS (`type`, `school`) | not exercised (no rows) | — | not exercised | — | — | — | — |

**`role_choice_form(HQRole)` live-sourcing test (priority item):**
1. Created throwaway `HQRole(key="qa_temp_role", label="QA Temp Role")` via
   `/admin/accounts/hqrole/add/`.
2. Opened `/admin/accounts/hqmember/add/` — confirmed via
   `document.getElementById('id_sub_role').options` that
   `qa_temp_role:QA Temp Role (qa_temp_role)` appeared in the dropdown
   **immediately**, no cache/restart needed. **PASS — genuinely live.**
3. Set an existing HQMember's `sub_role` to `qa_temp_role`, then deleted the
   `HQRole` via the admin UI (confirm page correctly showed no cascade,
   since it's a soft reference).
4. Reopened that HQMember's change form: the `sub_role` `<select>` showed
   `qa_temp_role — non in matrice` as a selected, still-choosable option —
   **exactly** the documented fallback behavior in
   `backend/core/tests/test_admin_role_choices.py`
   (`test_a_role_no_longer_in_the_matrix_stays_visible`). **PASS.**
5. Reverted the HQMember's `sub_role` back to `analytics`. Verified via
   shell it round-tripped correctly.

### `schools/admin.py`

| Model | List view | Filters | Search | Add/Edit/Delete | Notes |
|---|---|---|---|---|---|
| School | PASS (3 rows: `Load School A`, `Load School B`, `QA Test School`) | PASS (`active`, `country`, `stripe_onboarding_complete`) | PASS | PASS — created `QA Delta Cascade School`, confirmed delete page showed **only** `Schools: 1` in the cascade summary (no surprise cascades for an empty school), deleted it, verified count back to 3. | Good `__str__` (shows school name, not UUID). |
| SchoolRole | PASS (3 rows) | PASS (`builtin`) | PASS | not exercised beyond list | `permission_count` custom display renders correctly. |
| SchoolMembership | PASS (3 rows) | PASS (`sub_role`, `school`) | PASS | not exercised (custom `save_model`/`delete_model`/`delete_queryset` logic wasn't exercised end-to-end this pass — **flagging as untested**, not failing; the code review of `admin.py` shows deliberate, well-commented sync-back logic to `User.roles`/`active_school` and a revocation message, worth a follow-up pass given how much side-effect logic lives there) | `member_email`/`member_name`/`is_active_school` custom display methods render correctly for all 3 seeded rows. |
| SchoolStudent | PASS (1 row) | PASS | PASS | not exercised | — |
| SchoolLocation | PASS (2 rows) | PASS (`school`) | PASS | not exercised | `room_count` display method renders correctly (`1` for both). |
| SchoolRoom | PASS (2 rows) | PASS (`location__school`, `location`) | PASS | not exercised | Custom `school` display method (derived from `location.school`) renders correctly. |
| SchoolClosure | PASS (0 rows baseline) | PASS (`type`, `school`, `date` hierarchy) | PASS | **PASS — full cycle exercised**: added a throwaway closure (`QA Test School`, `2026-12-25`, `full_day`), edited its `notes`, verified persistence via reload, then bulk-deleted via checkbox + "Delete selected school closures" action — confirm page correctly summarized `School closures: 1` — confirmed deletion, back to 0. | Priority item from the task — **admin CRUD confirmed working** (enforcement gap in booking code is separately filed, not re-investigated here, per instructions). No `__str__` (see 🟢 Low bug above). |
| SchoolDocumentType | PASS (0 rows) | PASS (`active`, `required`, `has_expiry`, `school`) | not exercised (no rows) | not exercised | — |

### `library/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| LibraryContent | PASS (0 rows, correct empty state) | PASS (all filters render) | — |
| VideoProgress | PASS (0 rows) | PASS (`completed`) | — |

### `translations/admin.py`

| Model | List view | Filters | Search | Notes |
|---|---|---|---|---|
| Translation | PASS — **11,310 rows**, paginated correctly (page 1 of 114), no timeout | PASS (`locale`) | not separately re-tested beyond the fix test below | **Priority item — root-cause confirmation of the pervasive i18n bug**: found `hq.packages.labelDescription` (locale `en`, pk 2471) with the literal placeholder value `"Label Description"`. Edited it via `/admin/translations/translation/2471/change/` to `"Description"`, saved, then queried the live public endpoint `GET /api/translations/?locale=en` directly — the field **immediately** returned the new value `"Description"`, no cache/restart needed, confirming the admin table is the direct, live source for `TranslationsView`. This independently confirms the pervasive raw-placeholder i18n bug is a **data problem, not a code/caching problem** — fixing the ~100+ other `Label Description`/`Placeholder Description`-style rows (e.g. `school.subscriptions.labelDescription`, `hq.library.labelDescription`, `hq.shop.labelDescription`, `hq.shop.placeholderDescription`, `school.courses.edit.labelDescription`, `school.courses.new.labelDescription`, `school.packages.labelDescription` — all still literally `"Label Description"`) would need doing the same way, in bulk. **Reverted** `hq.packages.labelDescription`/en back to `"Label Description"` afterward, confirmed via the same API call, so the single-instance fix wasn't left inconsistent with the other ~100 instances. |
| PlatformSetting | PASS (0 rows) | — | PASS | — |

### `geography/admin.py`

| Model | List view | Notes |
|---|---|---|
| HQCountry | PASS (0 rows) | `city_count` annotated display method present, not exercised with data this pass (0 rows) — **untested with actual data**, flagging as a gap. |
| HQCity | PASS (0 rows) | — |

### `notifications/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| Notification | PASS (0 rows) | PASS (all render) | — |
| EmailTemplate | PASS — **135 rows**, paginated correctly | PASS (`locale`, `school`) | — |
| EmailSetting | PASS (0 rows) | — | — |

### `chat/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| Conversation | PASS (1 row) | PASS (`type`, `status`, `priority`, `school`) | — |
| Message | PASS (1 row) | PASS (`sender_role`, `is_internal`) | `extract` custom display truncation works. **See 🟢 Low bug** — "CONVERSATION" column shows raw `Conversation object (uuid)` since `Conversation` has no `__str__`. |
| QuickReplyTemplate | PASS (0 rows) | PASS (`school`) | — |

### `commerce/admin.py`

All six models (`Transaction`, `DiscountCode`, `ShopProduct`,
`ShopProductVariant`, `ShopOrder`, `ShopSale`) — **PASS**, all list views
load correctly with 0 rows in the current fixture set, and all declared
filters render without error. Add/edit/delete not exercised (no natural
throwaway path without touching Stripe-adjacent fields) — **flagging as a
gap**, though the list-view/filter rendering itself, which is what would
most likely break from a bad `list_display`/`@admin.display` method, is
confirmed clean.

### `teachers/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| Teacher | PASS (1 row) | PASS (`active`, `school_links__school`) | `schools` custom display (joins active `TeacherSchool` links) renders correctly (`QA Test School`). |
| TeacherSchool | PASS (1 row) | PASS (`active`, `school`) | — |
| CompensationPlan | PASS (1 row) | PASS (`school`) | `rate_count` display renders (`0`, correct — no rates seeded). |
| CompensationPlanRate | PASS (0 rows) | PASS (`plan__school`, `lesson_type`) | — |
| TeacherCompensationPayment | PASS (0 rows) | PASS (`status`, `school`, `month`, `payment_method`) | — |

### `bookings/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| Booking | PASS — 8 rows, mixed statuses (Cancelled/Attended/No-show) render correctly | PASS (`status`, `access_source`, `credit_refunded`, `cancellation_type`, `school`) | Priority item ("large/core model, check date/school/status filtering") — confirmed working at current row count; no timeout or pagination issue. |
| Attendance | PASS (3 rows) | PASS (`status`, `status_ref`, `lesson__school`) | — |

### `catalog/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| LessonType | PASS (2 rows) | PASS (`active`, `level`) | — |
| Course | PASS (3 rows) | PASS (`active`, `school`, `lesson_type`, `is_online`, `frequency`, `language`) | — |
| Lesson | PASS — **34 rows**, correctly paginated by date hierarchy drilldown (Sept 2–15, 2026), `current_bookings`/`max_capacity` custom-adjacent columns render correctly for all rows including a 17/40 and 10/40 case | PASS (`status`, `school`, `is_online`, `lesson_type`, `date`) | Priority item — handled the row count fine, no crash. |
| Package | PASS (3 rows) | PASS (all 9 filters render, incl. `mode_filter`) | — |
| SubscriptionCatalog | PASS (0 rows) | PASS | Consistent with the documented "single-engine" decision (`PACKAGE_TO_SUBSCRIPTION.md`) — this table is legacy/unused, admin CRUD itself still works, not re-litigating the retirement decision. |
| AttendanceStatus | PASS (2 rows) | PASS (`school`, `burns_credit`, `is_default`) | — |

### `students/admin.py`

| Model | List view | Filters | Notes |
|---|---|---|---|
| Student | PASS (2 rows) | PASS (`school`, `country`, `city`, `language_preference`) | — |
| StudentPackage | PASS (2 rows) | PASS (`status`, `school`, `payment_method`) | "PACKAGE" column shows `-` for both rows — verified via DB shell this is **correct**, not a bug: both `StudentPackage` rows in the fixture set originate from `ManualCreditGrant`s, which legitimately create a `StudentPackage` with `package=None`. |
| StudentSubscription | PASS (0 rows) | PASS | — |
| StudentDocument | PASS (0 rows) | PASS (`status`, `school`, `type`, `type_ref`) | — |
| ManualCreditGrant | PASS (2 rows) | PASS (`school`, `payment_method`) | — |

---

## Permissions sanity check (bonus item)

Created a throwaway `User` (`qa.admin.delta@qa-nounder40.test`) with
`is_staff=True`, `is_superuser=False`, and exactly one permission granted
via the admin UI's `user_permissions` picker (`Schools | school | Can view
school`). Logged in as this user against a fresh session (curl, to avoid
disturbing the main browser session) and confirmed:

- Admin index (`GET /admin/`) shows **only** the "Schools" app/model —
  everything else the superuser sees is correctly hidden.
- `GET /admin/accounts/user/` → **403** (no permission on `User`).
- `GET /admin/schools/school/` → **200** (has `view_school`).
- `GET /admin/schools/school/add/` → **403** (no `add_school` permission).

Django's own `is_staff`/permission-based admin gating is **correctly wired
end-to-end**. Deleted the throwaway user afterward (cascade summary
correctly showed the 1 `User_user_permissions` m2m row, no surprises).

---

## Items explicitly out of scope / not re-litigated

- `SchoolClosure` **enforcement** gap in booking/lesson-generation code —
  already filed separately per the task's own framing; only the admin
  CRUD itself was re-verified here (PASS).
- Stripe-backed fields (`stripe_onboarding_complete`, `stripe_product_id`,
  etc.) — masked keys per `CLAUDE.md` §9, so live Stripe round-trips were
  never in scope; only that the admin fields themselves render and save
  was checked incidentally via the models that carry them.
- `subscriptions_catalog` / `SubscriptionCatalog` — confirmed admin CRUD
  surface exists and doesn't crash; the retirement of the parallel engine
  itself is a product decision tracked in `PACKAGE_TO_SUBSCRIPTION.md`, not
  re-opened here.

## Gaps for a follow-up pass (time-boxed out of this run)

- `SchoolMembership`'s custom `save_model`/`delete_model`/`delete_queryset`
  side-effect logic (syncing `User.roles`/`active_school`, revocation
  messaging) was read and looks correct, but not exercised end-to-end via
  the admin UI.
- `commerce` app models' add/edit/delete flows (list views and filters are
  confirmed clean; no natural throwaway data path was available without
  Stripe-adjacent fields).
- `HQCountry`/`HQCity` `city_count` annotation was only checked against 0
  rows; worth re-checking with actual seeded countries/cities.
