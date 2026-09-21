# Package validity extensions

**Status: implemented (2026-09-21), branch `feat/package-extensions`.**

A package's expiry (`StudentPackage.expires_at`) is set once, at purchase.
This is the one mechanism that moves it forward afterwards, for two reasons
— and the ledger that keeps every move explainable and reversible.

## 1. School closures give their days back

A closure (`SchoolClosure`) can opt in with `extends_packages` (checkbox in
Settings → Closure days, default **off**: for many schools the Christmas
break is part of the deal, for a flood it is not). When it does:

- **Which packages.** Every package of the school whose covered days — from
  its start (`starts_at` for a buy-ahead, else `purchased_at`) to its last
  covered day — touch the closure, even by one day. Status `active` or
  `exhausted` (a school refund brings an exhausted package back with its old
  expiry, so it must carry the extension too).
- **How many days.** The **whole closure length**, not only the part inside
  the package's window (Carlo's decision, 2026-09-21).
- **Where they land.** After the old expiry, counted as **open days**: every
  day the school is shut for the whole day is skipped, not counted — this
  closure's own tail beyond the old expiry, and any other whole-day closure
  whether or not it gives days back. Each closure that gives days back does
  so once, when its turn comes in date order; a closure that falls inside the
  window only because another one stretched it gets its turn too.
- **Example.** One-month package bought Dec 1 (covers through Dec 31), school
  closed Dec 24 – Jan 2 (10 days). Owed 10; Jan 1 and 2 skipped; new expiry
  Jan 13 00:00, last usable day Jan 12. With a second closure Jan 10 – 11
  that also gives days back: the first walk skips Jan 10 – 11 too (Jan 3 – 9,
  Jan 12 – 14), then the second gives its two (Jan 15 – 16) → expiry Jan 17.

## 2. One student, by hand

`POST /api/school/credits/packages/<id>/extend/` with `{expires_at:
"YYYY-MM-DD", note}` — from the usage modal (Students → package usage →
"Extend validity"). The package then covers the whole picked day in the
school's timezone. Forward only (`expiry_not_later`): a shorter validity
would strand lessons already booked. Section `manualCredits`, like a grant.
The note is the school's; the student sees the days and the new date.

The hand-picked date becomes the package's **base**: the closures that had
already given their days are absorbed in it (they are not given again, and
deleting one of them later moves nothing), while a closure that gives days
back and falls inside the new window gives them on top — so the response's
`expires_at` can be later than the day picked, and the ledger says why.

## 3. How it is computed: a recompute, never a patch

`students/extensions.settle(sp)` recomputes the expiry from scratch every
time anything relevant happens, and every entry point ends there:

| Moment | Seam |
|---|---|
| Closure saved (created, re-dated, type or opt-in changed) | `schools/signals.py` post_save → `resettle_school(school, closure=…)` |
| Closure deleted (API, Django admin, bulk delete) | `schools/signals.py` pre_delete → `resettle_school(school, ignore=…)` |
| Package created (Stripe purchase, manual grant, anything else) | `students/signals.py` post_save(created) → `settle(sp)` |
| Hand-picked date | `extend_manually` → manual ledger row → `settle(sp)` |

`settle` takes the base (the last manual row's date, else the expiry at
purchase = the first ledger row's `expires_before`), walks the school's
closures that give days back in date order — each one that falls in the
running window adds its length in open days and gets exactly one live
ledger row, refreshed to the replayed values — and revokes live rows whose
closure no longer holds. The package row is locked for the duration, so a
closure batch and a purchase settling the same package take turns. Result:
the same expiry whatever the order closures were recorded, re-dated, toggled
or deleted in, and a ledger that always explains the stored date.

A change to a closure's notes alone moves nothing. Moving a closure to
another school is refused by the API (the serializer drops `school` on
update); the admin path is covered by the signals all the same.

## 4. Left alone, on purpose

- **Stripe-billed subscriptions** (`stripe_subscription_id` set): every
  renewal webhook rewrites `expires_at` (commerce/webhooks.py) and the
  charge date would have to move with the window. Refused with `409
  managed_by_stripe`; skipped by closures. **Phase 2**, together with
  "renew now" (Stripe `pause_collection` / `trial_end`). Recurring
  packages assigned by hand (no Stripe subscription) are ordinary packages
  here.
- **Drop-in and special-event tickets**: their expiry is the lesson itself.
- **Packages with no expiry**: nothing to extend.
- **Chained buy-ahead packages** (`start=after_current` sets the next
  package's `starts_at` to the current one's `expires_at` at purchase time):
  a closure straddling the boundary gives its full length to both, and the
  next package's start does not move when the current one is extended — the
  two overlap for those days and the earlier-expiring one is drained first.
  Known and accepted for now.

## 5. Where it lives

- Rule and ledger: `students/extensions.py`, `StudentPackageExtension`
  (kind `closure` | `manual`, `days` owed or asked, `expires_before/after`
  snapshots, closure period snapshot, `created_by`, `revoked_at`). One live
  closure row per package and closure (partial unique index).
- Shared helpers: `School.tzinfo()` / `School.end_of_day(day)` /
  `schools.models.zone_or_utc` — the one timezone fallback, also used by the
  booking engine and the drop-in expiry; `SchoolClosure.last_day`.
- Read side: usage modal (`/api/school/student-usage/packages/<id>/` →
  `extensions`), student credit history (`type: school_extension`, zero
  credits, `days`, `expires_after`, closure period — not counted as usage
  on the package card), Settings list (`extended_count`), Django admin
  (read-only ledger).
- Nothing else had to change: the booking engine checks `expires_at`
  against the lesson's date and never flips a package to "expired" by
  itself; reminders, reports and the student's page read the same column.
- Tests: `students/tests/test_package_extensions.py`.
