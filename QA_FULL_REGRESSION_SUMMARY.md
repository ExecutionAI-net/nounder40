# Full Platform QA Regression — Pre-Launch Summary

**Date:** 2026-09-06/07
**Environment:** live dev deployment `https://dev.danzaclassicanounder40.com` (`develop` branch, real Docker/EC2 stack, real Stripe test-mode keys, real transactional-email sending)
**Method:** 4 autonomous QA agents ran in parallel, one per panel (HQ, School, Teacher, Student), each covering every page × every sub-role × every function for their panel, black-box against the live deployment, cross-verifying every UI observation against direct backend `curl`+JWT calls. Full detail, repro steps and evidence for every item below live in the four linked reports:

- [`QA_FULL_REGRESSION_HQ.md`](QA_FULL_REGRESSION_HQ.md)
- [`QA_FULL_REGRESSION_SCHOOL.md`](QA_FULL_REGRESSION_SCHOOL.md)
- [`QA_FULL_REGRESSION_TEACHER.md`](QA_FULL_REGRESSION_TEACHER.md)
- [`QA_FULL_REGRESSION_STUDENT.md`](QA_FULL_REGRESSION_STUDENT.md)

This summary is the prioritized, cross-panel entry point. Read it first; drill into the linked reports for exact repro steps, request/response evidence, and source file/line references.

---

## Verdict: not launch-ready as-is

Two independent, unrelated classes of bug would let a real customer pay real money and receive nothing, with no recovery path (Student panel, purchase pipeline). A separate, unrelated privilege-escalation path lets a low-trust HQ account mint a brand-new Owner account (HQ panel). A separate, unrelated attendance-marking bug silently inverts what a very plainly-labeled UI toggle does, corrupting attendance statistics and teacher compensation (Teacher panel). None of these four are related to each other or share a root cause — they were found independently by four different agents testing four different panels, which is itself a signal that this pass was worth doing before launch, not after.

Everything else — the core credit ledger, cancellation-policy math, no-show handling, role isolation, and the systemic i18n raw-key regression from the last two QA rounds — held up under heavy, adversarial re-testing and is in genuinely good shape.

---

## Critical — fix before launch

