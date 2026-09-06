# QA Test Results — School Panel Delta Pass

> Delta pass on top of the existing "## 2. School Paneli" section in
> `QA_TEST_RESULTS.md`. Scope: areas the prior pass had **not** gone deep on
> (Teachers invite lifecycle, Compensation, Students manual-credit UI,
> Attendance Statuses `burns_credit`, Documents enforcement, Packages
> edit/duplicate/deactivate, Payments/Reports, Locations+Room, Calendar
> filters, Closure Days). Environment: primarily **dev**
> (`https://dev.danzaclassicanounder40.com`, QA Test School), with **local**
> (`http://localhost:8080`) used for anything needing a correctly-linked
> real student (booking, attendance, compensation, document-blocking,
> closure-day enforcement), per the known dev `qa.student` mis-link.
> All dev-side test data created during this pass was deleted; verified
> clean at the end (see "Environment cleanup" below).

## ⚠️ Methodology note — shared-browser session contamination (read first)

The Claude Browser pane used by this session is **shared across all 4
parallel QA agents**, and JWTs are stored in `localStorage`, which is
**shared across every tab on the same origin** (confirmed: all tabs share
the single key `nu40_access`). Multiple times during this run, a sibling
agent logging into `dev.danzaclassicanounder40.com` or
`http://localhost:8080` in their own tab silently overwrote this tab's
active session (e.g. mid-test I found myself authenticated as
`qa.hq.owner` or `qa.student` without having logged in as them). This
produced several **false-positive-looking failures** (`404 not_found` on
a teacher PATCH, `403 not_a_school_member` on a credit grant, stale
cross-tenant discount-code rows rendered from a previous fetch) that
**disappeared immediately on re-authenticating** and were confirmed
correct via a direct `curl` call with a dedicated, non-shared token.

