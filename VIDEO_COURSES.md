# Video Courses — courses, chapters, lessons (design draft)

**Status:** design draft — **nothing is built**. Brainstorm with Carlo on
03/10/2026; the video hosting is still to be designed with Hakan (§12.1)
and a few facts about the current LearnDash site are to be confirmed
(§12.2).
**Scope:** the structure of the video courses that will replace the external
LearnDash site: what a course is made of, who can open what, how progress is
counted, which labels and emails exist. The purchase flow is only outlined
(§9).
**How to read it:** every rule carries a tag.

- **[decided]** — agreed with Carlo on 03/10/2026.
- **[proposed]** — suggested during the brainstorm, not confirmed yet.
- **[open]** — needs an answer; all collected in §12.

---

## 1. Why

Video courses are delivered today on an external LearnDash (WordPress) site,
outside the platform. The original spec wanted them inside (§9.7 "Video
Courses", §17.4 "Student Video Courses"); CLAUDE.md §10 lists the student
video showcase as a conscious gap. This document designs how to close it:
showcase, access, course authoring with video / text / images, drip, locks
and a progress percentage.

## 2. What exists today

| Piece | Where | Role for video courses |
|---|---|---|
| `LibraryContent` | `backend/library/models.py` | Flat list of single videos / PDFs for teachers (Metodo Library). Has `student_access`, `price`, `stripe_product_id`, never used on the student side. It stays the teachers' library: courses are a new layer, not an extension of it. |
| `VideoProgress` | same file | Seconds watched + `completed` per user, tied to a `LibraryContent`. Lessons need the same shape. |
| `Tutorial` | same file | Precedent for "one row, one language" instead of `title_<locale>` columns, and for a PDF kept in the private tree and streamed by a view. |
| Video helpers | `frontend/src/lib/video-embed.ts`, `components/ui/VideoPreviewPlayer.tsx` | A YouTube / Vimeo link becomes an iframe, a direct file a `<video>`. |
| Rich text editor | `frontend/src/components/ui/EmailRichEditor.tsx` (Lexical) | Base for the lesson text. |
| Storage | `backend/core/storage.py` (`save_public`, `save_private`, `private_accel_response`) | Public tree for images, private tree for attachments. |
| One-off purchase | `commerce/services.py` `activate_shop_order_payment`, `commerce/webhooks.py` | Pattern for a Stripe sale that is not a package. |
| Ledger | `Transaction.Type.VIDEO` | Exists, unused. |
| Labels | `Package.is_popular`; `ShopProduct.badges` (free text, max 4) | The two label styles to mirror (§7). |
| Discount codes | `DiscountCode.ValidFor` | One more value when courses are sold. |
| Emails | `notifications/brand_templates.py`, `send_transactional_email_task`, `emails.is_enabled` | A new template follows the same path. |
| Sidebar switch | `_PlatformToggleView` (`student_tutorials_enabled`) | Same switch to keep the student page hidden until launch. |

## 3. Decisions taken (Carlo, 03/10/2026)

1. **Three levels:** video course → chapters → lessons, several lessons per
   chapter.
2. **A chapter has its own photo and description.**
3. **One course, one language.** No per-language fields on courses, chapters
   or lessons; the showcase has a language filter.
4. **Labels on courses, three kinds:** a "Popular" flag as on packages,
   automatic labels, free-text labels as in the shop.
5. **No email when a new course is launched.** The launch is signalled by
   the "New" label in the showcase.
6. **One email only: new lessons added to a course**, as a service email to
   the students enrolled in it.
7. **Enrolled = has bought the course.**
8. **Rules of that email:** only lessons added after the course was
   published; lessons published together share one email; written in the
   student's language; nothing to a student whose access has expired.
9. **Access to a course lasts a set time**, in months or years.
10. **"Included in a package" is an access route**, beside the purchase.
11. **HQ can grant a course by hand.**
12. **Expiry reminder:** an email a few days before access to a course
    expires, as for packages.
13. **The packages that include a course are chosen one by one.**
14. **For an included course, the new-lessons email goes only to who
    pressed "Start"**, not to every holder of the package.
15. **The "Mark as complete" button is enough** to complete a lesson and
    unlock the next one.
16. **Drip and order lock are both wanted.**
17. **Schools do not see their students' progress** in video courses.
18. **HQ picks the included packages** in the course editor, among the
    packages of every school, with a filter by school.
19. **A package created later does not include the course** until someone
    adds it to the list.
20. **Only HQ creates video courses**, as with the Shop.
21. **HQ collects the sale and the school the student is linked to earns a
    commission**, as with the Shop.
22. **The course commission has its own percentage**, separate from the
    shop's.
23. **Where the school sees its commissions is deferred**; it will be the
    same place for courses and shop.
24. **Shop defect, fixed separately (PR #303):** online orders of HQ
    products recorded no school commission (§9).
25. **Video courses are for the students of the schools.** A dedicated
    section for teachers may follow later; it is not designed here.
26. **The videos leave Vimeo**, where they are today; the new hosting is
    run by us, with Hakan (§12.1).
27. **Courses are sold today on the LearnDash site** (to confirm), so the
    purchase belongs to phase 1.
28. **Migration is small:** about a hundred enrolments (to confirm).

Wanted from the start, details below: showcase, access control, authoring
with video, text and images, drip, locks, progress percentage.

## 4. Structure

```
Video course      cover, description, language, level, price, labels
└── Chapter       photo, title, description          ← drip is set here
    └── Lesson    video, text with images, files     ← order lock applies here
```

### 4.1 Video course

| Field | Notes | Tag |
|---|---|---|
| Title | In the course language. | decided |
| Language | One of the five UI locales (`core/locales.py`). Drives the showcase filter. | decided |
| Short description | One or two lines, shown on the showcase card. | proposed |
| Long description | Rich text, shown on the course page. | proposed |
| Cover image | Shown on the card and on the course page; fallback for chapters without a photo. | proposed |
| Trailer | Optional video link, visible before buying. | proposed |
| Level | All / beginner / intermediate / advanced. | proposed |
| Lesson type | Optional link to an HQ lesson type, for a showcase filter. | proposed |
| Price | Euro, `Decimal`. Zero = free course. | proposed |
| "Popular" | Manual flag (§7). | decided |
| Free labels | Up to 4, free text (§7). | decided |
| Lessons in order | On / off switch for the order lock (§5.2). | proposed |
| Access duration | A number of months or years from enrolment, set per course — number + unit, calendar-aware like package validity. Empty = forever (proposed). | decided |
| Included with packages | The packages that open the course without buying it, picked one by one (§5.1). | decided |
| Owner | HQ only: there are no school-owned courses. | decided |
| State | Draft / published / archived (§4.5). | proposed |

### 4.2 Chapter

| Field | Notes | Tag |
|---|---|---|
| Title | | decided |
| Description | Short plain text. Rich text stays on lessons. | decided (plain text: proposed) |
| Photo | Optional; the course cover is used when missing. | decided |
| Release | Immediately, N days after enrolment, or on a date (§5.3). | proposed |

A chapter has no content and no state of its own: it is a container. A
chapter with no published lesson is not shown to students.

### 4.3 Lesson

| Field | Notes | Tag |
|---|---|---|
| Title | | decided |
| Video | A link or an uploaded video; the hosting is to be designed with Hakan (§12.1). A lesson may have no video. | proposed |
| Duration | Shown on the lesson row and summed per chapter and course. | proposed |
| Text | Rich text with images, below the video. | decided (video + text + images) |
| Attachments | PDFs, downloadable by who can open the lesson. | proposed |
| Free preview | The lesson can be opened without being enrolled. | proposed |
| State | Draft / published (§4.5). | proposed |

A lesson is "video on top, text with images, attachments": no free block
page-builder. **[proposed]** — it covers the LearnDash use and costs a
fraction.

### 4.4 Order

Chapters inside a course and lessons inside a chapter are reordered by
drag. The "course order" used by locks, "Continue" and previous / next is
chapter order first, lesson order second. **[proposed]**

### 4.5 Draft and published

- A **course** is draft, published or archived. Archived = out of the
  showcase, still open to who is enrolled. **[proposed]**
- A **lesson** is draft or published. A draft lesson is invisible to
  students and does not count in the percentage. **[proposed]**
- Publishing a course needs at least one published lesson. **[proposed]**
- A course, chapter or lesson that already has enrolments or progress is
  never deleted, only archived / unpublished, so purchases and history
  survive. **[proposed]**
- The moment a course is published matters: lessons published **before**
  it are never announced by email, lessons published **after** it are (§8).

### 4.6 Names

`catalog.Course` and `catalog.Lesson` already exist and mean the dance
class and its dated occurrence. The new models, routes and UI strings must
not reuse those words: `VideoCourse`, `VideoChapter`, `VideoLesson`;
routes under `video-courses`; "Video courses" / "Videocorsi" in the UI.
**[proposed]**

## 5. Access

### 5.1 Enrolment

One record per student and course is the only gate: enrolled or not.

- **Purchase** creates the enrolment, valid for the course's access
  duration. **[decided]**
- **Free course** (price zero): a "Start" button creates it, no payment.
  **[proposed]**
- **Manual grant** by HQ (gift, staff, students migrated from LearnDash).
  **[decided]** It takes the course's duration unless HQ sets another
  expiry; HQ can revoke it. **[proposed]**
- **Included in a package.** **[decided]** A student holding a qualifying
  package sees the course as "Included in your package" and presses
  "Start", which creates the enrolment. It stays valid while she holds a
  qualifying package and closes when the last one lapses; a new package
  reopens it. While it is open through a package there is no buy button;
  once closed she can buy the course. **[proposed]** The qualifying
  packages are picked one by one by HQ in the course editor, among the
  packages of every school (with a filter by school) and HQ's own; a
  package created later is not included until it is added. **[decided]**
  A package counts while it is within its dates, even with its credits
  used up. **[proposed]**

**When access ends** (duration reached, or no qualifying package left):
the course closes, progress is kept, and buying it again reopens it where
she left. No new-lessons email goes to her (§8). **[proposed]**

**Expiry reminder.** **[decided]** An email a few days before a dated
expiry (7 days **[proposed]**), in the style of `student.package_expiring`.
Access that comes from a package has no reminder of its own: the package's
expiry email already covers it. **[proposed]**

A course purchase is a sale in money, like the shop. It never touches
credits or packages, and the included route only reads whether a package is
valid without deducting anything, so the single-engine rule (CLAUDE.md
§4.1) holds.

### 5.2 Order lock (per lesson)

Wanted **[decided]**; the rule is **[proposed]**. With "Lessons in order"
on, a lesson opens when every published lesson before it in course order is
completed. A lesson already completed stays open even if a new lesson is
later inserted before it. With the switch off, every released lesson is
open. A lesson is completed with the "Mark as complete" button (§6).

### 5.3 Drip (per chapter)

Wanted **[decided]**; the rule is **[proposed]**.
A chapter opens immediately, or N days after the student's
enrolment, or on a fixed date — at most one of the two. Until then its
card (photo, title, description, lesson titles) is visible with
"Available on dd-mm-yyyy", and its lessons cannot be opened.

A lesson is open only when **both** rules allow it: its chapter is released
and the order lock is satisfied.

### 5.4 Free preview

**[proposed]** A lesson flagged as free preview can be opened by any
logged-in student who is not enrolled. For an enrolled student it is an
ordinary lesson.

### 5.5 Enforced on the server

The API never returns the video link, text or attachments of a lesson the
student cannot open; hiding it in the UI is not enough. Attachments live in
the private tree and are served by a view that checks access (opened with
`?token=`, CLAUDE.md §3.4). How hard it is to pass a video on to someone
else depends on the hosting choice (§12).

## 6. Progress

- **Per lesson:** completed or not, plus the second reached in the video
  (to resume). **[proposed]**
- **Completing:** the "Mark as complete" button completes a lesson, and
  that is enough to unlock the next one. **[decided]** A video lesson may
  also complete by itself at about 90% watched, where the video host
  allows it (§12). **[proposed]**
- **Course percentage** = completed published lessons ÷ published lessons.
  Each chapter shows its own partial. Computed, not stored. **[decided:
  percentage; formula proposed]**
- **New lessons lower the percentage** of who had finished: "Completed"
  goes back to "In progress". Intended — it matches the email in §8.
- **Continue:** opens the first open lesson not yet completed.
  **[proposed]**
- **HQ view:** per course, number enrolled and average percentage; per
  student, percentage and last activity. **[proposed]**
- **Schools** have no view of their students' progress in video courses.
  **[decided]**

## 7. Labels

| Kind | Label | Rule | Tag |
|---|---|---|---|
| Manual | Popular | Flag on the course, as `Package.is_popular`. | decided |
| Free text | up to 4 | Written by HQ in the course language, shown on the cover, as `ShopProduct.badges`. | decided |
| Automatic | New | Course published in the last 30 days. | decided (30 days: proposed) |
| Automatic | Free | Price zero. | proposed |
| Automatic | In progress N% / Completed | For the enrolled student. | proposed |
| Automatic | Language, level | Always. | proposed |
| Automatic | Included in your package | The student holds a qualifying package (§5.1). | decided |

Automatic labels are UI strings (next-intl, five locales). Free labels are
not translated: the course has one language.

## 8. Email: new lessons

One of the two emails of this feature; the other is the expiry reminder
(§5.1). **[decided]** unless tagged.

- **When:** a lesson is published on a course that is already published.
  Building a course before its launch sends nothing.
- **Grouping:** lessons published in the same sitting share one email. The
  email leaves after a quiet period from the last publication (60 minutes
  **[proposed]**) and lists every lesson not announced yet. A lesson is
  announced once.
- **To whom:** students enrolled in that course whose access is valid. For
  a course opened through a package that means who pressed "Start", not
  every holder of the package.
- **Language:** the template follows the student's language; course and
  lesson titles stay as written.
- **Silent publish:** a "Notify enrolled students" tick, on by default,
  when publishing a lesson on a live course — for a split or a re-upload
  that is not news. **[proposed]**
- **Drip:** a student who has not reached that chapter yet still gets the
  email; the text says the lesson was added to her course. **[proposed]**
- **Plumbing:** a template in `notifications/brand_templates.py` (five
  locales), sent through `send_transactional_email_task` after commit, with
  its HQ on/off switch like every other email.

No launch email, so no marketing consent or unsubscribe is needed: this is
a service message about something the student bought.

## 9. Purchase and money

**[decided]** As with the Shop: only HQ sells courses, HQ collects the
sale, and the school the student is linked to earns a commission.

What that means in practice, read from the shop code. **[proposed]**

- **The payment lands on the platform's Stripe account**, with no Connect
  transfer — as an online order of an HQ shop product does today.
- **The commission follows the rule of HQ's manual shop sales**
  (`commerce/shop_admin_views.py`): the school is the student's default
  school (`Student.school`) at the moment of purchase. The rate is a
  percentage of its own for video courses, separate from
  `shop_commission_percentage` **[decided]** — one per school, set by HQ
  beside the shop one **[proposed]**. School and rate are stamped on the
  sale, so a later change does not move it. A student with no school
  generates no commission.
- **The commission is a ledger figure**, as in the shop: Stripe transfers
  nothing to the school at purchase.
- **The online shop follows the same rule since PR #303** (04/10/2026).
  Before it, an online order of an HQ product recorded no school and no
  commission, because the sale line took its school from
  `ShopOrder.school`, which is empty for an HQ cart. The sale line now
  takes the student's default school and its shop percentage;
  `ShopOrder.school` is untouched, since it drives the Stripe transfer.
  Past online orders were not recalculated (Carlo: the simplest option).
  The same PR made the HQ report's Schools tab read the commission from
  the school on the sale line.
- **Where the school sees its commissions is deferred** **[decided]**: one
  place for courses and shop, designed later.

Mechanics, when built: Stripe Checkout one-off payment mirroring the shop
order path — its own `kind` in the payment metadata, one activation
function reached by both the webhook and the `verify-session` fallback,
idempotent, creating the enrolment and the sale record. Discount codes get
a "video courses" scope. Where the sale is recorded is to settle when
building: a `Transaction` of type `video` needs a school and its
`platform_fee` / `school_amount` split means the opposite of a commission,
so a sales line of its own in the style of `ShopSale` may fit better.
Either way, school pages must show it as a commission, never as school
revenue.

## 10. Screens

**HQ — `/hq/video-courses`** **[proposed]**
- List: cover, title, language, state, price, enrolled. Multi-select
  filters with a label each (language, state, level).
- Course editor: details, labels and included packages (picked one by
  one, filterable by school); structure (chapters with photo and
  description, lessons nested, drag to reorder); lesson editor (video link
  with preview, rich text, attachments, free preview, publish with the
  notify tick).
- Enrolled: list with percentage and last activity; manual grant.
- Sales: course, student, school, amount, commission.
- A switch to show / hide the student page until launch.

**Student — `/student/video-courses`** **[proposed]**
- Showcase: "Continue" row for courses in progress, then the catalogue as
  cards (cover, labels, title, short description, lessons and duration,
  price or percentage). Multi-select filters: language (preset to the
  student's own), level, lesson type.
- Course page: cover or trailer, description, price and buy button — or
  progress bar and "Continue". Below, one card per chapter (photo, title,
  description, lessons, duration, partial percentage) that opens its
  lessons, each with its state: completed, open, free preview, locked with
  the reason ("Complete the previous lesson", "Available on dd-mm-yyyy").
- Lesson page: video, text, attachments, "Mark as complete", previous /
  next, course outline at the side.

Panel pages are Client Components behind the role guard (CLAUDE.md §3.1);
all requests go through `lib/api/client.ts`.

## 11. Proposed data model and touch points

All **[proposed]**; names per §4.6.

| Model | Holds |
|---|---|
| `VideoCourse` | title, language, short / long description, cover, trailer, level, lesson type, price, access duration (number + unit), included packages (many-to-many with `catalog.Package`), `is_popular`, `badges`, lessons-in-order switch, state, published at, sort order |
| `VideoChapter` | course, title, description, image, sort order, release after days / release on |
| `VideoLesson` | chapter, title, video link, duration, text, free preview, state, published at, notify flag, announced at, sort order |
| `VideoLessonAttachment` | lesson, private storage key, file name, size |
| `VideoCourseEnrollment` | user, course, source (purchase / free / manual / package / import), enrolled at, expires at, payment reference; unique per user and course |
| `VideoLessonProgress` | user, lesson, seconds reached, completed, completed at, last watched; unique per user and lesson |

- **Keyed on the user account**, as `VideoProgress` already is, not on the
  student profile: a later teachers' section then needs no data migration.

- **Backend:** a new app (`videocourses`) rather than growing `library`;
  access, progress and announcement rules in its `services.py`. Routes in
  `config/api_hq.py` and `config/api_student.py`. The HQ segment needs an
  entry in `HQ_SECTION_BY_SEGMENT` (`core/section_guard.py`) — under
  `library`, as tutorials are, unless HQ wants a separate permission.
- **Frontend:** `app/[locale]/hq/video-courses/`,
  `app/[locale]/student/video-courses/`; strings in all five
  `messages/<locale>.json`.
- **Tests:** lock, drip and expiry rules; percentage; the announcement
  (once, grouped, right recipients); purchase idempotency.

## 12. Open questions

### 12.1 Video hosting — to design with Hakan

**[decided]** The videos are on Vimeo today and are to leave it: the
hosting will be run by us, with Hakan. How is open.

**What the platform has today.** Media sits on the server's local disk in
two trees (`core/storage.py`); private files are streamed by nginx after a
permission check (X-Accel-Redirect); nginx caps an upload at 25 MB; nothing
transcodes video. `django-storages` / S3 is noted there as a later swap. A
lesson video is hundreds of MB, so course videos do not fit as things are.

**What any solution has to give the platform** (the brief for Hakan):

1. Upload from the HQ lesson editor of large files (a cap to agree, in the
   order of GB), sent straight to the storage rather than through Django.
2. Playback only for who can open the lesson: the API checks access (§5)
   and hands out a short-lived signed address or token.
3. Adaptive streaming — several qualities, not one big file — so a lesson
   starts quickly on a phone.
4. A player that reports position and end of the video, for resume and
   automatic completion (§6).
5. Duration and a poster image read from the file.
6. A predictable cost and a backup of the originals.

**Options.** **[proposed]**

| Option | What it is | For | Against |
|---|---|---|---|
| A. Files on our server | MP4 in the private tree, streamed by nginx. | Nothing new to buy. | Disk and bandwidth of the application server, one quality only, slow on phones; uploads need rework anyway. Not advised beyond a pilot. |
| B. Object storage + CDN on our cloud account | Files in object storage, a CDN in front with signed addresses, a transcoding step producing adaptive streams. | Stays inside infrastructure Hakan already runs; paid by use. | The most to build and maintain: transcoding pipeline, signed addresses, player. |
| C. A video streaming service other than Vimeo | Upload API, automatic transcoding, token-protected playback, CDN included. | The least to build; covers the six points as delivered. | An external supplier again, with a monthly bill (small at this size; prices to check). |

**Recommendation.** **[proposed]** B or C, not A. And keep the two moves
apart: phase 1 can go live with the current Vimeo links, which the player
already supports, so that leaving LearnDash does not wait for the new
hosting. The lesson's video is then "a link or an uploaded video"; videos
move off Vimeo lesson by lesson once the hosting is ready, and the Vimeo
plan is closed at the end.

No option stops an enrolled student from recording her screen. Short-lived
signed addresses stop a link from being passed around, which is the
realistic goal.

### 12.2 To confirm

1. **LearnDash sells the courses** — Carlo's understanding (a WordPress
   plugin with a shop). To check with whoever runs the site: which payment
   system it uses, and whether it exports the buyers (email, course, date,
   expiry).
2. **Migration size:** "about a hundred" — read as enrolments. How many
   courses and how many videos?
3. **Progress on LearnDash:** proposed not to import it; students restart
   from the lesson they choose.

## 13. Phases

1. **Replace LearnDash:** structure and HQ authoring, student showcase and
   player, enrolment (purchase with the school commission, free, manual,
   included in a package), access duration with its reminder, order lock,
   drip, progress percentage, labels, attachments, new-lessons email,
   import of existing enrolments. It can be delivered in two steps: first
   authoring, showcase, player and manual grants, so HQ can load and test
   the courses; then purchase, emails and import, after which LearnDash is
   switched off.
2. **Own video hosting:** the solution chosen with Hakan (§12.1), upload
   from the lesson editor, videos moved off Vimeo. Discount codes for
   courses.
3. **Later:** public showcase outside the login, course progress in the HQ
   reports, notification centre entry, the school's view of its
   commissions (courses and shop together), a dedicated section for
   teachers.

**Not planned:** launch email for a new course (decided), free block
page-builder, quizzes, certificates (the platform has no PDF engine today),
comments under lessons, push notifications.
