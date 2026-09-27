# Waitlist alerts and VIP students — decision record (brainstorm)

**Status:** §2.1 (the spot-freed alert) **implemented** on branch
`feat/spot-alerts` (September 27, 2026) — see §2.4 for what was built. The
VIP flag (§2.2, §2.3) is still a brainstorm.
**Scope:** what exists today, the direction Carlo chose, the open questions,
and the touch points for whoever builds it.
**Depends on:** the single credits engine (`PACKAGE_TO_SUBSCRIPTION.md`).
A waitlist must never become a second booking or credit path.

---

## 1. What exists today (four dead fields)

The course form already carries settings that **nothing reads**:

| Field | Where it is shown | Who reads it |
|---|---|---|
| `Course.waitlist_enabled` | course new/edit, bulk edit ("Enable waitlist") | nobody |
| `Course.vip_booking_hours_before` | course new/edit, bulk edit ("VIP early booking (hours)") | nobody |
| `Course.reserve_spots` | course new/edit ("Reserved spots") | nobody — `assert_bookable` compares `current_bookings` with `max_capacity` only |
| `Package.is_vip` | Packages manager checkbox, purple "VIP" badge in the student shop | nobody beyond the badge |

Also relevant:

- `SubscriptionCatalog.is_vip` / `priority_booking_hours` belong to the
  retired subscriptions engine and go away with it.
- There is **no per-student VIP flag** anywhere.
- There is **no "booking opens N days before" rule**. Lessons are generated
  up to the schedule end date (365 days when absent) and a student can book
  any of them immediately. The only time rule enforced is
  `min_booking_notice_hours` ("no later than") in
  `bookings/services.py::assert_bookable`.
- When a lesson is full the student calendar shows a "Full" badge and
  disables the button (`BookClient.tsx`). Nothing else is offered.
- Notification channels: **email only**. No push (PWA gap, CLAUDE.md §10),
  the notification center page was removed.

## 2. Direction chosen (Carlo, 26/09/2026)

### 2.1 Waitlist = "notify me if a spot frees up"

Not a queue. No booking state, no credit movement, no auto-promotion, no
confirmation deadline. The single-engine rule holds: the alert is a
notification, the booking is still the ordinary booking.

- **Per lesson** (single date). One record per (student, lesson).
- When the lesson is full and `Course.waitlist_enabled` is on, the disabled
  "Full" button becomes **"Notify me if a spot frees up"** (toggle on/off).
- **Trigger:** a seat is released while the lesson is still `scheduled` →
  Celery task queued **after commit** (domain rule 7) → one email to every
  subscriber, in the student's language. **First to book wins**, and the
  email says so.
- Seat-release hook points already exist in `bookings/services.py`:
  `_bump_lesson(lesson, -1)` (student/school single cancel) and
  `release_lesson_seats()` (bulk paths). Add the school raising
  `max_capacity` on a lesson. A **cancelled lesson frees seats but must not
  notify**.
- After one notification the record is **deleted**; the student may
  re-subscribe if she missed it. Delete it when she books that lesson.
  FK cascade on lesson delete. Past lessons: nothing to do.
- The school sees **how many students are waiting** on a lesson (signal to
  add a date or a bigger room).
- Reuse `waitlist_enabled` as the switch; rewrite its help text in the five
  locales.

### 2.4 As built (feat/spot-alerts, 27/09/2026)

Decisions taken while building, on the open questions of §3:

- **Per lesson only.** No "any date of this course".
- **No VIP delay**: everyone waiting is emailed at once (the VIP flag is
  not built; use 1 of §2.3 slots in later as a `countdown` on a second
  batch).
- **No email to the school**; it sees the count instead.
- `vip_booking_hours_before` and `reserve_spots` on the course are left as
  they were (still unread).
- The course checkbox is now labelled "Spot-freed alert" and its help text
  says what happens; the field is still `waitlist_enabled`.

Backend:
- `bookings.LessonSpotAlert` (migration `bookings/0008`): student, lesson,
  school, `created_at`; unique per (student, lesson); cascades with the
  lesson and the student.
- `bookings/services.py`: `spot_alert_error` / `add_spot_alert` /
  `remove_spot_alert` (the rules: course `waitlist_enabled`, lesson
  scheduled and still to come, event approved, lesson full, no booking of
  hers), `forget_spot_alert` (called by `book_lesson` and `staff_enrol`:
  she is in), `schedule_spot_alerts(lesson_id)` (one EXISTS, then the task
  on commit — domain rule 7), `notify_spot_available(lesson_id)` (the task
  body: re-checks the lesson, emails every waiting student in her language
  with the online variant when the lesson is online, deletes the rows under
  `select_for_update` so two workers never double-send; a cancelled or past
  lesson drops its rows silently; a lesson full again keeps them).
- Triggers: `cancel_booking`, `staff_unenrol`, the `post_delete` signal on a
  booking row (`bookings/signals.py`), and the school raising a lesson's
  `max_capacity` (`SchoolClassDetailView.patch`). A cancelled lesson or a
  deleted course releases seats through `release_lesson_seats` and is not a
  trigger on purpose: the task would find the lesson cancelled anyway.
