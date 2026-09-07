# QA Full Regression — Student Panel

**Environment:** `https://dev.danzaclassicanounder40.com` (`develop` branch)
**Date:** 2026-09-06/07 (dev server clock; UTC)
**Tester:** QA Agent (Student panel), one of 4 parallel agents sharing one browser instance
**Primary test account:** newly self-registered `h.timur+student1@executionai.net` / `QaStudent2026!`, linked to **QA Test School** (`33807f7b-5c55-43e5-ab5a-e84794d07601`)
**Secondary accounts used for setup/verification only:** `qa.school.owner@qa-nounder40.test`, `qa.hq.owner@qa-nounder40.test` (both `QaSuite!2026`)

**Pre-existing seeded account note:** `qa.student@qa-nounder40.test` is linked to **Danza Clásica Barcelona**, a school with real-looking production data (real packages, real bookings, real chat history). Per instructions this account was used **read-only** (a handful of `GET` calls to confirm its state) and never mutated. All destructive/mutating testing was done on the brand-new `h.timur+student1@…` account and QA Test School, which is safe to touch.

---

## 0. Executive summary

The student panel's core UX (browsing, booking, cancellation policy, credits, profile, documents, support chat, i18n) is in very good shape and every previously-reported bug from `QA_TEST_RESULTS.md` that was claimed "fixed" was **independently re-verified as genuinely fixed** on this dev deployment (see §1).

The real news from this round is the **purchase pipeline**. Now that Stripe Connect onboarding for QA Test School completed successfully partway through this session, I was able to run real Stripe test-mode payments end-to-end for the first time. The one-time **Package** purchase works correctly and is fully verified. But two other purchasable product types have **critical, real-money-equivalent bugs**:

- **Shop orders**: Stripe charges the card successfully, but the order is never marked paid — no webhook, no fallback. A paying student gets nothing and there is no recovery path in the app. (Critical — see Finding C-1)
- **Subscription (recurring) packages**: Stripe creates a real recurring subscription and charges the card, but the app's only activation path crashes with an unhandled `AttributeError` and never grants access. (Critical — see Finding C-2)

Both are symptoms of the same root cause: **the Stripe webhook does not appear to be processed on this dev environment at all** (Finding C-3). One-time Package purchases only "work" because a client-side fallback (`/api/stripe/verify-session/`) happens to cover that one case — and that fallback's own code comments show the team already suspected the webhook doesn't fire in "Sandbox"-type environments.

---

## 1. Page-by-page coverage

| Page / flow | Locales checked | Result |
|---|---|---|
| `/register` (public) | en | ✅ full validation + happy path tested |
| `/login` | en, es | ✅ |
| `/student/dashboard` | en, it, es | ✅ translated correctly, live data correct |
| `/student/book` (calendar + list) | en, it, de, es | ✅ — calendar locale bug and spots-left bug both **confirmed fixed** |
| Booking confirm modal | en | ✅ incl. insufficient-credit and documents-required paths |
| `/student/bookings` (My Classes) | en | ✅ Upcoming/Past/Cancelled tabs, cancel flow, no-show display |
| `/student/buy` (Buy Packages) | en, it | ✅ display correct; ❌ purchase pipeline bugs, see §3 |
| `/student/packages` (My Packages) | en, es | ✅ Packages/History tabs (no separate "Subscriptions" tab — by design, see note below) |
| `/student/shop` | — (API-level) | ⚠️ purchase pipeline bug, see §3 |
| `/student/support` | it | ✅ FAQ accordion, live chat send confirmed received by school |
| `/student/profile` (Profile/Documents/Address) | en, it, es | ✅ all three tabs, edit+persist, language switch, document upload+gating |
| Role isolation (`/api/hq/*`, `/api/school/*`) | — | ✅ all 403 |
| Waitlist / Full state | en | ✅ clean disabled state, no leaked UI |
| Django Admin | — | out of scope, not tested |
| `/select-role`, `/setup-account` | — | not applicable to self-registration; not tested (these are for invited team members) |
| `/reset-password` | — | not exercised end-to-end; verified only that the backend queues a `password_reset` email via Celery post-commit (code read, not live-tested) |

**Note on "Packages/Subscriptions/History" tabs:** the actual UI only has two tabs, "Packages" and "History" (`frontend/src/app/[locale]/student/packages/page.tsx:204-205`). This matches CLAUDE.md's "packages ARE subscriptions" single-engine rule — recurring packages show inside the same "Packages" list with a `↻ Subscription` badge, there's no separate subscriptions surface. Not a bug.

