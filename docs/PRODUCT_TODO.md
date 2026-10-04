# Product to-do list

Carlo's list of confirmed product gaps and deferred work: the things agreed
as "to do, not now". It is not the migration roadmap
(`REFACTOR_MONOREPO_PLAN.md`) and not a spec. Each entry says what is
missing, when it was noted and where the details live.

> Entries were written on the dates shown and have **not all been
> re-checked against the code since**. Verify an entry before starting it.

Last update: 04/10/2026.

---

## Open

### 1. Video courses, replacing LearnDash

Design draft in [`VIDEO_COURSES.md`](../VIDEO_COURSES.md); nothing is built.
Waiting for:

- the video hosting, to design with Hakan (§12.1 of that document);
- three confirmations from Carlo (§12.2): start with the current Vimeo
  links and move the videos later, or new hosting from day one; how many
  courses and videos there are (the "about a hundred" is read as
  enrolments); whoever runs the WordPress site confirms the courses are
  sold there and can export the buyers.

### 2. Where a school sees its commissions (noted 03/10/2026)

One place for shop and video-course commissions, to design later. Today the
figures exist only on the HQ side (HQ → Shop → Sales, HQ → Reports →
Schools).

### 3. School fee to HQ (noted 14/08/2026)

HQ earns only the percentage fee on student transactions (Stripe Connect
application fee). Missing: an affiliation fee or subscription that each
school pays HQ to be on the platform.

### 4. Emails without a trigger (noted 16/08/2026, updated 24/08/2026)

At the time several templates had no sender: welcome, lesson cancelled by
the school, package expiring, the `.online` variants, the `school.*` and
`hq.*` templates. Much has changed since: templates now live in
`backend/notifications/brand_templates.py` and several got their task
(`package_expiring_task`, for one). **Needs a fresh check**: go through the
template list of the HQ Emails page and confirm each one has a trigger.

### 5. Student notification centre (spec §9.10, checked 23/08/2026)

Only the `Notification` model exists (`backend/notifications/models.py`):
no API, nothing writes to it, no page. The `/student/notifications` link
was removed from the student navigation because it crashed; it comes back
when the feature is built. Also listed in CLAUDE.md §10.

### 6. Buying across schools (noted 14/08/2026)

Browsing lessons across schools by city and country works, but buying was
tied to the student's primary school (`Student.school`): checkout and the
package catalogue showed only that one. The vision: a student buys packages
from different schools, in different countries too, with a separate wallet
per school — which the data model already allows (`StudentPackage.school`).

### 7. "Renew now" for subscriptions (noted 20/09/2026)

A student who uses up the subscription's lessons before the renewal date
(4 lessons a month bought on the 1st, finished by the 20th) has no single
action to start again at once. Today she either buys a one-off package or a
drop-in as a bridge, or cancels from the Stripe portal and subscribes again
— two manual steps. Buying a second subscription without cancelling the
first creates two Stripe subscriptions with two billing cycles.

To build: one action that cancels the old subscription and opens the new
checkout, keeping the lessons already paid usable.

Related: `Package.credits_rollover` exists but nothing applies it. At
renewal the lessons always reset to `package.credits` and the unused ones
are lost. To decide together with "Renew now". Background in
`PACKAGE_TO_SUBSCRIPTION.md` and `PACKAGE_EXTENSIONS.md`.

### 8. Slow students list and calendar in production (noted 20/09/2026)

With about 900 students the school's students page and bookings take time
to load. Causes measured then:

- `GET /api/school/students/` ran two queries per student (active packages
  and old subscriptions), about 1,800 queries. The same endpoint is also
  downloaded by the school calendar and the attendance page for the "add
  student" picker, and the students page is not paginated.
- `GET /api/student/lessons/` ran one closure query per lesson: 1,439
  lessons in production, 3.1 seconds measured.

Remedy: (1) prefetch packages and subscriptions in two queries overall;
(2) load the closures of the schools involved once per date range and check
them in memory; (3) later, a light "names only" endpoint for the pickers
and server-side pagination and search on the students page. Tests with
`assertNumQueries`. Estimate for (1) and (2): half a day.

### 9. A failing test on `develop` (checked 04/10/2026)

`schools/tests/test_resend_invite_already_active.py::test_teacher_resend_refuses_an_onboarded_teacher`
fails on `develop`, independently of any current work. The rest of the
backend suite passes (1758 tests).

---

## Done

- **Special events / workshops with HQ approval** — 20/09/2026, PR #248,
  `SPECIAL_EVENTS.md`.
- **School commission on online shop orders of HQ products** — 04/10/2026,
  PR #303. Online orders now credit the student's home school as manual
  sales do, and the HQ report's Schools tab reads the commission from the
  sale line. Past orders were not recalculated.
