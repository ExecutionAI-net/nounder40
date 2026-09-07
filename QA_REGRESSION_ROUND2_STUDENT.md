> Round-2 live regression, 2026-09-07 — per-panel detail report written by the student/payments QA agent. Entry point: [QA_REGRESSION_ROUND2_SUMMARY.md](QA_REGRESSION_ROUND2_SUMMARY.md). Screenshots/result files referenced as `$SP/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round2-screenshots/](docs/qa/round2-screenshots/).

# QA Round 2 — Student panel & payments (live regression)

**Agent:** student-agent · **Playwright profile:** `student-agent` · **Inbox prefix:** `qa-r2-student-` · **Screenshot prefix:** `student-` (all in `$SP/shots/`)
**Tenant:** QA Test School `33807f7b-5c55-43e5-ab5a-e84794d07601` — Stripe Connect complete (`acct_1UCpDD3KWyx5LA5u`, "Hakan Sandbox"), platform fee 10 %, language it, cancellation policy 24 h, school min-notice 1 h (course "QA Course" overrides to 0 h)
**Accounts:** S1 `qa-r2-student-s1@uberip.com` (Italian, registered via UI deep link, student id `43b26342-cee9-4d00-8467-87cb9f3d2a7b`, user `511a643c…`), S2 `qa-r2-student-s2@uberip.com` (English, registered via UI, student id `d1d56c9b…`), owner `qa.school.owner@qa-nounder40.test` (fixtures, toggles, transactions), HQ `qa.hq.owner@qa-nounder40.test` (read-only: `/hq/shop-sales/`, `/hq/email-templates/`, `/hq/email-settings/`), round-1 `qa.student.a@…` (read-only, isolation targets)
**Environment:** https://dev.danzaclassicanounder40.com (develop @ 8153889) · Django `TIME_ZONE="UTC"` · browser TZ Europe/Rome (CEST, UTC+2) · Stripe test mode, card 4242… / decline 4000…0002
**Time window (UTC):** 2026-09-07 10:10 → 12:15

## 0. Executive summary
- **The Stripe webhook never activated anything on dev.** In three controlled runs (one-time package, recurring package, shop order) the payment was completed on Stripe's page, the return to the app was blocked, and the app was polled for ≥90 s: nothing was activated. Every fulfilment observed in this round came from the client-side `GET /api/stripe/verify-session/` fallback. Consequences: the shop (whose success URL carries no `session_id` and whose page never calls verify-session) leaves paid orders `pending` forever — C-5's new `activate_shop_order_payment()` is correct but is only reachable by calling verify-session by hand.
- **New Critical:** the recurring-package activation added for C-6 is not idempotent: every replay of `verify-session` on a subscription session (the packages page calls it on every load of the success URL, which stays in the browser history) **resets the package's credits to the full amount, resets `purchased_at`, and re-sends the receipt email**. Live: 7 → 8 credits, 3 receipt emails.
- **New High:** recurring payments create no `Transaction` (school Payments/Reports omit all subscription revenue); `GET /api/stripe/invoices/` returns 500 for a subscriber; the `free_first_lesson` benefit is unreachable from the student UI; the cancellation-policy decision runs in UTC while the UI and the schools think in local time (2 h drift in CEST: modal says "will not be refunded", server refunds).
- Everything else in the student panel held up: registration + validation, drop-in purchase end-to-end (payment → auto-booking → emails), discount codes (percentage/fixed/expired/garbage/case/wrong school), refund/burn policy math, multiple booking API, full lesson, min-notice, closure day, documents gating (H-8 fixed, names the document), no-show display, chat round-trip, profile/address/language, logout, select-role, M-7 (explicit URL locale wins), role isolation (clean 401/403/404), private documents (`?token=` only, cross-student 403), password reset (see §6), i18n (0 raw keys across 5 locales × desktop/mobile).

## 1. Coverage
| Page / flow | Sub-role(s) | Locales | Viewport | Result |
|---|---|---|---|---|
| `/register` (plain + `?next=/student/book?school_id=…` deep link) | S1 it, S2 en | it, en (+5 locales anonymous scan) | desktop, mobile | ✅ validation (9 cases), auto-enrolment, welcome emails it/en; ⚠️ IP throttle (env) |
| `/login` (form, forgot-password modes) | S2 | en (+5 anon) | desktop, mobile | ✅ |
| `/reset-password` | S2 | en | desktop | see §6 |
| `/student/dashboard` | S1 | en it es fr de | desktop, mobile | ✅ |
| `/student/book` (calendar, list, filters, school switcher, lesson detail modal, confirm modal, cancel modal, drop-in modal, anonymous modal) | S1, S2, anonymous | en it es fr de | desktop, mobile (390 px) | ✅ (findings: TZ drift, school_closed copy, spotsLeft plural, 500-lesson list) |
| `/student/bookings` (Upcoming/Past/Cancelled, cancel modal, drop-in return banner, no-show badge) | S1 | en it es fr de | desktop, mobile | ✅ |
| `/student/buy` (catalog, filters, purchase modal, discount field, start-choice modal, active subscriptions block, manage billing) | S1, anonymous | en it es fr de | desktop, mobile | ✅ UI; ❌ `/stripe/invoices/` 500 |
| `/student/packages` (Packages/History tabs, subscription badge, payment=success return) | S1 | en it es fr de | desktop, mobile | ✅ UI; ❌ replay bug (ST-R2-01) |
| `/student/shop`, `/student/shop/<id>`, cart | S1, anonymous | 5 locales | desktop, mobile | ⛔ hidden by HQ flag `student_shop_enabled=false` (redirects to dashboard); purchase tested through the cart's own API + Stripe page |
| `/student/support` (FAQ, chat: create, send, owner receipt/unread, owner reply, read) | S1 + owner | it (+5 scan) | desktop, mobile | ✅ |
| `/student/profile` (Profile / Documents / Address, language select, upload, delete-account button present) | S1 | it (+5 scan) | desktop, mobile | ✅ (finding: two language fields) |
| Header language dropdown, M-7 cookie test | S1 | it→es, fr, de | desktop | ✅ M-7 fixed |
| Logout, `/select-role` | S1 | it | desktop | ✅ |
| Stripe Checkout (hosted) — package, subscription, drop-in, shop, declined card, cancel link | S1 | en-US (Stripe locale) | desktop | ✅ |
| Stripe billing portal (`/api/stripe/portal/`, "Gestisci abbonamento", cancel subscription) | S1 | — | desktop | see §7 |
| Role isolation (HQ/School/Teacher APIs, other student's bookings/documents/sessions, unauthenticated) | S1, S2 | — | API | ✅ |
| Emails (welcome, after_purchase, booking_confirmed, booking_cancelled, credits_low, no_show, password_reset) | S1, S2 inboxes | it / en | — | ✅ delivered ≤ 4 s (copy gaps, duplicate receipt) |

## 2. Purchase table (all Stripe test mode, customer email `qa-r2-student-s1@uberip.com`, connected account "Hakan Sandbox")
| # | Product | Type | Amount on Stripe page | Checkout session | Stripe result | Activation path | Fulfilment verified how |
|---|---|---|---|---|---|---|---|
| P0 | QA R2 Drop-in Lesson (first attempt, filler failed before paying) | package (drop-in) | €9.00 | (id not captured; unpaid, expires in 24 h) | unpaid | none | — |
| P1 | QA R2 Drop-in Lesson, lesson L_DROPIN 2026-09-11 18:00 | package `is_drop_in` | €9.00 | `cs_test_a1ETsTlWzzuftKDlVnD9zS4WbJQGp1njzYoUKdI50VOe49ZT0KupZrpX4A` | paid 10:51:29Z, `pi_3UD0983zWjCsyE111ADTZChW` | **fallback** (bookings page verify-session 10:51:44Z → `package_activated_booked`) | StudentPackage `c4c332da…` 1/1 credit → 0 (exhausted); Booking `45455b3e…` confirmed, credits_deducted 1; Transaction `eb34ef9f…` €9.00 / fee €0.90 / school €8.10; UI banner "Pagamento riuscito! La lezione è prenotata…"; emails after_purchase + booking_confirmed 10:51:46Z |
| P2 | QA Credit Pack (webhook test — return blocked) | package | €25.00 | `cs_test_a1GLKwGL2kDRSTP9qjrR1hZJZ0zV3mMXv1oivuxayxaNASHn4VrmD0MFot` | paid 10:52:18Z, `pi_3UD09v3zWjCsyE110wIiaMk9` | **none for 91.8 s**, then manual verify-session 10:54:03Z → `package_activated` | Transaction `fe2297a1…` created 10:54:03.12Z €25 / €2.50 / €22.50; StudentPackage `61118f93…` 10 credits; email 10:54:03Z |
| P3 | QA Credit Pack + code QAWELCOME10 (−10 %) | package | **€22.50** | `cs_test_a1WuQ8eKfKlQGJkb66BULa3yLpp9V7fGIOjRWbbrMgKYPEc0GYEwdhW9Xu` | paid 10:54:53Z, `pi_3UD0CQ3zWjCsyE110znCDjlM` | fallback (packages page verify-session 10:55:08Z → `package_activated`) | Transaction `b8e93836…` €22.50 / €2.25 / €20.25; code usage_count 0→1; packages page "Pagamento riuscito", 20 credits; email "Importo: €22.50" |
| P4 | QA Credit Pack + code QAR2FIXED5 (−€5) | package | **€20.00** | `cs_test_a1YmHfMuKrVLa0rqV5B7OhBiDdmNli3uQd3PpkhCsL2wmgJnafh1zYkLOq` | paid 10:56:43Z, `pi_3UD0EB3zWjCsyE11004Py1Ek` | fallback (10:56:57Z) | Transaction `5fa83a64…` €20 / €2 / €18; usage_count 1; 30 credits |
| P5 | QA Monthly Subscription (webhook test — return blocked) | recurring package (Stripe subscription) | €49.00 / month ("Pay and subscribe") | `cs_test_a1W2LNvBecGTO5xkHFCluOTAIy1IL6D03MEyxVOPLWawjBRxcG7NXblZWB` | paid 10:57:09Z; **subscription `sub_1UD0Ef3zWjCsyE11GS9wous8`, customer `cus_VDR6yIvYdG3Bny`** | **none for 90.1 s**, manual verify-session 10:58:55Z → `recurring_package_activated` | StudentPackage `f1d64cdd…` 8/8, next_renewal 2026-10-07T10:57:10Z, badge "Abbonamento"; **no Transaction row**; portal shows invoice €49 paid; receipt email ×2 (10:58:55 + 10:58:57, second from the packages page call) then ×3 after replay |
| P6 | Collezione Libri (HQ product, school=null) + shipping | shop order `f3714549-6fda-4662-84a8-123163df5be3` | €16.99 (€12.00 + €4.99) | `cs_test_b1hhUOgkTW9UbBeyXPcxSdvCE4SGePoUe27tmEo1XAAE2XbfD41aSaQ4Qm` | paid 11:00:02Z | **none for 93.7 s** (return page never calls verify-session); manual verify-session 11:01:55Z → `shop_order_activated` | order status `paid`; ShopSale `941cde93…` in `/hq/shop-sales/` (qty 1, €12, shipping €4.99, commission 0, referrer 0, source online, stripe); no order email (none exists) |
| P7 | Collezione Libri, card 4000 0000 0000 0002 | shop order `7666d20d-ac3d-4740-a201-83b1b39adcf0` | €16.99 | `cs_test_b1S9q3J2iBUVb5MhaOd2zW1PtsoXbZQG8GkBE19LfRlQafGQ4q1KPxGXsM` | **declined on Stripe** ("Your credit card was declined. Try paying with a debit card instead.") | — | order stays `pending` in "I miei acquisti"; back link = `/student/shop?payment=cancelled` |
School-side totals after the round (owner `/school/reports/`): monthly_revenue €101.50 (= €9 + €25 + €22.50 + €20 + a €25 round-1 row), platform_fee_total €10.15 — the €49 subscription is absent.

## 3. Findings
### Critical
**ST-R2-01 — Replaying `verify-session` on a recurring package resets its credits and re-sends the receipt (student self-service credit refill).** NEW.
Where: `backend/commerce/webhooks.py::_handle_recurring_package_created` (`StudentPackage.objects.update_or_create(stripe_subscription_id=…, defaults=dict(credits_total=package.credits, credits_remaining=package.credits, purchased_at=timezone.now(), …))` + unconditional `notify_after_purchase`), reached from `stripe_views.py::VerifySessionView._activate` (C-6 fix) and from the webhook.
Repro (live): sub package `f1d64cdd…` 8.0 credits → book L_MULTI1 (`POST /api/bookings/`) → 7.0 → `GET /api/stripe/verify-session/?session_id=cs_test_a1W2LN…` at 11:04:29Z → `activation: recurring_package_activated` → credits_remaining **8.0**, purchased_at **11:04:30Z** (was 10:58:56Z), third "🛍️ Grazie! Il tuo pacchetto QA Monthly Subscription è attivo" email at 11:04:32Z. Same session id replayed for a one-time package answers `already_processed` (idempotent, `commerce/services.py`).
Impact: `frontend/src/app/[locale]/student/packages/page.tsx:126-152` calls verify-session on **every** load of `/student/packages?payment=success&session_id=…` (the URL is not stripped, unlike the bookings page) — the student refills a subscription to full credits by reopening the success URL from history/bookmarks; any late/retried `customer.subscription.created` webhook does the same. Also resets `credits_total`, `expires_at`, `starts_at`.
Evidence: §10 timeline; `$SP/student-buy-sub-result.json`; inbox ids `6a9e98f18f…`, `6a9e98f469…`, `6a9e9a4310…`.

**ST-R2-02 — Stripe webhook events are not delivered/processed on dev; all fulfilment depends on the browser coming back.** STILL OPEN (prior C-3 root cause) / C-5 NOT FIXED IN EFFECT.
Where: `POST /api/webhooks/stripe/` (`StripeWebhookView`), Stripe dashboard endpoint/secret configuration (not inspectable from here).
Repro: P2, P5, P6 above — return URL blocked with `page.route(...abort)` (P2/P5) or, for the shop, the return page simply never calls verify-session; polled `/api/student/packages/`, `/api/school/transactions/`, `/api/student/shop/orders/` every 5 s for ≥90 s: no activation. Manual verify-session activated all three. Even in the normal flows the return page did the activation 13–15 s after payment (P1, P3, P4), never the webhook.
Expected: `payment_intent.succeeded` / `customer.subscription.created` processed within seconds. Actual: never within the observation windows (up to 94 s; the shop order was still pending when verify-session was called).
Impact: one-time/recurring packages depend on the tab surviving the redirect; **shop orders have no automatic path at all** (success URL `/student/shop?payment=success` carries no session id, `shop/page.tsx` never calls verify-session) — paid, `pending` forever, invisible in HQ sales.
Evidence: `$SP/student-buy-pack-webhook-result.json` (`webhookPoll.elapsedMs 91809`, `verifyCallsDuringBlock []`), `$SP/student-buy-sub-result.json`, `$SP/student-buy-shop-buy-result.json` (`webhookPoll.elapsedMs 93741`), screenshots `student-pack-webhook-blocked.png`, `student-sub-webhook-blocked.png`.

### High
**ST-R2-03 — Recurring package payments never create a `Transaction`; school Payments/Reports omit subscription revenue.** NEW (prior round noticed "nothing in transactions" but attributed it to the crash).
Where: `commerce/webhooks.py::_handle_recurring_package_created` and `_handle_invoice_payment_succeeded` (no `Transaction.objects.create`), vs `commerce/services.activate_package_payment` for one-time packages.
Evidence: after P5, owner `GET /api/school/transactions/` lists 4 QA R2 rows (€9, €25, €22.50, €20) and no €49 / `sub_…` row; `/api/school/reports/` monthly_revenue 101.5. The student's `/api/student/packages/` row has `stripe_payment_id ""`. Silent wrong financial numbers for the school (fee split of €4.90 not recorded).

**ST-R2-04 — `GET /api/stripe/invoices/` → 500 for a student with a subscription.** NEW.
Where: `backend/commerce/stripe_views.py::InvoicesView.get` — `sub.current_period_end` / `sub["items"]["data"]` on stripe==15 objects (the same SDK change that broke C-6; `current_period_end` now lives on the subscription items). Reproduced 4× (every `/student/buy` load: `failed: ["500 …/api/stripe/invoices/"]` ×2 per load, plus direct curl → 500 HTML "Server Error (500)").
Impact: the "Abbonamenti attivi" card renders without next-payment date/amount and without invoice history (the page swallows the error), and every buy-page visit logs a server error.

**ST-R2-05 — `free_first_lesson` cannot be claimed from the student UI.** NEW.
Where: `frontend/src/app/[locale]/student/book/page.tsx:579-581, 686-707` — the confirm modal shows "Sì, Prenota Ora" only when a covering package/subscription exists; there is no `free_first_lesson`/`free_lesson_used` awareness anywhere in the frontend (grep). Backend `bookings/services.book_lesson:479-489` grants it first.
Repro: owner `PATCH /api/school/profile/ {free_first_lesson:true}` → S2 (0 credits, never booked) opens L_FULL: modal shows only "Buy just this lesson — €9.00 / Buy a package and save / Cancel" (screenshot `student-s2-free-first-modal.png`); `POST /api/bookings/` for the same lesson → 201 `access_source: free_lesson, credits_deducted 0`. A student who *has* credits gets the free lesson silently while the modal says "Crediti da detrarre: 1 credito". Flag restored to false.

**ST-R2-06 — Cancellation-policy / min-notice decisions run in UTC while lesson times are school-local; UI and server disagree by the TZ offset.** NEW.
Where: `backend/config/settings/base.py:301` `TIME_ZONE = "UTC"`; `bookings/services.py:35-36 _lesson_datetime()` (naive date+time made aware in UTC), used by `cancel_booking` (:535) and `assert_bookable` min-notice (:401); frontend `hoursUntil()` uses the browser zone (`book/page.tsx:54-56`, `bookings/page.tsx:35-38`).
Repro (live, CEST): lesson L_EDGE3 created for 2026-09-08 12:12 at 11:07:57Z (13:07 Rome) → booked → cancel modal: "⚠️ La lezione non viene rimborsata. Mancano **23.1** ore alla lezione, meno delle 24 ore…" with the red "Sì, annulla comunque" → API: `cancellation_type: within_policy, credit_refunded: true` (server computed 25.1 h). Card label "Non più rimborsabile" was also wrong. The reverse never happens (server is always 2 h more permissive in CEST), so: the school's 24 h policy is effectively 22 h for Italian students; min-notice is shifted the same way: probe at 12:09:51Z (= 14:09 Rome) — `POST /api/bookings/` for L_BURN ("14:00", started 9 min earlier in Rome) → **201** booking `f3787443…` (then cancelled: `outside_policy`, credit burned); a 14:00 Rome lesson stays bookable until 16:00 Rome, and already-started lessons remain listed/bookable for 2 h.
Impact: silent policy violation against the school, misleading warning to the student, bookings after start time.

### Medium
**ST-R2-07 — Documents gate accepts a fileless / unreviewed document as "valid".** NEW.
Where: `students/views.StudentDocumentsView.create` (no check that `files` is non-empty), `StudentDocument.status` default `valid`, `bookings/services._missing_required_document_names` (checks `status="valid"` only).
Repro: S2 `POST /api/student/documents/ {school, type_ref:<QA ID Document>, variant:"", files:[]}` → 201 `status:"valid", validated_at:null, files:[]`; with `block_booking_on_documents=true`, `POST /api/bookings/` → `no_valid_access` (gate passed; credits check reached); after `DELETE /api/documents/<id>/` → `documents_required`. Also every genuine upload is `valid` before the school reviews it (Documents tab shows "Valido" and "In Attesa di Revisione" side by side).

**ST-R2-08 — Two independent language fields: the header switch updates `User.language_preference`, the profile select updates `Student.language_preference`; booking/purchase emails follow the Student one.** NEW (prior round only checked `/auth/me/`).
Repro: header 🇮🇹→🇪🇸 → UI in Spanish, cookies `user_locale=es`/`NEXT_LOCALE=es`, `/api/auth/me/ language_preference: es`, but `/api/student/profile/ language_preference: it`; a booking made in that state (11:16:24Z) produced "✅ Prenotazione confermata…" and "💳 Il tuo pacchetto sta per finire…" in Italian. Profile select → it updates only the Student field (`/auth/me/` stays es). Welcome/password-reset use the User field, booking/purchase/no-show/credits_low use the Student field (`notify_after_purchase`, `_dispatch_email`).

**ST-R2-09 — Shop return URLs land on the dashboard with no message while the shop is disabled; success copy promises an email that does not exist.** NEW.
`/student/shop?payment=success` and `?payment=cancelled` → `router.replace('/student/dashboard')` (`shop/page.tsx:28-32`, `student_shop_enabled=false` from `/api/platform-stats/`) — the paying student sees neither "Pagamento completato" nor "Pagamento annullato". Independently, `student.shop.orderSuccess` says "you will get a confirmation email" but no shop-order template/key exists (`notifications/builtin_templates.py`, HQ `/hq/email-templates/` list) and none arrived for P6.

**ST-R2-10 — Registration/password-reset throttling is per client IP (5/hour) and the 429 is shown verbatim in English inside the form.** Environment effect in this round (all agents share one IP — coordinator notice), but the UX part is a product issue: `register/page.tsx:137-139` prints `err.body` values → "Request was throttled. Expected available in 1586 seconds." in the Italian form (`student-register-it-landed.png` first run). A class registering from one school Wi-Fi hits the same wall.

**ST-R2-11 — Network browse without a school filter renders every lesson (API cap 500) in one page, silently truncated.** NEW. Anonymous `/student/book` (no filter): `GET /api/student/lessons/` returns exactly 500 rows (Barcelona 251 + Milano 222 + …), the list under the calendar renders all of them (desktop page 96 414 px tall, 98 903 chars; mobile 118 980 px) with no pagination, no "more" indicator, no day pre-selected. Screenshot `student-anon-it-_student_book-mobile.png`.

**ST-R2-20 — Password validation has no similarity rule: a password equal to the account's email local part is accepted (reset, register, change-password).** NEW.
Where: `backend/config/settings/base.py:141-145` (`AUTH_PASSWORD_VALIDATORS` = MinimumLength, CommonPassword, Numeric only); `accounts/views.py::password_reset_confirm_view` maps `password_too_similar` codes that can never occur; `reset-password/page.tsx` carries the `passwordTooSimilar` copy in 5 locales.
Repro: reset flow with new password `qa-r2-student-s2` for `qa-r2-student-s2@uberip.com` → 200, login works. Expected: rejected as too similar (Django's `UserAttributeSimilarityValidator`).

### Low
- **ST-R2-12** `school_closed` booking error has no i18n key (`book/page.tsx BOOKING_ERROR_KEYS`) → generic "Prenotazione Non Riuscita" (live, closure 2026-09-15; API `{"error":"school_closed"}`).
- **ST-R2-13** `student.book.spotsLeft` has no ICU plural in any locale → "1 posti disponibili", "1 verbleibende Plätze", "1 lugares disponibles", "1 places restantes" (live on the full lesson card).
- **ST-R2-14** Spanish booking calendar month label "Septiembre De 2026" (CSS `capitalize` on `toLocaleDateString`, `book/page.tsx:1307`).
- **ST-R2-15** Email copy gaps: after_purchase "✨  lezioni (10 crediti)" (empty `lessons_total` for an all-types package) and "1 lezioni (1 crediti)" (no plural); booking_confirmed "📍 · " empty location line when the lesson has no room.
- **ST-R2-16** Chat message timestamps use 12-hour "01:19 PM" in the Italian UI.
- **ST-R2-17** Anonymous: `/student/dashboard` renders an empty page, `/student/bookings` shows tabs + empty state (packages shows a login prompt — inconsistent); every anonymous page logs 401 console errors (layout calls authenticated endpoints).
- **ST-R2-18** Declined/abandoned shop orders stay `pending` forever in "I miei acquisti" (order `7666d20d…`), no expiry/cleanup.
- **ST-R2-21** Today's already-past lessons stay listed with an enabled "Prenota" button (`/api/student/lessons/` filters `date__gte=today` only): the 05:52 lesson was clickable at 14:09 Rome; the API then answers `min_notice` → "Troppo tardi per prenotare questa lezione" (screenshot `student-mobile-book-calendar.png`).
- **ST-R2-19** Documents tab shows "Valido" and "In Attesa di Revisione" for the same freshly uploaded document (contradictory states; see ST-R2-07).

## 4. Re-verification of prior-round findings (live)
| Prior item | Verdict | Live evidence |
|---|---|---|
| **C-5** shop orders never fulfilled | **PARTIALLY FIXED — NOT FIXED IN EFFECT ON DEV.** `activate_shop_order_payment()` exists and works (manual `verify-session` → `shop_order_activated`, order `paid`, ShopSale row with shipping/commission), but nothing calls it automatically: the webhook did not arrive in 94 s and the shop return flow never calls verify-session (no `session_id` in `success_url`). A real customer's paid order stays `pending` (ST-R2-02). |
| **C-6** subscription activation crash | **VERIFIED FIXED (activation)** — `verify-session` on the subscription session returns `recurring_package_activated`, StudentPackage created with `stripe_subscription_id`, badge, portal OK — **but the fix is not idempotent (ST-R2-01, Critical)** and still creates no Transaction (ST-R2-03). |
| Webhook delivery (prior C-3 root cause) | **NOT WORKING on dev** — 0 webhook-driven activations in 7 payments; every activation came from verify-session (ST-R2-02). Whether the endpoint/secret is registered in the Stripe dashboard could not be inspected from here. |
| **H-8** documentsRequired empty placeholder | **VERIFIED FIXED** — "Per prenotare servono documenti validi: QA ID Document. Caricali dal tuo profilo." (UI) / `{"error":"documents_required","documents":["QA ID Document"]}` (API), both call sites (confirm modal + drop-in path share the same key). |
| **M-7** locale cookie overrides explicit URL locale | **VERIFIED FIXED** — with `user_locale=es` + `NEXT_LOCALE=es` cookies, `/fr/student/book` stays French and `/de/student/buy` stays German; only locale-less paths follow the cookie. |
| **M-8** drop-in documented as unimplemented | **VERIFIED (docs now accurate)** — drop-in purchased end-to-end via the UI: modal → Stripe €9.00 → auto-booking → "Pagamento riuscito! La lezione è prenotata" → confirmation email. |
| Calendar locale (was Turkish) | VERIFIED FIXED — it "Settembre 2026 LUN…DOM", de "September 2026 MO…SO", es "Septiembre De 2026" (capitalisation nit ST-R2-14). |
| Spots-left placeholder | VERIFIED FIXED — "10 posti disponibili" / "10 verbleibende Plätze" / "10 lugares disponibles" (plural nit ST-R2-13). |
| Stripe error translated (`school_not_connected`) | COULD NOT VERIFY LIVE — QA Test School cannot be un-connected and no other school with a package is unconnected (School B/C/E1/E2 have no packages; Milano/Barcelona are read-only). Static check: `student.buy.schoolNotConnected` / `student.book.schoolNotConnected` present in all 5 locale files. |
| Documents gating both ways | VERIFIED — blocked without a valid doc, unblocked after upload (but see ST-R2-07). |
| Cancellation policy math (CLAUDE.md §4.4) | VERIFIED for refund (>24 h), burn (<24 h) and no-show (burn) — with the 2 h UTC drift of ST-R2-06 at the boundary. |
| Role isolation | VERIFIED — see §7 table. |

## 5. Emails verified (recipient inboxes on mail.tm; times UTC; all from support@alinaquintana.com)
| Trigger | Inbox | Arrived | Subject | Locale | Links |
|---|---|---|---|---|---|
| Registration S1 (it) 10:48:10 | s1 | 10:48:14 (4 s) | 🩰 Benvenuta in Danza Classica No Under 40! | it ✅ | `/it/student/profile?for=…` → opens profile (booking_url not used by the HQ template) |
| Registration S2 (en) 11:15:02 | s2 | 11:15:04 | 🩰 Welcome to Danza Classica No Under 40! | en ✅ | `/en/student/profile?for=…` |
| Drop-in purchase (P1) | s1 | 10:51:46 | 🛍️ Grazie! Il tuo pacchetto QA R2 Lezione Singola è attivo | it ✅ | `/it/student/book?school_id=…&for=…` works |
| Drop-in auto-booking | s1 | 10:51:46 | ✅ Prenotazione confermata — QA Course, 11-09-2026 | it ✅ | `/it/student/bookings?for=…` works; "📍 · " empty line |
| Package P2 / P3 / P4 | s1 | 10:54:03 / 10:55:08 / 10:56:57 | 🛍️ Grazie! Il tuo pacchetto QA Credit Pack è attivo (Importo €25.00 / €22.50 / €20.00) | it ✅ | ok; "✨  lezioni (10 crediti)" empty lessons count |
| Subscription P5 | s1 | 10:58:55, **10:58:57 (dup)**, **11:04:32 (replay)** | 🛍️ Grazie! Il tuo pacchetto QA Monthly Subscription è attivo | it ✅ | ok — 3 copies for 1 purchase (ST-R2-01) |
| Booking confirmed (UI bookings ×4, API ×3) | s1 | +2–4 s each | ✅ Prenotazione confermata — QA Course, dd-mm-yyyy | it ✅ (also while `/auth/me/` said es → ST-R2-08) | ok |
| Booking cancelled ×3 (refund, burn, edge) | s1 | 11:08:07 / 11:08:13 / 11:08:21 | ❌ Prenotazione annullata — QA Course, … | it ✅ | — |
| credits_low (subscription reached 5 lessons) | s1 | 11:16:26 | 💳 Il tuo pacchetto sta per finire — 5 lezioni rimaste | it ✅ | — |
| No-show marked by owner | s1 | 11:18:40 | 👻 Ci sei mancata oggi — QA Course | it ✅ | — |
| Free first lesson booking (S2) | s2 | 11:16:48 | ✅ Booking confirmed — QA Course, 12-09-2026 | en ✅ | — |
| Password reset request (UI, en) 11:25:02 | s2 | 11:25:06 (4 s) | 🔑 Reset your password | en ✅ | `/en/reset-password?uid=…&token=…` opens the localized reset form ✅ |
| Shop order paid (P6) | s1 | — | **none** (no template exists; UI promises one — ST-R2-09) | — | — |
| School-side `school.new_booking` / `school.booking_cancelled` | qa.school@qa-nounder40.test | not readable (no inbox access) | templates exist in HQ (5 locales) | — | — |
Not triggered: package_expiring, lesson reminders, we_miss_you, document_expiring (Beat tasks), drop_in_booking_failed (race not reproduced), account_deleted (delete-account button present on Profile; not exercised to keep S1 for evidence).

## 6. Password reset (S2, UI) — VERIFIED END-TO-END
- `/en/login` → "Forgot password?" → unknown email `qa-r2-nobody-xyz@uberip.com` → `POST /api/auth/password-reset/` 200 `{found:false}` → form shows "We can't find this email in our database…" (deliberate enumeration trade-off documented in `accounts/views.py`).
- Real email (11:25:02Z) → `{found:true}` → "Check your email / We sent a password reset link to …" → email at 11:25:06Z (English, `/en/reset-password?uid=…&token=…`).
- Reset page renders in the email's locale; client validation "Password too short (at least 8 characters)" works (`student-reset-weak.png`).
- Submitting `qa-r2-student-s2` (identical to the email local part) was **accepted** (200 with tokens → auto-login → `/student/book`): the old password is rejected afterwards (401 "No active account found with the given credentials"), reusing the link lands on `/en/login?error=reset_expired` → "This reset link has expired or was already used. Request a new one below." (single-use token ✅), `POST /api/auth/change-password/` with that value as `current_password` → 200 "password updated" (wrong current → 400 "current password is incorrect"), and `POST /api/auth/login/` with the new value → 200. S2's password is now `QaRound2!2027`.
- See ST-R2-20: the "too similar to your name or email" rule the reset page translates (`auth.resetPassword.passwordTooSimilar`) is not enforced server-side.

## 7. Role isolation (S1 student token unless noted)
| Target | Result |
|---|---|
| `GET /api/hq/schools/`, `/hq/shop-sales/`, `/hq/students/`, `/hq/packages/`, `/hq/email-settings/`, `POST /hq/schools/` | 403 `HQ only.` |
| `GET /api/hq/team/`, `/hq/permissions/`, `/hq/transactions/` | 403 (permission class) |
| `GET/PATCH /api/school/profile/`, `/school/students/`, `/school/transactions/`, `/school/team/`, `/school/packages/`, `/school/lessons/`, `/school/credits/grants/`, `/school/documents/`, `POST /school/credits/grant/` | 403 `not_a_school_member` |
| `GET /api/teacher/profile/`, `/teacher/lessons/`, `/teacher/compensation/`, `/teacher/library/` | 403 `No teacher profile…` |
| `POST /api/stripe/onboard/`, `GET /stripe/onboard/status/` | 400 `no_active_school` |
| `POST /api/stripe/refund/` (bogus id) | 404 `not_found` |
| `DELETE /api/bookings/<qa.student.a booking>/` ×2 | 404 `not_found` (no existence leak beyond own bookings) |
| `GET /api/documents/<S2 doc>/`, `DELETE`, `GET …/file/?path=` | 403 `Not your document.` |
| S2 document file without `?token=` | 401; with S1's `?token=` | 403; direct `/media/private/<path>` | 404 |
| `GET /api/stripe/verify-session/?session_id=<round-1 student's session>` | 403 `not_your_session` |
| Unauthenticated `/student/profile/`, `/student/packages/`, `/student/bookings/`, `/stripe/checkout/`, `/student/shop/checkout/` | 401 |
| `GET /api/student/documents/` (S1) | only own rows (empty until the H-8 upload) |
No 5xx anywhere in the isolation battery.