**This is not a product bug** (JWT-in-localStorage is documented,
intentional architecture — CLAUDE.md invariant #1), but it **is** a real
consideration: two accounts open in two tabs of the same real browser
will clobber each other's session exactly like this happened here. Noting
it in case the human stakeholder wants a hardening ticket, and so the
coordinator doesn't mistake sibling-echoes in the other agents' reports
for independent confirmations of the same bug.

Practical effect on this report: every finding below that involves a
persistence check was **cross-verified with a dedicated `curl` token**
(never relying solely on a browser-observed failure), so the bugs listed
under "New Bugs Found" are real, not contamination artifacts.

---

## New Bugs Found

### 🟠 High — Closure Days are recorded but never enforced anywhere
`POST /api/school/closures/` (Settings → Closure Days) happily creates a
`SchoolClosure` row (`date`, `end_date`, `notes`), and the School Settings
UI presumably lists it — but **grepping the entire backend, `SchoolClosure`
is referenced only in `schools/views.py` (CRUD), `schools/serializers.py`,
`schools/admin.py`, `schools/models.py`, and the Supabase ETL script. It is
never read by `catalog/` (course/lesson generation) or `bookings/`
(booking creation).**

**Live repro (local):** created a closure `2026-09-06 → 2026-09-06`, then
`POST /api/bookings/ {"lesson_id": <a lesson dated 2026-09-06>}` as
`qa.student` → **`201 Created`, booking succeeded, credit deducted**, no
warning, no block. Also confirmed via dev: an existing lesson already
scheduled on the closure date kept `status: "scheduled"` after the closure
was created (not retroactively cancelled, which is expected), but more
importantly **new bookings against it are not blocked either**, and
(per the code search) a new recurring course's lesson-generation would
not skip that date. Cleanup: cancelled the test booking, deleted both
closure records (dev id `69ae1848…`, local id `39c6859d…`).

**Impact:** a school owner declaring a holiday/closure gets a UI element
that looks authoritative but has zero effect — students can still book,
and existing lessons on that day are neither cancelled nor flagged.
**Location:** `backend/schools/models.py` `SchoolClosure`; needs a check
in `bookings/services.py` (booking creation) and ideally in the
course/lesson-generation path in `catalog/`.

### 🟠 High → 🟡 Medium — Package Edit/Duplicate is broken for any pre-existing "all lesson types" package
`PackagesManager.tsx` (`frontend/src/components/PackagesManager.tsx`)
added a client-side guard (line ~330): `if (form.allowed_lesson_types.length
=== 0) { setError(...) }` — blocking Save unless at least one lesson type
is explicitly checked. But the pre-existing seeded package ("QA Credit
Pack") has `lesson_type_restriction: "all"` and `allowed_lesson_types: []`
(the legacy "no restriction = all types" representation). `formFrom()`
maps this straight to `allowed_lesson_types: []`, so **both Edit and
Duplicate on this package are permanently blocked** by
"Pick at least one lesson type: a package has to say which lessons it
covers." — reproduced live for both actions (screenshots/DOM captured).
The only way out is to explicitly pick specific lesson types, which
**silently narrows the package's actual scope** from "all types" to
"just these" the moment the owner tries to fix an unrelated field (e.g.
price) and saves.

**Impact:** any package created before this validation was added (or via
direct API/seed data with an empty `allowed_lesson_types`) can never be
edited or duplicated again through the UI without accidentally changing
what it covers. **Location:**
`frontend/src/components/PackagesManager.tsx` `formFrom()` /
`handleSave()` — needs either (a) treating `[]` + `lesson_type_restriction
=== 'all'` as a valid "no restriction" state with its own explicit
toggle, or (b) backfilling `allowed_lesson_types` for legacy rows so the
form never encounters an empty list for a real package.

### 🟢 Low — `PATCH /api/school/teachers/{id}/` has no email-uniqueness guard
`SchoolTeacherDetailView.patch` (`backend/teachers/views.py:414-419`) sets
`teacher.user.email = new_email` and saves without checking whether
another `User` already owns that email — a duplicate email PATCH would hit
the DB's unique constraint and surface as an unhandled `IntegrityError`
(500) instead of a clean 400. Not reproduced live (didn't want to create a
second real account collision on shared dev), flagged from code reading
only — low confidence/low severity, but cheap to guard.

---

## Clarification (not a bug) — `AttendanceStatus.burns_credit` does not affect credit balance

The task brief assumed a custom attendance status with `burns_credit:
false` would refund/not-burn the student's credit when used to mark
attendance. **This is not how the system works, by explicit design**
(docstring in `backend/bookings/services.py::mark_attendance`, decision
dated 2026-08-30): *"Attendance never touches credits — the credit was
deducted at booking time and only moves with a cancellation… A status'
'counts as absence' flag only decides present vs no_show, i.e. statistics
and the no-show email."*

**Verified live (local):** created a custom status "Makeup Class"
(`burns_credit: false`), used it to mark a booked lesson's attendance →
`booking_status` correctly derived as `attended` (present), the custom
`attendance_status_id` was stored correctly, and — as expected per the
documented design — **the student's credit balance was unchanged**
(stayed at 5.0, same as immediately after booking). This is correct,
consistent behavior, not a gap. Recommend the product spec/CLAUDE.md be
explicit about this so a future QA pass doesn't re-flag it as broken.
Cleaned up: deleted the custom status afterward.

---

## Per-page results

### Teachers (`/school/teachers`, `/school/teachers/invite`)
| Action | Result |
|---|---|
| Empty-field submit (Add Teacher) | ✅ PASS — native HTML5 `required` blocks submit on first/last/email |
| Add Teacher with valid `...@qa-nounder40.test` email | ✅ PASS — `201`, teacher appears immediately as `active: true` (this reflects the `TeacherSchool` link, not onboarding completion — account has `set_unusable_password()` until the invite is accepted; correct design, not a bug) |
| Edit teacher (phone number) | ✅ PASS — verified via API before/after |
| Resend Invite | ✅ PASS (`POST /api/school/teachers/resend/` → `{"sent": true}`) — an earlier browser-observed `403`/`404` was session contamination, see methodology note above |
| Remove teacher | ✅ PASS — `DELETE /api/school/teachers/` unlinks correctly, verified list afterward |
| Cleanup | ✅ throwaway teacher (`qa.throwaway.teacher@…`) fully removed, verified `GET /api/school/teachers/` shows only `qa.teacher@…` |

### Compensation (`/school/compensation`)
| Action | Result |
|---|---|
| Plan already assigned ("QA Standard Plan": base_fee €25, bonus_threshold 3, bonus_per_student €5) applied to a lesson with 1 attended student | ✅ PASS — School's `GET /api/school/teachers/{id}/compensation/?month=2026-09` and the Teacher's own `GET /api/teacher/compensation-overview/` **agree exactly**: total €25.00, `has_bonus: false`, `threshold_gap: 3` (needs 3 more students to hit the bonus) |
| Cross-check formula (`compute_lesson_fee` in `backend/teachers/services.py`) | ✅ reads correctly: `base_fee` + `bonus_per_student × min(students_over_threshold, bonus_max_threshold)` |
| Bonus-threshold-exceeded scenario | ⚠️ NOT independently re-tested this pass (would need ≥4 students on one lesson; only 1 real student available) — formula read and confirmed correct by code inspection instead |

### Students (`/school/students`) — manual credit grant
| Action | Result |
|---|---|
| "Add Credits" button opens modal | ✅ PASS (full form: amount, reason dropdown, optional package, expiry, price paid, payment method, note) |
| Half-credit grant (amount = 2.5) | ✅ PASS — verified via API: student balance moved 5.0 → 7.5 exactly; confirms `Decimal`/half-credit handling holds for manual grants same as for packages (CLAUDE.md §4.2) |
| Grant appears somewhere for audit | ✅ PASS — surfaces on the separate **"Manual credits"** nav page (`GET /api/school/credits/grants/`), not on Payments/Transactions (which is Stripe-only) — correct information architecture, not a bug |
| Field-name note | the grant endpoint expects `amount`, not `credits`, in the POST body — matches what the UI form actually sends (confirmed by reading `PackagesManager`-style modal in the Students page); only tripped up my own first curl attempt |
| Export Xls / Export Pdf | ⚠️ INCONCLUSIVE — clicked on dev with 0 students (QA Test School has no students on dev due to the known `qa.student` mis-link); click produced no error and no observable network call either way. Recommend a sibling/future pass re-check with local's 1 real student present. |

### Attendance Statuses (`/school/settings/statuses`)
| Action | Result |
|---|---|
| Create custom status ("Makeup Class", `burns_credit: false`) | ✅ PASS |
| Use it to mark a booked lesson's attendance | ✅ PASS — correctly derived `present`/`attended`, stored the custom `attendance_status_id` |
| Verify credit impact | ✅ PASS but **see Clarification above** — no status, `burns_credit` true or false, touches credit at mark-time; only cancellations move credit. This confirms existing "Presente"/"Assente" behavior generalizes correctly to custom statuses. |
| Cleanup | ✅ custom status deleted, verified `204` |

### Documents (`/school/documents`, Settings → block-booking toggle)
| Action | Result |
|---|---|
| Create Document Type ("Medical Certificate", `required: true`) | ✅ PASS |
| Toggle `block_booking_on_documents` ON | ✅ PASS |
| Student missing the document attempts to book | ✅ PASS — **blocked**, `400 {"error": "documents_required"}` |
| Toggle OFF, retry same booking | ✅ PASS — booking now succeeds (`201`), credit deducted correctly |
| Cleanup | ✅ document type deleted, toggle restored to `false` on both dev and local |

This is a fully verified, working end-to-end enforcement — the strongest
positive finding of this pass alongside the previously-verified
credit/cancellation logic.

### Packages (`/school/packages`)
| Action | Result |
|---|---|
| Deactivate existing package | ✅ PASS — `active: true → false`, verified via API |
| Reactivate | ✅ PASS — `false → true`, verified via API, restored to original state |
| Duplicate ("QA Credit Pack" → prefills "QA Credit Pack (copia)", copies credits/validity/price/color) | ❌ FAIL — see "New Bugs Found" above (blocked by lesson-type validation on a legacy "all types" package) |
| Edit (same package, unrelated field) | ❌ FAIL — same root cause, blocks Save entirely |
| Discount Codes tab — confirms **schools have their own discount codes**, independent from HQ's | ✅ PASS (existence/scoping) — `GET /api/school/discount-codes/` correctly scoped and empty for QA Test School; a stale-looking list of 3 codes from other schools shown once in-browser was a session-contamination artifact (see methodology note), not a real cross-tenant leak — confirmed via fresh page load + API call both returning `[]` |

### Payments (`/school/payments`) / Reports (`/school/reports`)
| Action | Result |
|---|---:|
| `GET /api/school/transactions/` | ✅ PASS — empty array, no error (expected: masked Stripe keys, known limitation per CLAUDE.md §9) |
| `GET /api/school/reports/` (KPIs) | ✅ PASS — all fields present and sane (`monthly_revenue: 0.0`, `weekly_lessons`, `lessons_scheduled`, etc.), no 500s |
| Manual credit grants surfaced correctly on the separate Manual Credits page, not conflated with Payments | ✅ PASS (see Students section) |
| Export/filter buttons on these pages | ⚠️ NOT deeply exercised this pass — time-boxed; no errors observed on page load |

### Locations (`/school/locations`) + Rooms
| Action | Result |
|---|---|
| Add Location ("QA Studio B") | ✅ PASS |
| Add Room under that location ("Sala QA 1", capacity 15) | ✅ PASS — **verified nesting**: `GET /api/school/locations/{id}/` returns the room inside `rooms: [...]` |
| Delete Room, then Location | ✅ PASS — both `204`, final `GET` confirms empty list |

(Driven via API rather than UI clicks this pass, given the shared-browser
flakiness documented above and that the prior pass already exercised the
Add-Location UI form; the new coverage here is specifically the
Room-under-Location nesting + cleanup, which had not been tested before.)

### Calendar (`/school/calendar`)
| Action | Result |
|---|---|
| Week/Day/Month/Year view toggle buttons present | ✅ present (not each one individually clicked this pass) |
| Click a lesson chip → detail popup | ✅ PASS — shows date, time, teacher, format, room, bookings count, credits, enrolled students list, "Edit class"/"Mark attendance" actions |
| "Teachers" filter dropdown | ✅ PASS — opens, lists "QA Teacher" as a checkbox, selecting it adds a "Teachers 1" badge + an active-filter chip + a "Clear filters" button; lesson correctly still shown (only 1 teacher exists, so no negative case was possible, but the filter-state UI wiring is confirmed correct) |
| "Clear filters" | ✅ PASS — resets cleanly, verified via re-read of the filter bar |
| "+ Add class" shortcut | ✅ PASS — opens "Add Class to Existing Course" modal (Course/Date/Start Time/Duration fields) — this is a lesson-only shortcut, not a full new-course wizard, which is the correct/expected scope; cancelled without submitting (didn't want to create+clean up another lesson given time budget, and Course creation was already exhaustively tested in the prior pass) |
| "Locations" / "Rooms" filters | ⚠️ NOT clicked into this pass (QA Test School has 0 locations/rooms after cleanup) — Teachers filter behavior gives confidence they use the same mechanism |

### Closure Days (Settings)
See "New Bugs Found" above — 🟠 High: created, deleted, confirmed **zero
enforcement** in booking or lesson-generation code.

---

## Environment cleanup — verified clean at end of run (dev)

| Resource | State |
|---|---|
| Teachers | only `qa.teacher@qa-nounder40.test` remains (throwaway teacher removed) |
| Packages | only original "QA Credit Pack", `active: true` (restored) |
| Locations | `[]` |
| Closures | `[]` |
| Document types | `[]` |
| `School.cancellation_policy_hours` | `24` (unchanged) |
| `School.block_booking_on_documents` | `false` (restored) |
| Orphaned lessons (`course: null`, future dates) | `0` |

Local (`http://localhost:8080`) environment notes (expected to remain
changed, per the QA brief — single-user isolated DB):
- `qa.student` credit balance permanently at a different value than at
  session start due to: +2.5 manual grant (kept, no delete mechanism
  exists for grants by design — audit trail), +1 booking/-1 credit from
  the Documents-enforcement test (kept, booking still active), a
  booked-then-cancelled-outside-policy test lesson for the Closure Days
  test (burned 1 credit, matches correct cancellation-policy behavior for
  a same-day cancellation).
- Custom attendance status "Makeup Class" — deleted.
- Local closure day — deleted.
- Local document type "Medical Certificate" — deleted.

No writes were made to `c.carlo@cfcholding.it`, `hakantimur55@gmail.com`,
"Danza Classica Milano", "Danza Clásica Barcelona", or "Hakan School" at
any point in this pass.