| # | Panel | Finding | Impact |
|---|---|---|---|
| C-1 | HQ | Invite→approve flow (`PendingInvitationViewSet`) has no owner-hierarchy check, unlike the direct-edit path. Any HQ role/custom-role holding only the `team` permission can invite and approve a brand-new **Owner** account. Live-reproduced, fully cleaned up. | Full HQ privilege escalation, same severity class as the 4 Critical bugs the prior QA round already fixed on the direct-edit path — this is a *different* code path the earlier fix missed. |
| C-2 | Teacher | The "Counts as absence" (`burns_credit`) toggle on Attendance Statuses does the **opposite** of its own label: `burns_credit=true` → student recorded **PRESENT**; `burns_credit=false` → **NO_SHOW**. The QA-seeded "Assente"/"Absent" status is configured exactly the way the UI's own instructions say to, and is misfiled as present. | Corrupts no-show rate, attendance rate, "Students Followed," and **teacher compensation bonus eligibility** (an absent student counts toward the bonus headcount); the no-show email never fires for a student marked this way. Any school that configures a status by reading the app's own UI copy will get this wrong. |
| C-3 | Teacher | Teacher Compensation page (`TeacherCompensationOverviewView`, what `/teacher/compensation` actually calls) has **no exclusion for future-dated lessons at all** — the fix applied elsewhere (`teachers/services.py::monthly_compensation`, PR #53) was never ported to this sibling endpoint. Even the "fixed" endpoint still leaks lessons scheduled *later the same day* because it compares `date`, not full `datetime`. | Direct financial exposure: a school viewing a teacher's compensation mid-month sees (and could pay) amounts for lessons that haven't happened, may be cancelled, or haven't even had a student booked. Live-reproduced: page showed €100 total when only €60 corresponded to lessons that had actually occurred. |
| C-4 | Teacher | Performance "Lessons Taught" (`date__lt=today`, strictly before today) and Compensation (pays for anything up to and including today) use different day boundaries and visibly disagree for the same teacher, same day. Related to C-3 but a distinct code path/bug. | Two pages a school/teacher both trust show contradictory numbers on the same day — undermines trust in both. |
| C-5 | Student | **Shop orders**: Stripe charges the card successfully (`payment_status: "paid"`, confirmed via the backend's own verify-session endpoint), but `ShopOrder.status` stays `"pending"` forever. No webhook processes it, and — unlike packages — **there is no fallback at all** for this product type. | A paying customer is charged and receives nothing: no order confirmation, no shipment, no record in HQ's shop-sales ledger. No self-service or automatic recovery exists. |
| C-6 | Student | **Subscription (recurring) packages**: Stripe creates a real subscription and charges the first period successfully, but the app's only activation fallback crashes with a 100%-reproducible `AttributeError` (`backend/commerce/stripe_views.py:274`, `sub.get("current_period_end")` on a Subscription object). Root cause shared with C-5: **the Stripe webhook does not appear to be processed on this dev environment at all** — a risk the team's own code comments already anticipated ("mai consegnato se l'endpoint non è configurato per l'ambiente, es. Sandbox") but never verified or built a working fallback for. | A paying customer is charged a recurring amount (€49/mo in the live test) and receives nothing, with zero record anywhere in the app. **A live, uncancelled test-mode Stripe Subscription now exists and needs manual cancellation — see Action Items.** |

**Note on C-5/C-6's root cause (C-3 in the Student report):** one-time Package purchases currently "work" *only* because of a client-side fallback (`GET /api/stripe/verify-session/`) that happens to run on return from Stripe and happens to cover that one product type. If that fallback ever fails to fire (a closed tab, a crashed browser, a slow redirect), a one-time package purchase would be exposed to the exact same failure mode as C-5/C-6. **Fixing the underlying webhook delivery (or adding equivalent fallbacks everywhere) is the single highest-priority item in this entire report.**

---

## High — fix before launch, or ship with a documented, accepted risk

| # | Panel | Finding | Impact |
|---|---|---|---|
| H-1 | HQ | `GET /api/hq/team/` and `GET /api/hq/permissions/` are readable by **every** HQ role regardless of permissions — the section-guard middleware assumes `hq_views.py` covers this, but that code only gates writes, not reads. | Leaks real staff names, personal emails, and one phone number, plus the full permission matrix, to the lowest-trust HQ role (`support`). Not an escalation by itself, but a real PII/internal-data leak, and it's exercised by ordinary Dashboard page loads, not just a hidden route. |
| H-2 | HQ | The entire `/hq/translations` page (manual edit, "AI Translate," "Deploy") writes to a database table that is **never read at runtime** — next-intl only reads the git-committed `frontend/messages/*.json`. Both action buttons are also broken outright (`Deploy` → leftover Vercel hook, 500; `AI Translate` → missing API key, 500). | The page looks like a working, non-technical content-management tool but nothing done there can ever reach a real user. This also explains why the systemic i18n bug looked partially regressed when checked through this admin view — the real, shipped files are fine. |
| H-3 | Teacher | Content-Security-Policy has no `media-src` directive (`frontend/next.config.ts`) — `default-src 'self'` blocks **any** externally-hosted video/audio, not just the known fake `example.test` seed URLs. Fails completely silently (native player sits at 0:00, no error). | The Metodo Library's videos cannot play from any realistic hosting location (S3/CDN/Vimeo/etc.) once real content replaces the seed data, with zero visible error for the user or the school. |
| H-4 | Teacher | Teacher Profile's "Email" field updates `Teacher.email` (display) but never `User.email` (login credential), with no indication of the distinction and no uniqueness check. | A teacher who updates their email via the obviously-labeled "Email" field on their own Profile page will reasonably try to log in with it next time and get a confusing "no account found" — while their old, possibly-abandoned email remains their real login. |
| H-5 | School | `Course.credit_cost` half-credit values (e.g. `1.5`) are still silently truncated to an integer **server-side** (`backend/catalog/course_views.py:355,527`, `int(...)`) even though the prior fix corrected the *frontend* form. The form now shows `1.5` with no rounding indication, but the persisted value is `1`. | More dangerous than the originally-reported bug: a school owner sees exactly what they typed, gets no error, and only discovers the discrepancy when students are charged the wrong number of credits per lesson. |
| H-6 | School | Creating a **new** "all lesson types" package, or **Duplicating** any existing one, is now unconditionally rejected (`400 Pick at least one lesson type`) — the prior fix (`was_already_empty` check) only covers in-place edits of a package that predates the validation. | A school can never again create (or duplicate) a package meant to work for every lesson type; only pre-existing ones, edited in place, still work. |
| H-7 | School | Any authenticated school member — including `staff`, who holds no `settings` permission — can rewrite the school's `name`/`email`/`phone`/`address`/`vat_number`/`website` via `PATCH /api/school/profile/`. The prior Critical fix locked down financial/HQ-only fields but the identity-field set has no permission check at all (the `profile` URL segment is deliberately exempt from the section-guard middleware as "infrastructure"). | The lowest-trust school role can silently redirect the school's contact email, rename the business, or alter its legal address, with zero audit trail visible to the owner. Companion read-side leak: `GET` on the same endpoint also exposes `stripe_account_id`/`platform_fee_percentage` to `staff` (see Low L-9). |
| H-8 | Student | The `documentsRequired` booking-blocked error message ships with a permanently empty interpolation (`t('documentsRequired', { documents: '' })`, both call sites) — renders literally as *"Valid documents are needed to book: . Upload them from your profile."* | Cosmetic but visible to every student ever blocked by missing documents — a real, live gating path (verified working in both directions) with a broken message. |

---

## Medium

| # | Panel | Finding |
|---|---|---|
| M-1 | HQ | No server-side validation on `Package.credits`/`Package.price` — negative values accepted and persisted (`201`). |
| M-2 | HQ | No server-side validation on `School.platform_fee_percentage`/`shop_commission_percentage` — e.g. `150%` accepted and persisted. |
| M-3 | School | `POST /api/school/credits/grant/` crashes with an unhandled `500` for amounts ≥ 100,000 (no bounds check against the underlying `DecimalField`'s max). Boundary itself (`99999`) works correctly; no data corruption on the crash (clean rollback). |
| M-4 | School | Packages accept negative/zero credits and negative price with no validation (same class as M-1, independently found). |
| M-5 | School | Discount codes accept negative and >100% percentage values with no range validation; uniqueness constraint itself works correctly. |
| M-6 | School | School Team invite emails are **always** sent in English regardless of `School.language` or the inviting admin's locale — unlike Teacher invites, which correctly thread a `locale` parameter through. The invite link itself also has no locale prefix. |
| M-7 | School + Student | **Cross-confirmed by two independent agents:** once a `user_locale`/`NEXT_LOCALE` cookie is set (e.g. by using the language switcher once), every subsequent direct navigation to a URL with a *different*, explicit locale segment silently redirects back to the cookie's locale — `frontend/src/middleware.ts:81-87` prioritizes the stored preference over an explicit URL locale. Affects any bookmarked/shared link in a specific language, and caused several false leads during this very QA round before being correctly isolated as a real bug. |
| M-8 | Student | `CLAUDE.md`/`DROP_IN_BOOKING.md` describe drop-in (single-lesson) booking as an unimplemented proposal. It is actually fully implemented and live (`StudentLessonPurchaseOptionsView`, `buyDropIn()`, a real Stripe Checkout path) — QA Test School simply has no course flagged `is_drop_in: true` by default, which is why it wasn't visible in normal browsing. Documentation-accuracy issue, not a functional bug — but it means this exact purchase path was not exercised end-to-end this round (see Student report §7), and a future QA pass that treats it as out-of-scope would keep skipping a real, live checkout flow that shares C-5/C-6's fulfillment-pipeline risk. |

---

## Low / cosmetic / documentation

Full detail in the per-panel reports; summarized here for completeness.

- **HQ L-1**: custom-role dashboard badge shows the raw role key (`QA-CUSTOM-TEST`) instead of its human label.
- **HQ L-2**: HQ team-invite emails are hardcoded to English (no "HQ language" concept exists to localize against — a conscious-decision item, not clearly a bug).
- **HQ L-3**: login page's email placeholder is hardcoded Italian (`nome@dominio.it`) regardless of locale — affects every role's first touchpoint.
- **Teacher**: attendance-status buttons become invisible (white-on-white) when the status has no color set — true of both QA-seeded statuses; breakdown section on Performance is permanently titled "No Data" even when showing real data; Attendance page has no way to reach past/unmarked lessons (they simply disappear from the page); several Compensation-page strings are hardcoded English in every locale ("Pending," "No plan," "{n} to bonus," etc.); "Students Followed" KPI counts attendance rows, not distinct students (will overcount for any teacher with repeat students — the entire premise of a dance school); Library items with all-blank titles render with an empty title line; no password-change UI anywhere in the Teacher panel (may be intentional).
- **School L-1** (companion to H-7): `GET /api/school/profile/` exposes `stripe_account_id`/`platform_fee_percentage` to every member including `staff`. **School L-2**: Package "Duplicate" swallows a real validation error into a generic "Something went wrong" (New Package shows the specific message correctly). **School L-3**: Room `capacity` accepts negative numbers.
- **Student**: locale-cookie override is also documented here (see M-7); Danza Clásica Barcelona's package catalog still has "(copy)"/"(copy) (copy)" duplicates (known data-hygiene issue, not re-reported as new); one browser-autofill artifact during registration testing traced to the shared-browser test setup, not an app bug.

---

## Re-verified from prior QA rounds — confirmed still fixed, no regression

All four agents independently re-tested the previously-reported Critical/High bugs from `QA_TEST_RESULTS.md` before extending coverage. Everything below held up:

- All 4 original HQ team/permission-escalation vectors (self→owner, self-permission-boost, delete-owner, self-delete) — fixed on every **direct** `PATCH`/`DELETE` path, for every built-in role (only the invite/approve path, C-1 above, was missed).
- Full 91-combination (7 roles × 13 segments) HQ backend read/write authorization matrix — zero mismatches.
- HQ/School route guards (direct-URL access to unauthorized pages) — correctly redirect.
- School `staff` can no longer rewrite financial/HQ-only profile fields (platform fee, Stripe fields, `active`) — only the *identity* fields were missed (H-7).
- School `admin` can no longer invite a new member directly as `owner` via `POST /team/` (H-2 from the prior round) — confirmed fixed on both the API and the invite form's Role dropdown.
- Course delete no longer leaves ghost lessons — confirmed via a real create→delete cycle with zero orphaned `course: null` lessons afterward; documented policy (past lessons untouched, future+unbooked hard-deleted, future+booked cancelled with refund) makes sense and was verified.
- Closure Days are now enforced in **both** course/lesson generation and booking-time.
- `PATCH /api/school/teachers/{id}/` returns a clean `400` on an email collision, not `500`.
- Teacher attendance timing boundary (future/later-today rejected, earlier-today accepted) — solid, matches its own test suite.
- Teacher Compensation table headers (Month/Course/Plan/Students/Base Fee) are distinct and correctly localized in all 5 languages; the `lessonsTeaught` typo now renders "Lessons Taught" everywhere.
- No-show rate / attendance rate render as `%`, not raw numbers.
- Teacher Inbox "New Message" works end-to-end for both `school_teacher` and `teacher_support` channels, cross-verified from the receiving side in both cases.
- Student booking calendar correctly follows the active locale in en/it/de (previously stuck in Turkish); "N spots left" now renders the actual number in all locales checked.
- Stripe checkout errors now show a specific, translated message instead of a generic "API error 400" (verified by actually forcing the scenario, not just reading the code).
- The systemic i18n "raw key" regression (`Label X`, `Kpi X`, `Tab X`, etc.) from the last two QA rounds is confirmed fixed in every locale file, on every page all four agents visited — zero new raw-key matches found anywhere in this pass, across all four panels.
- CLAUDE.md's cancellation-policy domain rule (§4.4) — refund above the threshold, burn below it, no-show always burns — verified exactly correct via real UI bookings and cancellations, both sides of the threshold, plus a real no-show. This is the platform's most safety-critical financial logic and it is solid.
- Documents-required-before-booking gating works correctly in both directions (on and off).
- Role isolation (Teacher/Student tokens against `/api/hq/*` and `/api/school/*`) — clean `403` everywhere, on every panel, checked independently by all four agents.

---

## Methodology notes

**Shared-browser-session hazard, confirmed real, not hypothetical.** All four agents used one shared browser instance (tabs share `localStorage`/cookies per origin, and this app's JWT lives in `localStorage`). Every agent reported their session being silently swapped by another agent's login, multiple times, mid-test. All four followed the same mitigation: re-inject a freshly-obtained JWT immediately before every UI action, and cross-verify every surprising result via an independent `curl`+JWT call before recording it as a bug. Every finding in this summary was confirmed this way — none rest solely on a browser observation that could have been contaminated. One genuine, reproducible product bug (M-7, the locale-cookie override) was itself discovered *because of* this hazard (a stray cookie from another agent's session caused a suspicious redirect that turned out to be a real bug, not an artifact) — but was independently confirmed by two agents in isolation before being trusted.

**Shared QA fixtures were mutated by concurrent agents.** Beyond the browser, all four agents shared one live "QA Test School" and its QA accounts on a real database. The Teacher agent specifically documented a lesson it created being altered mid-session by another agent's test, and QA StudentB gaining unexpected extra packages (including a 99999-credit test artifact from the School agent's boundary test for M-3). This did not invalidate any finding — every agent re-derived proof from freshly created, uniquely-named/dated fixtures when a finding's evidence needed to be unambiguous — but this environment is not presently safe for fully unattended parallel QA without per-agent data isolation, exactly as the prior QA round's methodology note already warned. **Recommendation for future rounds:** give each parallel agent its own school/tenant (trivial multi-tenant primitive this platform already has) instead of sharing one.

**Django Admin was deliberately excluded** from this pass on all four agents' instructions — testing it requires raw, unrestricted DB access, which is unsafe to exercise against a shared, real dev deployment. Consistent with the prior QA round's own methodology.

**Gmail verification is currently blocked.** The Gmail MCP connector returned "This connector requires additional permissions. The user needs to reconnect it" for every agent that tried it, and for the coordinator directly. See Action Items below — five real invite/welcome emails are waiting to be checked once this is reconnected.

---

## Action items for the coordinator / team (not yet done)

1. **Reconnect the Gmail MCP connector**, then check these five real inboxes (all under `h.timur+*@executionai.net`, which forward to `h.timur@executionai.net`) for correct delivery, subject, locale, and working links:
   - `h.timur+hqinvite@executionai.net` — HQ team invite, role `support`, expected English subject "✉️ You've been invited to the Danza Classica No Under 40 team," link `.../setup-account?uid=...&token=...`.
   - `h.timur+teacherinvite@executionai.net` — Teacher invite via School owner, `locale: "it"` explicitly requested — expect **Italian** content, link `.../it/setup-account?...`.
   - `h.timur+schoolinvite@executionai.net` — School Team invite, role `staff` — per M-6, expect **English** content regardless of the school's Italian setting (this is the bug — confirm it, don't be surprised by it), link with **no** locale prefix.
   - `h.timur+teacherself@executionai.net` — a second Teacher invite (Teacher agent's own onboarding-journey test) — use this one to also manually complete the `/setup-account` → login loop if you want that full journey verified end-to-end (no agent could reach the link itself).
   - `h.timur+student1@executionai.net` — real self-registration **welcome** email, expected English, containing working `profile_url`/`booking_url` links.
2. **Cancel the orphaned live Stripe test-mode Subscription** — created against QA Test School's connected account ("Hakan Sandbox") during the Student agent's Critical-bug repro for C-6. It is not recorded anywhere in the app's database and cannot be cancelled from inside the app; find it in the Stripe test-mode dashboard (customer/email `h.timur+student1@executionai.net`, product "QA Monthly Subscription," ~€49/mo) and cancel it before it attempts another monthly test-mode renewal.
3. **Decide what to do with the pending test artifacts** left in place on purpose (all clearly QA-named/emailed, low risk, but real rows in the shared dev DB): the new `support`-level HQMember from the HQ agent's invite test; the two pending Team/Teacher invites from the School agent; the "QA Monthly Subscription" test package created by the Student agent; a stray `99999`-credit `StudentPackage` on "QA StudentB" (needs Django Admin to remove, no API path exists).
4. **Triage this report's Critical and High items into a fix round**, in this suggested order: the Stripe webhook/fallback gap (C-5/C-6, and by extension the fragility it reveals in the working C-1-adjacent package path) first, since it's a direct pay-and-get-nothing bug; then the HQ invite-escalation path (C-1) and the attendance/compensation trio (C-2/C-3/C-4), since both are silent data-corruption risks that a school wouldn't notice until well after the fact; then the remaining High items.

---

## Test data created this round (left in place unless noted otherwise)

See each panel report's own "cleanup"/"test data" section for the full, exact list. Highlights not already covered under Action Items: two self-registered students (`qa.student.a@qa-nounder40.test`, `qa.student.b@qa-nounder40.test`) with QA Test School enrollment and granted credits; several lessons, one compensation plan ("QA Base Plan"), and one custom attendance status ("Excused (QA)") on QA Test School, all from the Teacher agent's isolated repro fixtures; one real, permanent Stripe Connect onboarding completed for QA Test School (intentional — this is now a genuinely usable test fixture for all future QA rounds, not just this one); one real `2.5`-credit grant and one real `10`-credit package purchase on the new student account (intentional, working test data); two live chat conversations (`school_teacher`, `teacher_support`) with test messages, left as evidence.