## 8. Test data created (all on QA Test School unless noted) — left in place unless stated
**Accounts:** S1 `qa-r2-student-s1@uberip.com` / `QaRound2!2026` (Student `43b26342-cee9-4d00-8467-87cb9f3d2a7b`, User `511a643c-8aea-4371-9943-05d48c89d922`, school QA Test School, last name currently "StudentUno-Edit", address "Via QA R2 1 / 20121 / Milano / MI"); S2 `qa-r2-student-s2@uberip.com` / **`QaRound2!2027`** (changed by the reset test; Student `d1d56c9b-792e-4d38-b363-841b305b4933`, User `c8848cfb-57d9-485c-a4d1-0fe49d4e347a`, linked to QA Test School, free lesson used).
**Lessons (QA Course, notes prefixed "QA R2"):** L_NOTICE `2caf87cb…` (07 Sep 13:45), L_BURN `8b9a4f1d…` (07 Sep 14:00), L_EDGE `570f9edd…` (08 Sep 11:30, unused), L_EDGE2 `44cb5c64…` (08 Sep 12:09, unused), L_EDGE3 `dabea2fc…` (08 Sep 12:12), L_REFUND `dadedf5e…` (10 Sep 18:00), L_DROPIN `108efa1f…` (11 Sep 18:00, S1 booked via drop-in), L_FULL `ec0e64a9…` (12 Sep 18:00, cap 1, S2 free-lesson booking → full), L_MULTI1 `22ffc49d…` (13 Sep, S1 booked), L_MULTI2 `86ccacb3…` (14 Sep, S1 booked), L_CLOSED `03bfc3fd…` (15 Sep), L_DOCS `d916dc87…` (16 Sep, S1 booked), L_NOSHOW `727467b2…` (moved by owner to 07 Sep 06:00–07:00, status completed, S1 no-show).
**Bookings S1:** confirmed `45455b3e…` (drop-in), `6ffacc20…`, `626db45e…`, `2d6b268c…`; cancelled `b794bd54…` (refund), `fb8c0a7b…` (burn), `87f826ab…` (edge, refund), `783b5120…` (refund, from Bookings page); no-show `393590fb…`. S2: `486b15e7…` (free_lesson).
**Packages/codes:** package "QA R2 Drop-in Lesson / QA R2 Lezione Singola" `0ca4fc07-79e4-451b-a283-4672c2807c42` (€9, 1 credit, is_drop_in, active); discount code `QAR2FIXED5` `3d1a45f9…` (fixed €5, packages, usage 1). Pre-existing codes QAWELCOME10 (usage 0→1) and QAEXPIRED untouched.
**StudentPackages S1:** drop-in `c4c332da…` (exhausted); QA Credit Pack ×3 `61118f93…`, `e2287ded…`, (P4 id in `$SP/student-buy-pack-fixed-result.json`); subscription `f1d64cdd…` (4/8 credits, active, `sub_1UD0Ef3zWjCsyE11GS9wous8`).
**Transactions (school):** `eb34ef9f…` €9, `fe2297a1…` €25, `b8e93836…` €22.50, `5fa83a64…` €20. **Shop orders:** `f3714549…` paid (ShopSale `941cde93…`), `7666d20d…` pending (declined).
**Documents:** S1 `f429b49d…` (QA ID Document, `qa-r2-doc.pdf`, valid/unreviewed); S2 fileless doc `77de2169…` **deleted** by S2 during the test.
**Chat:** conversation `d6d6ab46-050b-4d01-b782-f40293f6aec0` (school_student) with 1 student + 1 owner message (marked read). A stray owner reply posted by mistake into round-1 conversation `c2c66919…` was **deleted** (`DELETE /api/chat/messages/ec39c003…/` → 204).
**School settings touched and restored:** `free_first_lesson` true→false, `block_booking_on_documents` true→false (twice), course "QA Course" `min_booking_notice_hours` 0→4→0, closure `0e8be791…` (2026-09-15) created→deleted. Verified restored at 11:20Z (`free_first_lesson False, block_booking_on_documents False, min_notice 1`).
**Stripe test-mode objects (cleanup list):**
- Subscription **`sub_1UD0Ef3zWjCsyE11GS9wous8`** (customer `cus_VDR6yIvYdG3Bny`, `qa-r2-student-s1@uberip.com`, "QA Monthly Subscription" €49/month, next billing 2026-10-07) — **STILL ACTIVE**: the billing-portal cancellation could not be completed by automation (Stripe's mandatory "reason" dropdown); cancel it in the Stripe dashboard of the platform account / connected account "Hakan Sandbox". Note the app would not learn about the cancellation anyway (no webhook).
- Checkout sessions (paid): `cs_test_a1ETsT…0KupZrpX4A` (€9), `cs_test_a1GLKw…D0MFot` (€25), `cs_test_a1WuQ8…hW9Xu` (€22.50), `cs_test_a1YmHf…YkLOq` (€20), `cs_test_a1W2LN…blZWB` (subscription), `cs_test_b1hhUO…aQ4Qm` (shop €16.99). Unpaid/expiring: one drop-in session from the first attempt (id not captured), `cs_test_b1S9q3…GXsM` (declined shop).
- PaymentIntents: `pi_3UD0983zWjCsyE111ADTZChW`, `pi_3UD09v3zWjCsyE110wIiaMk9`, `pi_3UD0CQ3zWjCsyE110znCDjlM`, `pi_3UD0EB3zWjCsyE11004Py1Ek`, shop PI (not exposed by the API), one declined PI.
- One Stripe Price object created by the subscription checkout (`stripe.Price.create`, name "QA Monthly Subscription"); Link "Save my info" left unchecked; Stripe's sandbox "I am an AI agent acting on behalf of someone else" checkbox left unchecked.
**Inboxes:** mail.tm `qa-r2-student-s1`, `-s2`, `-s3` (s3 unused).

## 9. Not tested / limitations
- **Not-connected school error message**: cannot be reproduced without un-connecting QA Test School or creating packages on another agent's school; static i18n presence verified only.
- **School-level shop product** (commission split to a school + referrer): none exists on QA Test School (`shop_commission_percentage` is 0 anyway); only the HQ-level product was bought.
- **Shop UI** (product page, variants, cart modal, "I miei acquisti" tab): unreachable while `student_shop_enabled=false` (HQ platform setting; my HQ access was read-only, so I did not flip it). Purchase exercised through the cart's own API call + Stripe + return URL.
- **School-side booking emails** (`school.new_booking`, `school.booking_cancelled`) go to `qa.school@qa-nounder40.test`, not readable.
- **Subscription renewal / invoice.payment_failed / grace period** need a billing cycle; not testable live.
- **Subscription cancellation reflected in the app**: portal cancellation not completed (automation), and with no webhook the app could not reflect it anyway.
- **iCal student feed**: `Student.ical_token` is not exposed by any student endpoint or page (`/auth/me/`, `/student/profile/` have no such field) → feature unreachable; only the public school feed (`/api/calendar/<school>.ics`, 200, 22 VEVENTs) and the 404 for a bogus student token were checked.
- **Password reset**: budget of one request; the login with the intended new value was recovered only via change-password (§6).
- **Delete account**, Google login, PWA install prompt: not exercised.
- **Multiple booking UI**: no multi-select exists in the UI; API only.
- Anonymous shop, notifications bell (`aria-label` present, no page — conscious gap), HQ-side refund of my transactions: not exercised.

## 10. Assumptions / decisions
- Coordinator rules applied from 10:48Z: cached tokens + `/auth/refresh/` (one forced re-login for S1 when its rotated refresh token was blacklisted, one for the HQ owner, one for `qa.student.a`), ledger entries for every register/reset request, ≤2 registrations, ≤1 reset.
- Browser timezone left at the host's Europe/Rome to mirror a real Italian student; server UTC. All UTC timestamps in this report come from the API/inbox; "Rome" times are marked.
- The 90 s webhook window is my choice (Stripe normally delivers in < 5 s); the shop order was additionally observed for 94 s.
- S2's account was used for the second-student cases (free first lesson, full lesson, insufficient credits, isolation document, password reset); `qa.student.a` was only read.
- Owner-side toggles were reverted immediately after each check (see §8); the HQ `student_shop_enabled` flag was NOT changed.
- Registration/login/reset 429s are treated as an environment effect of the shared IP (documented once as ST-R2-10 for the untranslated message).

## 11. Screenshot index (`$SP/shots/`)
Registration: `student-register-it-empty/validation/filled/landed.png`, `student-register-en-landed.png`. Anonymous: `student-anon-<loc>-_student_<page>[-mobile].png` (80), `student-anon-confirm-modal-it.png`, `student-anon-login-prompt.png`, `student-anon-lesson-detail.png`. Purchases: `student-dropin-modal-it.png`, `student-dropin-stripe-filled.png`, `student-dropin-return-bookings.png`, `student-buy-page-it-webhook.png`, `student-buy-modal-it.png`, `student-pack-stripe-webhook-filled.png`, `student-pack-webhook-blocked.png`, `student-buy-modal-pct/fixed.png`, `student-pack-stripe-pct/fixed-filled.png`, `student-pack-return-pct/fixed.png`, `student-sub-startchoice-it.png`, `student-sub-stripe-filled.png`, `student-sub-webhook-blocked.png`, `student-sub-packages-page.png`, `student-sub-buy-page-after.png`, `student-sub-billing-portal.png`, `student-shop-stripe-buy-filled.png`, `student-shop-return.png`, `student-shop-stripe-declined.png`, `student-shop-cancelled.png`, `student-buy-cancelled.png`, `student-portal-*.png`. Bookings: `student-book-list-it.png`, `student-book-refund/burn/edge-modal|after.png`, `student-cancel-refund/burn/edge-modal.png`, `student-bookings-upcoming/cancelled-it.png`, `student-bookings-cancel-modal.png`, `student-bookings-after-cancel.png`, `student-s2-free-first-modal.png`, `student-s2-insufficient-modal.png`, `student-book-full-it.png`, `student-book-notice/closed/docs-blocked/docs-ok-modal|after.png`, `student-profile-documents-before/after.png`, `student-bookings-past-noshow.png`, `student-packages-history-it.png`. Pages: `student-<loc>-_student_<page>[-mobile].png` (90), `student-mobile-book-calendar.png`, `student-mobile-book-filters-open.png`, `student-mobile-drawer-open.png`. Profile/support: `student-profile-it.png`, `student-profile-address-it.png`, `student-language-dropdown.png`, `student-after-language-es.png`, `student-m7-fr-with-es-cookie.png`, `student-support-it.png`, `student-support-sent.png`, `student-support-reply.png`, `student-dashboard-unread-badge.png`, `student-after-logout.png`. Reset: `student-forgot-form.png`, `student-forgot-unknown.png`, `student-forgot-sent.png`, `student-reset-page.png`, `student-reset-weak.png`, `student-reset-reuse.png`.
Result JSON/API evidence: `$SP/student-*-result.json`, `$SP/student-isolation-result.txt`, `$SP/student-anon-scan.json`, `$SP/student-pages-scan.json`, `$SP/student-register-result.json`, `$SP/student-fixtures.json`.
