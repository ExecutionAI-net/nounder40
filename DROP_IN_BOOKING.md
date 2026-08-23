# Drop-in Booking — Buy One Lesson, Booked Instantly

**Status:** Proposal — to be discussed (Carlo ↔ Hakan), August 2026
**Scope:** product/design decision record + implementation plan
**Depends on:** Stripe Connect being live (Hakan's task); single-engine packages (PACKAGE_TO_SUBSCRIPTION.md)

---

## 1. The problem

A student lands on a lesson she wants and has no credits. Today the flow is:

```
Lesson card → "Not enough credits" → Buy credits button
    → /student/buy?redirect=/student/book
    → picks a package → Stripe Checkout → payment OK
    → back on /student/book … and the lesson must be FOUND and SELECTED AGAIN
```

Two distinct gaps:

1. **No single-lesson purchase.** A student who wants *just this one lesson*
   is forced to reason in packages ("buy a 1-credit package"), then re-do the
   booking by hand. Casual/first-time students are exactly the ones we lose
   in that friction.
2. **The redirect loses the lesson.** Even when buying a package, the
   `redirect` param brings her back to the booking page but not to the lesson
   she started from — no reopened confirmation, no auto-booking.

## 2. Decision (proposed)

**Keep one engine: everything is still a package purchase.** A "drop-in" is
not a new accounting concept — it is an existing single-lesson package,
bought through a checkout that carries the target `lesson_id`, and the
webhook **creates the booking automatically** right after activating the
credits.

Why not a parallel "direct purchase" path: the credits engine already gives
us, for free, cancellation policy (refund/burn), no-show handling, teacher
compensation, attendance, student history and reports. A second money-based
path would need all of that duplicated. Why not auto-create a package on the
fly per purchase (idea considered): it would pollute the school catalog and
the reports with one-off products; flagging a curated package as "the
drop-in price" keeps the catalog clean and the price under the school's
control.

## 3. Student UX

### 3.1 The two-option modal

When booking is blocked for missing credits, the confirmation modal offers:

```
┌──────────────────────────────────────────────┐
│  Non hai crediti per questa lezione          │
│                                              │
│  ① Compra solo questa lezione     €19,97     │
│     Pagamento e prenotazione immediati       │
│                                              │
│  ② Compra un pacchetto                       │
│     Con "10 Lezioni" questa lezione ti       │
│     costerebbe €15,00 (upsell line)          │
│                                              │
│  [ Annulla ]                                 │
└──────────────────────────────────────────────┘
```

- Option ① appears **only if** the school has a drop-in package covering
  this lesson's type (see §4). No drop-in configured → today's behavior
  (option ② only).
- Option ② goes to `/student/buy` as today, but carrying the `lesson_id`
  (see §5.3) so the flow can come back and finish the booking.
- The upsell line on ② is computed from the cheapest eligible package
  (price / credits × lesson credit_cost) — it converts far better than two
  dry buttons and costs nothing to render.

### 3.2 After payment

- Option ①: Stripe success page → student lands on **"My bookings" with the
  lesson already booked** + booking confirmation email/push as for any
  booking. Zero re-selection.
- Option ②: after the package purchase, return to the booking page with the
  **confirmation modal reopened on the original lesson** (one tap to
  confirm). Auto-booking here too is tempting, but a package buyer may be
  buying for the month, not for that lesson — one explicit tap is safer.
  *(Open question #3.)*

### 3.3 Cancellation semantics (must be said clearly in the UI)

A drop-in follows the same policy as every booking: cancel **within** policy
→ the credit comes back to the wallet, spendable on another lesson of the
same type (NOT an automatic money refund); cancel outside policy / no-show →
credit burned. Money refunds stay manual (school admin), as today. The
booking-confirmation and cancellation screens must state this for drop-ins:
"riceverai un credito valido per un'altra lezione di questo tipo".

## 4. School configuration

New boolean on `packages`: **`is_drop_in`**.

- Meaning: "this package is the single-lesson price for the lesson types it
  covers". The school creates (or reuses) a package with
  `credits = credit_cost` of those lessons and flags it. Milano's existing
  "Lezione Singola Sala" is exactly this product already.
- Resolution at booking time: among the school's active drop-in packages,
  pick the ones whose restrictions cover the lesson (`allowed_lesson_types`
  empty or containing the type, `mode_filter` compatible) **and** whose
  credits ≥ the lesson's `credit_cost`. If several match, cheapest wins.
- Validation on save (soft warning, not a block): a drop-in package whose
  credits exceed the covered lessons' credit cost leaves leftover credits in
  the wallet — legal, but probably not what the school meant.
- UI: checkbox in the package form ("Prezzo lezione singola / drop-in") +
  badge on the card. Nothing else new for schools to learn.

## 5. Implementation plan

### 5.1 Checkout carries the lesson

`POST /api/stripe/checkout/` accepts an optional `lesson_id` alongside
`type: 'package', product_id`. It is stored in the Checkout Session
`metadata` (`lesson_id`, plus the already-present package/student ids).
Before creating the session, re-validate the lesson is still bookable
(scheduled, future, not full, min-notice, VIP window, documents) and refuse
with a clear error if not — don't take money for a lesson we already know
can't be booked.

### 5.2 Webhook books the lesson

On payment success (same event that activates the `StudentPackage` today),
if `metadata.lesson_id` is present:

1. Activate credits (existing code, unchanged).
2. Run the **standard booking engine** for that lesson — the same entry
   point used by `POST /api/bookings/` (capacity, min notice, VIP window,
   document checks, dedup if already booked), deducting from the package
   just activated (normal deduction priority applies).
3. Success → booking confirmed, standard confirmation email/push.
4. Failure (lesson filled up during payment, teacher cancelled, etc.) →
   credits simply stay in the wallet + notification/email: "la lezione non è
   più disponibile, il tuo credito è valido per un'altra lezione dello
   stesso tipo". **No automatic money refund** (consistent with §3.3);
   the school can refund manually if it wants.
5. Idempotent: webhook retries must not double-book (booking engine already
   dedups on student+lesson; keep it that way).

Also wire the same logic into `GET /api/stripe/verify-session/` (the client
lands there before the webhook sometimes) — whichever runs first books,
the other one no-ops.

### 5.3 Fixing the package flow's return leg (option ②)

- Book page sends `/student/buy?redirect=/student/book&lesson_id=<id>`.
- Buy page keeps `lesson_id` in the localStorage handoff it already uses
  for `redirect`, and after `payment=success` returns to
  `/student/book?resume_lesson=<id>`.
- Book page, on `resume_lesson`, fetches that lesson and reopens the
  confirmation modal (or shows "lesson no longer available" if it's gone).

### 5.4 No seat hold (v1)

While the student is on Stripe Checkout the spot is **not** reserved. The
window is small and §5.2.4 handles the loser of the race gracefully. A
10-minute seat hold (a `pending` booking with TTL released by an Edge
Function/cron) is the v2 upgrade if real-world contention shows up —
explicitly out of scope for v1 to keep the webhook path simple.

### 5.5 Interactions checked

- **Free first lesson**: if the student qualifies, the no-credits modal
  never appears — free-lesson logic runs first. No interaction.
- **Recurring packages / subscriptions**: untouched; deduction priority
  unchanged. A drop-in package is one-shot (`is_recurring = false` enforced
  together with `is_drop_in`).
- **Multi-date booking**: drop-in button applies to single-date bookings
  only (v1). Multi-date with no credits keeps today's package flow.
- **Cross-school**: drop-in resolves within the lesson's school only, like
  every wallet operation.
- **Discount codes**: work as for any package checkout, nothing special.

## 6. What is explicitly NOT in this proposal

- No money-based booking path outside the credits engine.
- No automatic Stripe refunds on cancellation (credit-back only, as today).
- No seat hold during checkout (v2, see §5.4).
- No auto-generated per-purchase packages (considered and rejected, §2).

## 7. Open questions for Hakan

1. **Webhook timing**: booking from the webhook means the confirmation can
   arrive a few seconds after the redirect. Acceptable, or do we book
   optimistically in `verify-session` and reconcile? (Proposal: both paths,
   idempotent — §5.2.)
2. **Stripe Connect specifics**: any constraint on metadata size/shape on
   destination-charge sessions we should know about?
3. **Option ② auto-book**: after a *package* purchase started from a
   lesson, do we auto-book that lesson or reopen the modal for one explicit
   tap? (Proposal: reopen the modal — §3.2.)
4. **Drop-in flag vs price field**: `is_drop_in` on packages (proposal) vs a
   `drop_in_price` on courses with a hidden system package underneath. The
   flag is less magic and reuses the catalog UI; the field is more
   discoverable for schools. Preference?
5. **ETL/prod data**: Barcelona currently has no single-lesson package —
   part of the rollout is each school flagging (or creating) one.

## 8. Rollout order

1. Backend: `is_drop_in` migration + serializer + package form checkbox.
2. Backend: `lesson_id` through checkout metadata + webhook/verify-session
   auto-booking (idempotent) + failure notification.
3. Frontend: two-option modal + upsell line on the book page.
4. Frontend: `resume_lesson` return leg for the package flow (§5.3).
5. Docs/QA: cancellation copy for drop-ins, E2E test of the race case
   (pay while lesson fills up).

---

## 9. Appendix — Per-school Stripe Connect setup (prerequisite)

How each school links its own Stripe account under HQ. This is the
prerequisite for everything above (and for package sales in general); most
of it is **already implemented** — what's left is configuration plus one
code fix.

### 9.1 Architecture (already in the code)

- **One HQ platform account** on Stripe; every school gets its own
  **Connect Express account** created *inside* HQ's platform
  (`schools.stripe_account_id`). The school never brings a pre-existing
  Stripe account — Express accounts are born from our onboarding call.
- Payments are **destination charges** on the platform account:
  `transfer_data.destination` = the school's connected account,
  `application_fee_percent` / `application_fee_amount` =
  `schools.platform_fee_percentage` (per school, set by HQ when creating
  it, default 10%). Stripe splits automatically at charge time: the school
  receives its net amount as a Stripe payout, HQ keeps the fee. No manual
  transfers, no reconciliation.
- **One webhook endpoint** for the whole network:
  `POST /api/webhooks/stripe/` verified with `STRIPE_WEBHOOK_SECRET`.
  Since charges happen on the platform account, platform-level events are
  enough — no per-connected-account webhook configuration.
- Checkout **refuses to sell** for a non-connected school
  (`school_not_connected` unless `stripe_onboarding_complete`). The
  drop-in button (§3.1) inherits this gate for free: option ① simply
  doesn't appear until the school is connected.

### 9.2 School-side flow (already implemented, school panel → Payments)

1. School admin opens **Pagamenti** and clicks connect.
2. `POST /api/stripe/onboard/` — creates the Express account on first call
   (idempotent: reuses `stripe_account_id` on retry) and returns a Stripe
   **AccountLink** URL.
3. The admin completes Stripe's hosted Express onboarding (KYC: legal
   entity, address, IBAN for payouts). Abandon/expire → back to
   `/school/payments?onboard=refresh`, done → `?onboard=success`.
4. `GET /api/stripe/onboard/status/` re-reads the account from Stripe
   (`charges_enabled` + `details_submitted`) and caches the result on
   `stripe_onboarding_complete`. When it flips to true, the school's
   packages become purchasable.

Nothing new to build for schools: the whole §9.2 exists today.

### 9.3 ⚠️ Fix required BEFORE connecting the first school

`stripe.Account.create(...)` hardcodes **`country="IT"`**
(`backend/commerce/stripe_service.py`). Barcelona is Spanish: its Express
account must be created with `country="ES"`, and **the country of a Stripe
account cannot be changed after creation** — a wrong one must be deleted
and re-onboarded from scratch. Fix: derive the ISO code from
`schools.country` (Italy→IT, Spain→ES, …) with a hard error when the
mapping is missing, rather than a silent IT default. One-line fix + tiny
mapping; do it before Hakan clicks "connect" on Barcelona.

### 9.4 HQ-side go-live checklist (Hakan, tomorrow)

1. **Stripe dashboard (platform account)**: enable Connect (Express),
   set platform branding — name/logo/colors shown inside the Express
   onboarding and on payout statements.
2. **Webhook**: register `https://danzaclassicanounder40.com/api/webhooks/stripe/`
   on the platform account with the events the handler covers (payment,
   subscription lifecycle, refund, `account.updated`); copy the signing
   secret.
3. **Prod env** (EC2): set `STRIPE_SECRET_KEY` (platform key) and
   `STRIPE_WEBHOOK_SECRET`. Both default to empty today — payments are
   inert until set.
4. **Dry run in test mode first**: same two env vars with test keys, one
   fake school onboarding (Stripe test KYC data), one test purchase
   end-to-end (checkout → webhook → credits in wallet → transaction row →
   fee split visible in Stripe). Then swap to live keys.
5. **Connect real schools**: each school admin runs §9.2 from her own
   panel (after §9.3 is deployed). Verify per school: status flips to
   connected, a real small purchase splits correctly (school payout + HQ
   application fee).
6. **Per-school fee sanity check**: `platform_fee_percentage` is already
   set per school by HQ — confirm the values are the intended ones before
   the first live sale.

### 9.5 Why Express, not the schools' own Stripe accounts

Considered and rejected: **Standard Connect**, where each school links its
own full Stripe account and self-manages refunds, disputes and payouts.
Reasons to stay on Express (the current model):

1. **Schools are not payment operators.** Express is a 10-minute hosted
   KYC (legal data + IBAN) inside an HQ-branded flow. Standard means each
   school opening and configuring a full Stripe account — ten schools,
   ten differently misconfigured setups, all landing on HQ support.
   Consistent with the product's positioning: HQ is the operating system,
   the school teaches dance.
2. **Refunds must go through the platform — that's a feature.** A refund
   here is not just money back: it updates `transactions.status` and must
   stay consistent with credits, bookings, reports and HQ's fee. A school
   refunding from its own Stripe dashboard would silently desync our DB.
   With Express, refunds start from the school panel and everything stays
   aligned.
3. **HQ's fee is guaranteed by design.** Destination charges split
   automatically and invisibly. With school-owned accounts the
   application fee still works, but the school has far more surface to
   route around the platform.
4. **Refactor cost.** Checkout, recurring billing, portal, invoices,
   refunds and webhook all assume charges on the platform account.
   Standard + direct charges would mean per-connected-account customers,
   products and subscriptions — days of rework in payment code, right
   before go-live.

Trade-off accepted: with destination charges, chargebacks formally land on
the platform account rather than on the school. Acceptable for a small
network of affiliated, trusted schools — and if a large school ever
demands its own Stripe, Connect allows Standard accounts to coexist
case-by-case without throwing anything away.

---

*Drafted August 23, 2026 — Carlo & Claude, for review with Hakan.*