- `notifications/tasks.py::spot_available_task`; e-mail
  `student.spot_available` (+ `.online`) in `brand_templates.py`, placeholders
  = the lesson set (the new `lesson_email_context(student, lesson, school,
  locale)`, which `booking_email_context` now delegates to) + `lesson_url`,
  the school calendar opened on the lesson's day
  (`/student/book?school_id=…&date=…`), added by the task only.
- API: `POST` / `DELETE /api/student/lessons/<id>/spot-alert/`,
  `GET /api/student/spot-alerts/` → `{"lessons": [...]}` (upcoming only);
  the browse feed's `courses.waitlist_enabled`; the school's
  `lessons-feed` rows carry `waiting`.
- Tests: `bookings/tests/test_spot_alerts.py`.

Frontend:
- `student/book/BookClient.tsx`: on a full lesson of a course with the flag,
  the greyed "Book" becomes "Notify me if a spot frees up" (toggle; anonymous
  → the login prompt); `alertMap` loaded with the bookings.
- `school/calendar/CalendarClient.tsx`: `⏳N` next to the seat count in
  the cells and a "Waiting for a spot" row in the detail panel.
- `hq/emails/page.tsx`: the two new cards. Five locales for every string.

### 2.2 VIP = a flag on the student, ticked by the school

- `SchoolStudent.is_vip` — **per school**, like the wallet (domain rule 3).
  The same person can be VIP in one school and not in another. Not on
  `Student` / `User`.
- **Remove `Package.is_vip`**: column, checkbox, shop badge. One word, one
  meaning. `is_popular` stays for the storefront badge. The retired
  subscription catalog keeps its own flag and disappears with the engine.
- UI: toggle on the school's student detail page; column + **multi-select
  filter** on the students roster (Carlo's filter rule); small badge in the
  teacher's register.

### 2.3 Ship the VIP flag together with at least one use

A flag nobody reads becomes the fifth dead field. Candidates, by cost:

1. **Head start on the spot alert** — VIP subscribers are emailed
   immediately, the others after ~30 minutes *if the seat is still free*
   (re-check at send time). Combines 2.1 and 2.2 at almost no extra cost.
   **Recommended first use.**
2. **VIP ignores `min_booking_notice_hours`** and can book until the lesson
   starts. One condition in `assert_bookable`.
3. **VIP may book into `reserve_spots`.** Gives meaning to that dead field
   too, but "reserved" must first be defined for the school's manual enrol.
4. **VIP early booking window** (`vip_booking_hours_before`) — the classic
   perk. Needs a general **"booking opens N days before"** rule first
   (school default + course override), which does not exist and changes
   today's behaviour for every student. **Separate decision.**

**Recommendation:** 2.1 + 2.2 + use 1 in one delivery. Use 4 later, on its
own decision page.

## 3. Open questions

- Alert per lesson only, or also "any date of this course"? (Leaning: per
  lesson only.)
- Non-VIP delay: fixed 30 minutes, or a school setting?
- Does the school get a notification when someone joins the alert list?
- `vip_booking_hours_before` on the course while use 4 is not built: hide
  the field, or leave it and say it is not active?
- `reserve_spots`: implement (use 3) or remove from the form?
- Alert email template key and copy in the five locales.

## 4. Related, parked: sub-hour booking notice

`min_booking_notice_hours` is an **integer number of hours** end to end
(`IntegerField` on `School` and `Course`, DRF `IntegerField` on school
settings, `int()` in the course/event endpoints, `type="number"` without a
`step` in the forms). Consequences today:

- School settings: the browser blocks `0.5` (step mismatch); the API would
  answer 400 anyway.
- Course new/edit and the event form: no native form validation, `0.5` is
  sent as a number and Python's `int(0.5)` **silently stores 0** ("bookable
  until start").

If 20/30 minutes are ever wanted: switch the unit to **minutes**
(`min_booking_notice_minutes`, migration ×60), not decimal hours. Parked by
Carlo on 26/09/2026.

## 5. Touch points (for the implementation)

Backend
- `schools/models.py` — `SchoolStudent.is_vip` (+ migration).
- `catalog/models.py` — drop `Package.is_vip` (+ migration); new
  `LessonSpotAlert` model (student, lesson, created_at; unique together).
- `bookings/services.py` — `_bump_lesson`, `release_lesson_seats`,
  `assert_bookable` (use 2 if chosen); queue the alert task after commit.
- `catalog/course_views.py` — lesson `max_capacity` PATCH path.
- `notifications/tasks.py` — `spot_available` email (VIP first, others
  delayed), through `send_transactional_email_task`.
- `config/api_student.py` — subscribe / unsubscribe endpoints.
- `students/school_views.py`, `students/serializers.py` — `is_vip` on the
  roster and detail; waiting count on lessons.
- Tests in `bookings/tests/` (seat freed → task queued, cancelled lesson →
  no task, VIP delay).

Frontend
- `student/book/BookClient.tsx` — the "notify me" toggle when full.
- `school/students/*` — VIP toggle, column, multi-select filter.
- `components/PackagesManager.tsx`, `student/buy/page.tsx` — remove the VIP
  checkbox and badge.
- `components/school/ScheduleFields.tsx`, course new/edit — waitlist help
  text; decide what to do with the VIP hours field.
- `messages/*.json` — five locales for every new string.
