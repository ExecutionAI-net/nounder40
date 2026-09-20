# Special Events — school-titled workshops, approved by HQ

**Status:** implemented on branch `feat/special-events` (September 20, 2026).
**Scope:** product decision record + how it is built. Decisions taken with
Carlo on 20/09/2026; see the "Decisions" section for the reasoning.
**Depends on:** the single credits engine (`PACKAGE_TO_SUBSCRIPTION.md`) and
the drop-in checkout (`DROP_IN_BOOKING.md`).

---

## 1. The gap

Schools could only create courses of a lesson type defined by HQ. The
original spec (§6.8, §7 "Special Event / Workshop") also wanted a school to
propose a one-off event with its **own title** — a workshop, a masterclass,
an open evening — that **HQ approves** before it is published, and that may
be **free**. CLAUDE.md §10 listed this as a conscious gap; this document
closes it.

## 2. Decisions

1. **An event is a `Course`**, not a new model: `is_special_event=True`,
   `lesson_type=NULL`, `frequency="single"`, one date, one `Lesson`. Booking,
   attendance, cancellation, teacher compensation, reports, calendar, public
   board and emails are the ordinary lesson machinery. The booking page
   already showed `courses.name` over the lesson-type name, so the title is
   free; description, image and video live on the course as well
   (`description`, `image_url`, `video_url`).
2. **A new event is hidden until HQ approves it.** The `Lesson` is created
   on approval, so before that it exists nowhere — not even on the school's
   calendar. Pending, rejected and suspended events are excluded from the
   student browse feed and the public board, and `assert_bookable` refuses
   them regardless.
3. **Edits after approval go live at once.** The alternative (keeping the
   approved copy live while the edit waits) needs a second copy of every
   field; not worth it. A student-visible change stamps `event_changed_at`
   and lists the event in HQ's "Modified" tab, where HQ marks it reviewed or
   **suspends** it (hidden and not bookable, seats kept; the school fixes and
   resubmits, or cancels). Internal notes and email info do not flag. A
   date/time change emails the students signed up (`student.event_updated`).
4. **Free event = a seat and nothing else.** `credit_cost` 0; `book_lesson`
   creates the booking with `access_source="event"`, no package, no credit,
   no Stripe. It never consumes the school's welcome free lesson. The student
   may release the seat any time before the event starts (nothing to refund
   or burn, so the notice period does not apply). The account requirement is
   the same as for lessons: the public board → register → auto-booking
   funnel is reused unchanged.
5. **Paid event = its own ticket, and only that.** `credit_cost` 1 and a
   `Package` with `event=<course>`: a drop-in package worth one credit at
   the school's price, named after the event, hidden from the storefront
   (drop-ins are) and from the school's package manager (edited on the
   event). `_package_event_matches` in `bookings/services.py` makes it the
   only package that covers the event and the only event it covers; ordinary
   packages, subscriptions, generic drop-ins and the welcome lesson never
   apply. Purchase is the existing drop-in checkout: Stripe → webhook →
   credit → automatic booking, platform fee included. The school form shows
   "free" or a price in euro — credits never appear.
6. **The platform never moves money or credits for a ticket after the
   purchase.** No online cancellation for a paid seat (`cancel_booking`
   raises `contact_school`; the UI shows "contact the school"). When the
   school cancels the event, seats are cancelled and emailed, credits are
   given back where there are credits, but a ticket is not refunded
   (`refund_bookings` skips `package__event`), and the email's refund line
   says to contact the school. The Stripe refund button on the school's
   payments page stays as it is. Desk enrolment (`staff_enrol`) on any event
   is free of charge: whoever is at the desk decides, and the school records
   the payment as it likes.
7. **Nothing else changes**: required documents (per student, per school),
   minimum notice, closures, capacity, the HQ email editor.

## 3. Data model

`catalog.Course` (migration `catalog/0019_special_events`):

| Field | Meaning |
|---|---|
| `is_special_event` | the flag; `lesson_type` is NULL on events |
| `event_status` | `draft → pending → approved / rejected`, `approved → suspended`, any → `cancelled`; blank on ordinary courses |
| `event_submitted_at`, `event_reviewed_at`, `event_reviewed_by`, `event_review_note` | the workflow trail; the note is HQ's reason on reject / suspend, shown to the school |
| `event_changed_at` | set by a student-visible edit after approval, cleared by HQ "reviewed" / approve / suspend |
| `video_url` | the event's preview video (single language) |
| `credit_cost` | 0 free, 1 paid (validated by `catalog/events.py`, not by the course serializer) |

`catalog.Package.event` — one-to-one to the course: the ticket.
`bookings.Booking.AccessSource.EVENT` (`"event"`) — a seat that cost nothing.

## 4. Code map

- `backend/catalog/events.py` — the workflow (`create_event`, `update_event`,
  `submit_event`, `approve_event`, `reject_event`, `suspend_event`,
  `mark_event_reviewed`, `cancel_event`), lesson and ticket sync, the
  emails to HQ and to the school, `event_payload` (one JSON shape).
- `backend/catalog/event_views.py` — `/api/school/events/…` and
  `/api/hq/events/…` (routes in `config/api_school.py`, `config/api_hq.py`).
- `backend/bookings/services.py` — `is_special_event`, `is_event_ticket`,
  `_credit_cost`, `_package_event_matches`, the free-event branch of
  `book_lesson`, `cancel_booking`, `refund_bookings`, `staff_enrol`,
  `_refund_line`, `notify_event_updated`.
- `backend/core/section_guard.py` — `events` section (school matrix) and
  `events` key (HQ matrix); seeds in `schools/0010`, `accounts/0011`.
- `backend/notifications/brand_templates.py` — `hq.event_submitted`,
  `school.event_approved` / `event_rejected` / `event_suspended`,
  `student.event_updated` (seed `notifications/0014`).
- Frontend: `school/events` (list, new, edit) on
  `components/school/EventForm.tsx` (built from `ScheduleFields` in
  `standalone` mode, `NotesFields`, `EmailInfoField`, `ImageUploadInput`,
  `VideoPreviewPlayer`); `hq/events` queue; `student/book` (event badge,
  free / price, ticket purchase, no-refund notice); `student/bookings`
  ("contact the school" instead of the cancel button on a ticket).
- Tests: `bookings/tests/test_special_events.py`,
  `catalog/tests/test_special_events_api.py`.

## 5. Permissions

School matrix section `events` (sidebar "Special events", `/api/school/events/`);
seeded on `owner` and `admin`. HQ matrix key `events` (`/hq/events`,
`/api/hq/events/`); seeded on `owner`, `super_admin`, `operations`. HQ
reviewers of a submission are the active HQ members whose role holds the key.

## 6. Not in this version

- Automatic money refunds on cancellation (decision 6).
- A separate euro price for an event paid with credits: an event is either
  free or ticket-only.
- Recurring events (an event is one date; make another one).
