# Recurring packages: credits follow the paid invoice (2026-11-07)

Branch `fix/renewal-reactivates-exhausted-package`, **not yet merged**. Work continues from
another machine: this file is the handover.

## Why

Roberta Serina (`publiroby@iol.it`, Barcelona) paid the monthly "Abbonamento Mensile 5 Lezioni
Zoom" on 2026-10-04 and 2026-11-04. After using every lesson of October her StudentPackage sat in
`exhausted`; the renewal webhook refilled the credits but never set it back to `active`, so the
roster, her balance and the booking engine kept ignoring it: paid, not bookable.

While fixing it, a second defect: the credits were granted on `customer.subscription.updated`,
which Stripe sends at the cycle boundary **before** the renewal invoice is paid. A declined card
left a full, unpaid cycle bookable with a "completed" Transaction. Carlo: an unpaid subscription
must give no lessons.

## What the branch does (backend only, `commerce/webhooks.py`)

| Event | Before | Now |
|---|---|---|
| `customer.subscription.updated` | refilled credits, moved the window, wrote the Transaction | syncs `next_renewal_at` only; nothing while `past_due`/`unpaid`; nothing after `subscription.deleted` |
| `invoice.payment_succeeded` / `invoice.paid` (`billing_reason = subscription_cycle`) | ignored for packages | credits of the cycle, window (`expires_at`, buy-ahead rolls one interval), `exhausted` → `active`, Transaction with the invoice's amount/currency keyed on its PaymentIntent (refundable) — one atomic block, idempotent |
| `invoice.payment_failed` | grace from `next_renewal_at` | grace from the unpaid invoice's period start (stable across retries) |

- First invoice (`subscription_create`) is the activation, already handled: skipped.
- A cycle credited by the old handler before the deploy (Transaction `sub_…:renewal:<ts>`) is
  recognised and not credited twice.
- `deleted` (school's decision) and `expired` (Stripe cancelled) rows are never revived: money
  recorded, credits in the row, a warning in the log.
- `StudentPackage.reactivate_if_refilled()` is the one predicate for the filtered-update refill
  paths (renewal, refunded booking, reversed deduction, repair command). It does not touch the
  low-credits flag (SCH-R3-12).
- `manage.py repair_renewed_packages` lists (and with `--apply` reactivates) the rows renewed while
  exhausted before the fix; also lists "window over, not changed".
- Tests: `commerce/tests/test_renewal_reactivates_exhausted.py` (20) + the renewal/buy-ahead/grace
  tests rewritten on the paid-invoice event. Five `/code-review high` passes.

## Two conditions before production — check with Hakan

1. **The production Stripe webhook endpoint must deliver `invoice.payment_succeeded` or
   `invoice.paid`.** Stripe Dashboard › Developers › Webhooks › production endpoint › enabled
   events. If neither is enabled, after the deploy renewals credit NOTHING (before, the
   `updated` event did it). QA round 2 (September) shows the event reaching dev; production is
   unverified.
2. **After the deploy, repair the rows renewed while exhausted** (Roberta and anyone else), on the
   Django container, list first, then apply:

   ```
   python manage.py repair_renewed_packages
   python manage.py repair_renewed_packages --apply
   ```

## Deferred (decided with Carlo, 2026-11-07: "vediamo dopo")

1. A recurring package the school deletes from the Credits page keeps being billed by Stripe
   (nothing cancels the subscription). Now logged on each paid cycle; the real fix is to refuse the
   delete or cancel on Stripe.
2. Buy-ahead packages (`starts_at`): a failed-then-recovered payment shifts the window by the grace
   days, and the drift compounds (the roll is `expires_at + interval` from a possibly grace-extended
   value).
3. `_period_end` (current_period_end moved onto items in Stripe API 2025-03-31) exists in three
   places: `commerce/webhooks.py`, `commerce/checkout_activation.py`, `commerce/stripe_views.py`.
4. `bookings/services.cancel_booking` still reactivates with an in-memory read-modify-write.
