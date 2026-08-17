# From Package to Subscription — Single Engine

**Status:** Design agreed (brainstorming Carlo, August 17, 2026) — not yet scheduled
**Scope:** product/design decision record, no implementation details

---

## 1. Decision

There will be **one engine only: packages and credits**. A "Subscription" is not a separate product with its own machinery — it is simply **a recurring package, displayed under a different name**.

| | One-time purchase | Recurring billing |
|---|---|---|
| Displayed as | **Package** | **Subscription** |
| Engine | credits | credits (same) |
| Billing | Stripe one-time checkout | Stripe recurring (already live) |
| Renewal | — | credits reset each cycle (rollover optional, already live) |

The rename is **presentation only** (student storefront, "My packages", emails, school reports), translated in all supported languages. No second deduction logic, no second refund logic, no second reporting path.

## 2. Why — what the code actually does today

Findings from the codebase audit (August 2026):

- **Packages are the only live engine.** Purchase, credit deduction at booking, cancellation refund/burn, and reporting all run on `packages` / `student_packages`.
- **Recurring packages already exist** (migration 028) and already cover the subscription lifecycle: Stripe recurring billing, credit reset on renewal with optional rollover, past-due handling, credit zeroing on cancellation.
- **The `subscriptions_catalog` is a shopfront without an engine.** Schools can create subscriptions, but students cannot buy them (checkout only handles packages), nothing ever writes `student_subscriptions`, and the booking flow never consults them. The "subscription first, then credits" priority from the original spec was never implemented.
- **Lesson-type restriction is not enforced anywhere.** It is stored and displayed on packages, but at booking time credits are deducted from any active package regardless of the lesson's type. This gap must be closed for the new model to mean anything — and closing it fixes plain packages too.

Maintaining a second parallel engine (separate access counters, separate refund rules, separate priority logic, separate reports) is cost without benefit. The recurring package already is the subscription, minus a label.

## 3. Product decisions

### 3.1 "Unlimited" is a display checkbox, not a counter

An **Unlimited** toggle on the package: technically the package still holds a generous credit pool (large enough to exceed what is physically bookable within its validity, e.g. one year); the real limit is the **expiry date**. The storefront **never shows the credit number** for these packages — it shows "Unlimited". Combined with the weekly cap below, this expresses products like *"unlimited access, up to 4 per week"*.

### 3.1b Optional weekly booking cap

An optional **weekly entry cap** per package (empty = no cap). Rules:

- A week is a **calendar week (Mon–Sun)**, counted by the **lesson's date**, not the booking date — so "4 per week" means what the student expects, and multi-date booking across several weeks works naturally.
- **Confirmed bookings count.** A cancellation within policy frees the weekly slot again; a no-show keeps counting (consistent with the burned credit).
- Enforced at booking as part of the same eligibility check as lesson types (see 3.3): a package is eligible only while its bookings in that lesson's week are below the cap.
- Storefront shows it plainly: *"up to N per week"*.

### 3.2 Multi-type restriction, homogeneous in cost

A package/subscription links to a **list of allowed lesson types** (multi-select in the creation form, per platform UI rules) with a shared credit pool — e.g. 5 entries split freely across two types (5-0, 3-2, …).

Subscriptions are built **cost-homogeneous**: all allowed types share the same credit cost (e.g. in-studio = 2 credits, Zoom = 1 credit → separate subscriptions per tier). This keeps "entries" honest: the creation form computes `credits = entries × cost` and the storefront can display entries instead of raw credits.

Two safeguards, since credit cost lives on the **course**, not on the lesson type:

1. **Mixed-cost warning** in the creation form: when the selected types include courses with different credit costs, warn the school.
2. **Delivery-mode restriction**: "in-studio vs Zoom" is the course's online/in-person flag, not a lesson type. The restriction model therefore has two dimensions: *allowed lesson types* + *optional mode filter (online only / in-person only / both)*.

### 3.3 Enforcement at booking (the real work)

When a student books, the engine must only deduct from packages **eligible for that lesson**:

- the lesson's type is in the package's allowed list (or the package allows all), **and**
- the lesson's mode (online / in-person) matches the package's mode filter, **and**
- the package's weekly cap, if set, is not yet reached in the lesson's calendar week (see 3.1b).

Eligibility applies to all packages, one-time and recurring alike. Deduction order among eligible packages stays as today (earliest expiry first).

### 3.4 VIP features — postponed

Priority booking windows, freeze periods, etc. are deferred. When wanted, they graft onto the package engine; nothing in this design blocks them. The existing `is_vip` flag remains a badge.

## 4. Work outline (when scheduled)

1. **Data model** — allowed-lesson-types list per package, mode filter, unlimited flag, optional weekly cap. (`lesson_type_restriction` single value becomes a list.)
2. **Creation form** — multi-select of lesson types, mode filter, entries × cost helper, mixed-cost warning, unlimited toggle, weekly cap field.
3. **Booking enforcement** — eligibility check described in 3.3 (types + mode + weekly cap). Also covers today's unenforced single-type restriction on plain packages.
4. **Display** — "Subscription" label when recurring; "Unlimited" instead of credit counts; storefront, My packages, emails, reports; all languages.
5. **Cleanup** — hide the school "Subscriptions" section (shopfront without engine, misleading today); retire `subscriptions_catalog` / `student_subscriptions` tables later.

## 5. Out of scope

- VIP priority booking and freeze (see 3.4)
- True unlimited counters (see 3.1)
- Per-type entry caps within one subscription (current decision: shared pool only; the two-dimension restriction model leaves room for this later)