---

## 2. Re-verification of previously-reported (claimed-fixed) bugs

All three items called out in the task brief were independently re-tested and are **confirmed fixed**:

1. **Calendar stuck in Turkish** — `/student/book` calendar widget now correctly follows the active locale. Verified live in **English** ("September 2026", "MON TUE WED…"), **Italian** ("Settembre 2026", "LUN MAR MER…", "DOMENICA 6 SETTEMBRE"), and **German** ("September 2026", "MO DI MI…", "SONNTAG, 6. SEPTEMBER"). No Turkish text appeared in any of the three.
2. **Missing ICU placeholder for spots left** — confirmed live with real numbers in all three locales: "10 spots left" (en), "10 posti disponibili" (it), "10 verbleibende Plätze" (de). No bare "spots left" text anywhere.
3. **Generic Stripe error message** — reproduced the exact scenario (checkout before Connect onboarding finished) and the app showed a specific, correctly-translated message: *"The school has not connected payments yet: contact them to complete the purchase."* — not the old generic "API error 400".

Also spot-checked and found clean (no raw i18n keys) on pages the prior round flagged: Dashboard, Support (`Faq Title` → now "Domande Frequenti"/"Frequently Asked Questions"), Profile tabs (`Tab Profile`/`Tab Documents` → now "Profile"/"Documents"/"Perfil"/"Documentos"), Buy Packages (the prior round noted ~50 raw keys specifically on `student/buy` as out-of-scope-for-that-PR; this round found the page fully translated in English, Italian and Spanish — appears to have been swept up in a later fix round).

---

## 3. Purchase testing — full detail

### 3.0 Dependency timeline

QA Test School's `stripe_onboarding_complete` was `false` for most of this session (checked repeatedly via `qa.school.owner` → `GET /api/school/profile/`). During that window I worked through every non-payment item in the brief. Onboarding completed successfully at some point before ~00:03 UTC (another agent's work, per the coordination note) — confirmed via the same endpoint flipping to `true`, and I immediately went back and ran real purchases.

### 3.1 One-time Package — ✅ fully verified, works correctly

- Product: **QA Credit Pack**, €25.00, 10 credits, 90-day validity, QA Test School.
- Stripe Checkout session: `cs_test_a1AoyF0UuebiOL9Puc1keYWqbEgB3KsZsZDkopkrvQ0i0adICKP4pI5pWl`
- Stripe-hosted page showed correct merchant ("Hakan Sandbox" — a Stripe **Sandbox**, i.e. test-mode, account — satisfies the "confirm TEST MODE" sanity check), correct product name ("QA Credit Pack"), correct amount (€25,00 / ₺1.462,70 equivalent).
- Paid with `4242 4242 4242 4242`, `12/34`, `123`. Payment succeeded (`payment_status: "paid"`, `payment_intent: pi_3UCqAt3zWjCsyE1110ggHmpr`).
- **Credit grant verified**: new `StudentPackage` (`credits_total: 10`, `credits_remaining: 10`) appeared in `GET /api/student/packages/`; total credit balance moved from 18 → 28.
- **School Payments verified** via `qa.school.owner` → `GET /api/school/transactions/`: `amount: 25.0`, **`platform_fee: 2.5`** (exactly QA Test School's configured 10%), `school_amount: 22.5`, `payment_method: "stripe"`, `stripe_payment_id: pi_3UCqAt3zWjCsyE1110ggHmpr`, `status: "completed"`. The fee split is exactly correct.
- **Caveat on how it activated**: the automatic activation did *not* happen via webhook (see Finding C-3). It happened via the client-side `GET /api/stripe/verify-session/` fallback that the frontend calls on return from Stripe. On my first attempt this fallback was hijacked by the shared-browser-session problem (see §5) and returned `403 not_your_session`, showing the student a "Payment received, but the package does not appear activated yet… contact your school" banner. I re-ran the exact same `verify-session` call as the correct student and it succeeded (`"activation": "package_activated"`). **A real single user (not sharing a browser with other automated agents) would not hit the 403**, but would still be relying entirely on this one fallback call succeeding, since the webhook itself never fired for this payment either.

### 3.2 Recurring "Subscription" Package — ❌ CRITICAL, does not work at all

- Created a QA-labeled subscription product for this test: **QA Monthly Subscription**, €49/month, 8 credits, `is_recurring: true` (via `qa.school.owner` API — this school had no subscription product of its own).
- Stripe Checkout session: `cs_test_a1Sn3hFVcGPZ0OmbMVEHEOOjZtddOHvB8JCFF03OS3UwuGKT7MpEPAp0PB`
- Stripe-hosted page correctly showed "Subscribe to QA Monthly Subscription", "monthly", ₺2.866,90 (≈€49) recurring, button labeled "Abone ol" (Subscribe) — a genuinely distinct subscription-mode Stripe Checkout, not a one-time charge.
- Paid with the same test card. Stripe confirmed the subscription was created and (per Checkout Session `mode=subscription` semantics) the first period was charged.
- **The app never grants anything.** `GET /api/student/packages/` shows no recurring package; total credits unchanged (28, no +8). `GET /api/school/transactions/` (school owner) shows nothing for this purchase either — it is completely invisible to both student and school.
- Root cause, captured directly: calling `GET /api/stripe/verify-session/?session_id=cs_test_a1Sn3h...` (the same fallback that worked for §3.1) returns:
  ```
  {"error":"activation_failed","detail":"AttributeError: get @ _stripe_object.py:173 in __getattr__ — da stripe_views.py:274 in _activate"}
  ```
  **100% reproducible** — called twice, identical error both times.
- Source: `backend/commerce/stripe_views.py`, `VerifySessionView._activate()`, line 274:
  ```python
  sub = stripe.Subscription.retrieve(sub_id)
  period_end = sub.get("current_period_end")   # <-- line 274, raises AttributeError
  ```
  The surrounding comment (lines 263-267) explicitly documents *why this branch exists*: "mode=subscription NON ha un payment_intent, quindi questo ramo mancava e l'attivazione restava appesa al solo webhook (mai consegnato se l'endpoint non è configurato per l'ambiente, es. Sandbox)" — i.e., the team already identified that webhook delivery may not work in a Sandbox-type environment and built this exact fallback for exactly this exact scenario. The fallback itself is broken.
- **Impact**: on this environment, there is currently **no working path** — webhook or fallback — to fulfill a recurring/subscription package purchase. A real customer would pay €49/month and receive nothing, with zero record anywhere in the app.
- ⚠️ **Operational note for the coordinator**: this created a real (test-mode) Stripe Subscription object tied to QA Test School's connected account and my card token. It is not recorded anywhere in the app's own database (no `StudentPackage`, no `Transaction`), so it cannot be cancelled from within the app. It should be located and cancelled directly in the Stripe test-mode dashboard for the "Hakan Sandbox" account to avoid it continuing to attempt monthly test-mode renewals.

### 3.3 Shop purchase — ❌ CRITICAL, silently un-fulfilled

Shop products with `school: null` (HQ-level, sold across the whole network — e.g. "Collezione Libri", €12.00 + €4.99 shipping) are **not gated by QA Test School's Connect status at all**, since there's no split to route. This meant Shop checkout was reachable throughout the whole session, even before onboarding finished.

- Attempt 1 — order `59957f55-480f-476a-9848-d8d7ae07649d`, session `cs_test_b1zCnmrp9ldiiDVMGk2peOJ71smdfzthCN27QEgNi0dtgFW2Afwt1LYtTM`. Card `4242…4242`. Stripe page correctly showed "Collezione Libri €12,00" + "Shipping €4,99" = €16,99.
- Attempt 2 — order `1bb85634-1eb3-4dfc-8f64-3d429eaa8986`, session `cs_test_b1Lh3njpvvx01hIrJVjcr82g8fH0rnuaiNm8a610LGyGqSk44QITPEfyKk`.
- Attempt 3 — order `6ee4335c-c596-4cd9-871c-113018da9d3d`, session `cs_test_b1nieTSHTXuhton7Ea20ezHmZ9X65ZcWMyc5FFNRpLkNP72Fco2Bumuae9`. **This one I independently confirmed actually charged**, via `GET /api/stripe/verify-session/?session_id=cs_test_b1nieTSHT...` →
  ```
  {"status":"complete","payment_status":"paid","metadata":{"kind":"shop_order","order_id":"6ee4335c-...","student_id":"07fb1df1-..."},"activation":"not_a_package_payment"}
  ```
  **The real charge succeeded** (`payment_status: "paid"`), but the same `_activate()` method explicitly does nothing for shop orders (`"not_a_package_payment"`) — there is **no fallback at all** for this product type, unlike packages.
- All three orders remained `"status": "pending"` in `GET /api/student/shop/orders/` for the rest of the session (well over 15 minutes after the confirmed-paid attempt, with no change) — the webhook that should flip `pending → paid` and generate the platform+school+referrer commission split never arrived. `GET /api/hq/shop-sales/` (HQ view of completed shop sales) shows no trace of any of these three orders either — confirming they never crossed the finish line anywhere in the system.
- **A real customer would be charged and receive nothing** — no order confirmation, no shipping, and (unlike the package case) **no automatic-on-return recovery is even coded**, so the gap can't self-heal even in the lucky case where the student stays logged into the same browser/account they paid with.

### 3.4 Discount code — ✅ works correctly

Created via `qa.school.owner` API (QA Test School had none configured):
- `QAWELCOME10` — 10% off packages, no expiry.
- `QAEXPIRED` — 15% off packages, `expires_at` in the past.

Tested against the QA Credit Pack (€25) checkout modal:
- Garbage code (`GARBAGE123`) → "Invalid code." ✅
- Valid code (`QAWELCOME10`) → **"Code QAWELCOME10 applied: −€2.50 / Total with the discount: €22.50"** ✅ (exact math correct: 10% of €25)
- The expired-code attempt was muddied the first time by a session-token swap mid-test (see §5) producing a misleading result; I flagged this to myself as unverified and did not re-test it in isolation given time constraints. **Not re-confirmed — treat as untested, not as a bug**, since the one clean result (valid code) proves the discount engine itself works, and the garbage-code path also works.

### 3.5 Declined card — ✅ works correctly, and it's Stripe's own message

- Session `cs_test_b1CXZchDgMHzNPmO3iN96Vx8tOgjf8kGtvjMybzgO5QCPWxUxmhWAO1k7J` (shop item, since it wasn't gated by Connect).
- Card `4000 0000 0000 0002` (generic decline). Stripe's hosted checkout page showed a clear, specific, localized error directly on the card field: *"Kredi kartınız reddedildi. Banka kartınızla ödeme yapmayı deneyin."* ("Your card was declined. Try paying with your debit card.") **before ever redirecting back to the app** — this is the correct and expected UX (decline handling happens entirely inside Stripe Checkout; the app never sees a broken response for this case, because the customer simply never leaves Stripe's page with a failed card). No "API error 400" or similar was ever shown for this path.

### 3.6 Purchase summary table

| Product | Type | Amount | Stripe result | App fulfillment | Verdict |
|---|---|---|---|---|---|
| QA Credit Pack | One-time package | €25.00 | ✅ paid (`pi_3UCqAt3zWjCsyE1110ggHmpr`) | ✅ 10 credits granted, 10% platform fee split correct on School Payments | ✅ Pass (fragile — see C-3) |
| QA Monthly Subscription | Recurring package | €49.00/mo | ✅ subscription created & charged | ❌ crash, nothing granted, invisible everywhere | ❌ **Critical fail** |
| Collezione Libri ×3 | Shop (HQ-level) | €16.99 each | ✅ ×1 confirmed paid, ×2 unconfirmed but same pattern | ❌ all 3 stuck "pending" forever | ❌ **Critical fail** |
| Collezione Libri (declined) | Shop | €16.99 | ❌ correctly declined by Stripe | N/A (never charged) | ✅ Pass |
| QAWELCOME10 on QA Credit Pack | Discount code | −€2.50 | (rolled into 3.1's successful purchase — discount was removed before the final purchase to keep the fee-split math simple to verify) | — | ✅ Pass |

---

## 4. Findings by severity

### 🔴 Critical

**C-1. Shop orders: real payment collected, order never fulfilled, no recovery path.**
See §3.3. Stripe confirms `payment_status: "paid"` for a real (test-mode) charge; `ShopOrder.status` stays `"pending"` indefinitely; the order never appears in HQ's shop-sales ledger; the app has zero fallback logic for shop orders (`StudentDocumentsView`/`VerifySessionView._activate` explicitly returns `"not_a_package_payment"` and does nothing). **A paying customer gets charged and receives nothing, with no automatic or self-service recovery.**
*Repro:* `POST /api/student/shop/checkout/` with any HQ-level product → complete Stripe Checkout with `4242…` → order stays `pending` in `GET /api/student/shop/orders/` indefinitely; `GET /api/stripe/verify-session/?session_id=…` on that session confirms `payment_status: "paid"` but `"activation": "not_a_package_payment"`.

**C-2. Subscription/recurring packages: real subscription created and charged, activation crashes, nothing granted.**
See §3.2. `backend/commerce/stripe_views.py:274`, `VerifySessionView._activate()`: `sub.get("current_period_end")` on a `stripe.Subscription` object raises `AttributeError` (100% reproducible, exact trace: `AttributeError: get @ _stripe_object.py:173 in __getattr__ — da stripe_views.py:274 in _activate`). No `StudentPackage` is ever created, no `Transaction`, nothing on the school's side either. This is the *only* code path meant to cover subscriptions when the webhook doesn't fire (per the code's own comment), and it's broken.
⚠️ **Cleanup needed**: a live Stripe test-mode Subscription for QA Test School / `h.timur+student1@executionai.net` exists and is not tracked in the app DB — cancel it directly in the Stripe test dashboard.

**C-3. Root cause: the Stripe webhook (`checkout.session.completed`, and by extension subscription events) does not appear to be processed on this dev environment.**
Evidence: the one-time package purchase in §3.1 only activated because I manually invoked the client-side `verify-session` fallback as the correct user — it did **not** activate automatically in the ~1 minute between payment and my check, and neither did any of the 3+ shop orders over 15+ minutes, nor the subscription (which has no working fallback at all). The code comment at `stripe_views.py:263-267` (Italian, from the team) already anticipates this: *"mai consegnato se l'endpoint non è configurato per l'ambiente, es. Sandbox"* ("[the webhook is] never delivered if the endpoint isn't configured for the environment, e.g. Sandbox"). **Recommendation: verify the Stripe webhook endpoint is actually registered and reachable for the dev environment's Stripe account/webhook secret, and add the same kind of return-triggered fallback to shop orders that packages already have (and fix the subscription branch of that fallback).**

### 🟠 High

**H-1. `documentsRequired` error message ships with a permanently empty placeholder.**
`frontend/src/app/[locale]/student/book/page.tsx`, two call sites (lines 471 and 522) both hardcode `t('documentsRequired', { documents: '' })`. The message template is `"Valid documents are needed to book: {documents}. Upload them from your profile."` (`frontend/messages/en.json:2508`). Live-reproduced: booking a lesson at a school with `block_booking_on_documents: true` and a missing required document shows *"Valid documents are needed to book: . Upload them from your profile."* — a dangling colon and empty gap where the actual missing-document name(s) should be. Confirmed via direct booking attempt (backend correctly returns `{"error":"documents_required"}`, frontend correctly catches it, but the interpolation value is wrong, not missing computation — the document names are available elsewhere in the booking-options payload and simply aren't being passed through).

### 🟡 Medium

**M-1. `DROP_IN_BOOKING.md` / CLAUDE.md's "conscious gap" list is stale — drop-in booking is actually implemented, not a proposal.**
CLAUDE.md §10 lists "Drop-in booking (tek ders satın al)" as *"DROP_IN_BOOKING.md'de teklif aşamasında, uygulanmadı"* (still a proposal, not implemented) and the task brief accordingly marked it out of scope. In fact the code has a complete, working implementation: `StudentLessonPurchaseOptionsView` (`GET /api/student/lessons/<id>/purchase-options/`) returns a `drop_in` object whenever a school flags a package `is_drop_in: true`, and `frontend/src/app/[locale]/student/book/page.tsx` has a full `buyDropIn()` function that opens a real Stripe Checkout session (`type: "package"`, with `lesson_id`) for a single-lesson purchase — even a code comment in `backend/students/views.py:299` cites *"DROP_IN_BOOKING.md §3.1"* as the design it follows. I verified this live: temporarily flagging QA Test School's package `is_drop_in: true` immediately made `purchase-options` return a populated `drop_in` object (then reverted the flag). QA Test School's course simply doesn't have one configured by default, which is why it wasn't visible in normal browsing. **This is a documentation-accuracy issue, not a functional bug** — but it means a future QA pass that treats "drop-in" as out-of-scope would be skipping a real, live, purchasable Stripe checkout path. Recommend updating CLAUDE.md/DROP_IN_BOOKING.md to reflect that it shipped.

### 🟢 Low / informational

**L-1. Explicit-locale URLs are silently overridden by the saved locale cookie.** Navigating directly to `/fr/student/book` while a `user_locale=es` cookie is set (e.g. from having used the language switcher) redirects to `/es/student/book`, not French. This is **intentional, coded behavior** (`frontend/src/middleware.ts:81-87`, "If URL has a locale and it differs from preferred, redirect to preferred"), not a bug — but it's worth documenting for future QA methodology: to test a specific locale reliably, clear the `user_locale` cookie (or test before ever touching the language switcher).

**L-2. Data hygiene, not a bug**: Danza Clásica Barcelona's package catalog still has multiple "(copy)", "(copy) (copy)" duplicate packages, as already documented in the prior QA round. Confirmed still present; not re-reported as new.

**L-3. Browser-autofill artifact during registration testing** (not an app bug): mid-way through filling the registration form, the Last Name field was silently populated with a concatenation of another QA agent's saved credentials (`qa.hq.suppStudent1ort@qa-nounder40.testQaSuite!2026`) by the browser's native autofill, sourced from the **shared browser instance** other agents are also using. Cleared and retyped via direct value-injection to avoid corrupting the test. This is exactly the shared-browser hazard the task brief warned about, manifesting as browser-chrome behavior rather than an app bug — flagged here only so the coordinator understands why some early registration-form screenshots (not included in this report) briefly showed garbage text.

---

## 5. The shared-browser-session hazard — what actually happened, and how I handled it

This was **not a hypothetical risk** in this run — it hit repeatedly and cost significant time to diagnose correctly:

- Multiple times, `localStorage.getItem('nu40_access')` in my tab decoded to a **different account's JWT** (`role: "school"`, `role: "hq"`, different `user_id`s each time) than the one I had just logged in as — because other parallel QA agents were actively logging in/out on the same origin in other tabs (`tabs_context` consistently showed 5-6 open tabs on `dev.danzaclassicanounder40.com`, several times one on `connect.stripe.com` — presumably the agent completing Stripe Connect onboarding).
- This caused two categories of false signals that I identified and ruled out before treating anything as a real bug:
  1. A **discount-code test** that initially appeared to fail even for a genuinely valid code — root-caused to a `401` from a mid-test token swap, not a discount-engine bug (re-tested cleanly afterward and confirmed the engine works, §3.4).
  2. Two **post-payment `verify-session` calls returning `403 not_your_session`** with the student-facing message "Payment received, but the package does not appear activated yet… contact your school" — root-caused to the browser being logged in as `qa.school.admin`/a different HQ account at the exact moment of the Stripe redirect, not a real authorization bug (the 403 itself is *correct* behavior for a mismatched session; re-calling the same endpoint as the correct student — via a fresh `curl` login — succeeded for the package case and reproduced a real crash, not a 403, for the subscription case).
- **Mitigation used throughout**: every UI action sequence began with `localStorage.clear()` + a fresh login (verified by decoding the resulting JWT payload before proceeding); every "surprising" result was independently re-checked with a brand-new `curl` + fresh login rather than trusted from the browser alone. This is exactly the protocol the task brief specified, and it worked — every finding in §4 was cross-verified this way, most of them via direct backend API calls that don't depend on browser session state at all (the `verify-session` calls that produced Findings C-1/C-2 are the clearest example: the `payment_status: "paid"` fact and the `AttributeError` stack trace are both server responses, immune to whatever the browser's `localStorage` happened to contain).

---

## 6. Detailed functional results (non-payment)

### 6.1 Registration (`/register`)

Tested with a genuinely new, real email: `h.timur+student1@executionai.net`.

- **Invalid email** (`not-an-email`) → blocked by native HTML5 `type="email"` validation before any request left the browser (confirmed via network log: zero `POST` requests fired). Browser's own validation tooltip happened to render in Turkish (browser-chrome locale, unrelated to the app).
- **Weak password** (`weak`, 4 chars) → app-level validation: *"Password too short (at least 8 characters)"*, no request sent.
- **Password missing a number** (`onlyletters`, 11 chars, letters only) → app-level validation: *"The password must contain letters and numbers"*, no request sent.
- **Mismatched confirm password** → *"Passwords do not match"*, no request sent.
- **Valid submission** (`QaStudent2026!`, matching, valid phone `+39 3311234567`) → account created, `201`, immediately logged in, landed on `/en/student/dashboard` with `0 Credits` / `0 Upcoming Lessons`.
- **No school selection step, and `active_school: null` after registration.** This is **by design**, not a bug: `frontend/src/app/[locale]/register/page.tsx` (comment at lines 71-72, 102-104) explicitly notes the single-form registration deliberately drops city/country/school fields — a student either lands from a "Book" deep link carrying `?school_id=` (auto-enrolled on finish) or links to a school later (via booking a lesson, which the backend auto-creates the `SchoolStudent` link for, or manually via `POST /api/student/school/`). Confirmed this works: `/student/book` correctly shows network-wide lessons for a school-less student, and booking/being granted credits at QA Test School correctly created the `SchoolStudent` link.
- **Welcome email**: `backend/accounts/views.py` (`RegisterView.post`) queues a Celery task `send_transactional_email_task(key="welcome", ...)` post-commit, containing a `profile_url` and `booking_url` (both signed via `student_email_link`) in the language the user registered in (`en`, since that was the active locale at registration time). **I could not verify actual delivery** — this session had no Gmail access (the connector reported "requires additional permissions" when I attempted a search). **Coordinator: please check the inbox for `h.timur+student1@executionai.net` for a "welcome"-keyed transactional email, in English, with working profile/booking links.**

### 6.2 Booking, credits, cancellation policy, no-show

All tested against **QA Test School**'s `QA Course` (1 credit/lesson, `cancellation_policy_hours: 24`), after manually granting 20 test credits via `qa.school.owner` → `POST /api/school/credits/grant/` (necessary since a brand-new student naturally starts at 0 and I didn't want to burn a real purchase's credits on booking tests before the purchase pipeline was even reachable).

- **Insufficient credit** (attempted booking at 0 credits): confirm-booking modal correctly showed **no "Book Now" button at all** — only "Buy a package and save (…this lesson would cost you €2.50)" pointing to Buy Packages, and "Cancel". No crash, no silent failure.
- **Outside cancellation policy** (cancelled a lesson ~3.2h before start, threshold 24h): modal warning text — *"⚠️ The lesson will not be refunded. Only 3.2 hours to the lesson, less than the 24 hours the school requires: outside its cancellation policy."* — exact hour count shown. Confirmed via API after confirming: `cancellation_type: "outside_policy"`, `credit_refunded: false`. Credit correctly stayed burned.
- **Within cancellation policy** (cancelled a lesson ~30h before start): modal warning text — *"✓ The lesson goes back into your package. You are cancelling more than 24 hours ahead: within the school's cancellation policy (24 hours)."* Confirmed via API: `cancellation_type: "within_policy"`, `credit_refunded: true`. Credit correctly went back into the package (17 → 18).
- **No-show**: moved a booked lesson into the past (via `qa.school.owner` lesson PATCH, to avoid waiting hours for a real lesson to elapse) and marked the student `no_show` via `POST /api/school/attendance/<lesson_id>/`. Confirmed: `booking_status: "no_show"`, credit balance unchanged (burned, no refund) — matches CLAUDE.md's "no-show always burns" rule exactly.

All three cancellation-policy outcomes match CLAUDE.md §4.4 precisely — this is the platform's most safety-critical money logic and it held up perfectly under direct testing.

### 6.3 Documents gating

- QA Test School initially had **no document types configured** (page correctly said *"This school does not ask for documents."* — clean empty state, not an error).
- Created a required `QA ID Document` type + turned on `block_booking_on_documents` via `qa.school.owner`.
- **Booking blocked** for the document-less student: backend `POST /api/bookings/` → `{"error":"documents_required"}`; UI surfaced this (with the placeholder bug from H-1).
- **Uploaded a real document** (`POST /api/documents/upload/` multipart, then `POST /api/student/documents/` to attach it) — Documents tab correctly flipped from "Not Uploaded" state.
- **Booking succeeded** immediately after upload, same lesson, same student, gating correctly lifted.
- Reverted `block_booking_on_documents` to `false` afterward to avoid affecting other agents' concurrent testing.

Both directions of the gate work correctly; only the error-message wording (H-1) is broken.

### 6.4 Waitlist / "Full" lesson state

Temporarily set a lesson's `max_capacity` equal to its existing booking count (2/2) and moved it to a future date to view it live. `/student/book` correctly showed **"Full"** with a **disabled** Book button (verified `button.disabled === true` in the DOM, not just visually greyed). Searched the entire rendered page for the word "waitlist" — zero matches anywhere. This is exactly the graceful, clean "conscious gap" behavior the task brief asked me to confirm — **not a bug.**

### 6.5 Support (FAQ + live chat)

- FAQ accordion (Italian locale): clicking a question correctly expanded it with the matching answer text, `+` flipped to `−`.
- Sent a real message to the school ("Ciao! Questo e un messaggio di test QA…") — appeared instantly in the student's chat view with a correct "Oggi" (Today) timestamp.
- **Verified school-side receipt** via `qa.school.owner` → `GET /api/chat/conversations/`: the conversation shows `"last_message": {"content": "Ciao! Questo e un messaggio di test QA…", "sender_role": "student"}`, `"unread_count": 1`. Full round-trip confirmed.

### 6.6 Profile / Address / Language

- Edited **Last name** on the Profile tab, saved, reloaded the page → persisted correctly.
- Filled all four **Address** fields (Address/Postal code/City/Province), saved, reloaded → persisted correctly.
- Switched language via the header flag dropdown (English → Spanish): the **entire app** (sidebar, dashboard, every label) re-rendered in Spanish instantly, the URL locale segment updated to `/es/`, and — importantly — `GET /api/auth/me/` confirmed `language_preference: "es"` was also updated server-side (the same switch drives both UI locale and the account's stored email-language preference; not two disconnected settings). Confirmed this persisted across a full page navigation to a different route.

### 6.7 Role isolation

With the student's own JWT:

| Endpoint | Result |
|---|---|
| `GET /api/hq/schools/` | `403` |
| `GET /api/school/team/` | `403` |
| `GET /api/school/profile/` | `403` |
| `POST /api/school/credits/grant/` | `403` |

All four correctly blocked. Clean.

---

## 7. What I could NOT test, and why

- **Stripe Connect onboarding readiness** was the expected blocker per the task brief, and it did block me for roughly the first ~70% of the session (everything except registration/booking/cancellation/insufficient-credit/documents/support/profile/i18n/role-isolation/waitlist, which don't need it). It resolved mid-session (another agent's work) and I retroactively completed all the purchase testing once it did — see §3 for full results including two new Critical bugs found specifically *because* Connect finally became available.
- **Gmail verification of the "welcome" email**: no Gmail connector access in this session (`mcp__…__search_threads` returned "This connector requires additional permissions"). Documented exactly what to look for in §6.1 for the coordinator to check manually.
- **Full literal every-page × every-locale sweep**: I spot-checked en/it/es/de across Dashboard, Book (calendar), Buy, Support, Profile, Packages rather than exhaustively re-rendering all 8 student pages in all 5 locales — time was prioritized toward the purchase pipeline once Connect unblocked, since real-money-path bugs are higher severity than a residual raw i18n key would be, and the earlier QA rounds had already swept i18n very thoroughly. No raw keys were found anywhere I did check.
- **`QAEXPIRED` discount code, retested in isolation**: my one test of it was contaminated by a mid-test session token swap (see §5) and I did not have time to cleanly re-isolate it afterward. The discount engine's other two paths (invalid code, valid code) both work correctly, so I have only medium confidence rather than full confidence in the expired-code path specifically — recommend a quick follow-up if this matters.
- **Drop-in booking end-to-end Stripe purchase**: I confirmed the feature exists and is wired correctly (Finding M-1) by toggling `is_drop_in` briefly and observing `purchase-options` respond, then reverted it — I did not run an actual Stripe payment through it, since doing so would have hit the exact same C-1/C-2/C-3 fulfillment gap already fully documented for regular packages, adding no new information for the time cost.
- **`/reset-password` end-to-end**: read the backend code (confirms a `password_reset`-keyed email is queued) but did not click through the live UI flow or check for the email.
- **`/select-role`, `/setup-account`**: these are part of the invited-team-member flow (school/teacher staff), not applicable to student self-registration, so not exercised.
- **Django Admin**: explicitly out of scope per the task brief.

---

## 8. Recommendations (priority order)

1. **Fix the Stripe webhook delivery gap (C-3) first** — everything else (C-1, C-2) is a symptom. Confirm the dev environment's Stripe webhook endpoint URL and signing secret are actually configured and reachable, and that `StripeWebhookView` is receiving and successfully processing `checkout.session.completed` / subscription events.
2. **Fix the subscription-activation crash (C-2)** at `backend/commerce/stripe_views.py:274` — `sub.get("current_period_end")` needs to handle the newer Stripe API shape (checking `sub.items.data[0].current_period_end` first, or wrapping in a safe getattr/dict-access pattern) — the code already has a secondary fallback for this exact case a few lines below (277-279) but the crash happens on the line *before* it ever gets used.
3. **Add a shop-order activation fallback (C-1)** mirroring what packages already have, so a webhook outage doesn't leave paid shop orders permanently stuck with zero recovery path.
4. **Fix the `documentsRequired` placeholder (H-1)** — pass the actual missing document name(s) instead of a hardcoded empty string, in both call sites in `frontend/src/app/[locale]/student/book/page.tsx` (lines 471, 522).
5. **Update CLAUDE.md / DROP_IN_BOOKING.md (M-1)** to reflect that drop-in booking is implemented, not just proposed — otherwise a future QA pass will keep skipping a real, live Stripe checkout path.
6. Locate and cancel the orphaned test-mode Stripe Subscription created during C-2 testing, directly via the Stripe dashboard.
