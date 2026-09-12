# QA Regression Round 4 — Cross-cutting agent report

> **Artifacts note (coordinator):** paths written as `$SP/...` refer to the QA session scratchpad (Playwright profiles, scripts, ~2,000 screenshots and text dumps) which is not committed; the key-evidence screenshots named in this report are in [docs/qa/round4-screenshots/](docs/qa/round4-screenshots/). Round-4 environment: dev `develop @ f4155c9`, 2026-09-11.

**Agent:** `xcut` (authorization matrix, cross-tenant isolation, WebSockets, public surface, auth flows, robustness)
**Profile:** finding IDs `X-R4-NN`, data prefix `QA R4 X` / `qa-r4-x-`, screenshots `xcut-*`.
**Tenant (mine):** QA R4 School E1 `57cc25d1-2253-4ab0-8386-fd13f8ef6ec2` (owner/founder `qa-r4-school-e1@uberip.com`, `QaRound4!2026`), built from empty into the full fixture set (§6).
**Attacker tenant:** round-3 E1 `a89e1e5a-7893-48bd-a8a5-3f16e2387f51` (`qa-r3-school-e1@`, `qa-r3-x-e1-{staff,teacher,student}@`, `QaRound3!2026`) — read-only probes against my ids, all reverted.
**Accounts (16 tokens):** anon, 7× `qa.hq.{owner,super_admin,support,tech_support,finance,analytics,operations}`, E1 owner/staff/teacher/student, attacker owner/staff/teacher/student. Every token validated with `qa.whoAmI` before use.
**Environment:** https://dev.danzaclassicanounder40.com — `develop @ f4155c9` (CI run 34468639545). Real EC2 stack, Stripe TEST mode.
**Time window (UTC):** 2026-09-11 18:31 → 21:05.
**Method:** full fixture build via the real flows (staff+teacher invites by e-mail, 1 self-registration, real PDF document, course/lessons, bookings, 4 chat threads, credit grant); **5,786-request authorization/isolation matrix** (16 tokens × ~330 endpoint variants incl. every write verb + PUT + `?school=` overrides, `crosscut-matrix-r4.json` / `-condensed.md` / `matrix-r4-anomalies.json`); WebSocket probe (calendar + chat + inbox, 90+ handshakes + live relay); R3 security re-verification suite; public-surface sweep; malformed-body/path-id/pagination sweep; auth-flow suite; robustness (concurrent last-seat booking, double-cancel, unicode/emoji chat, grant additivity); 1 password-reset e2e. Budgets used: **1 self-registration** (`qa-r4-x-e1-student@`), **1 password reset**.

---

## 0. Executive summary

Every round-3 cross-cutting fix in my scope holds live: R3-C1 (HQ team hierarchy on PUT/PATCH/DELETE/invite — all narrow roles 403, owner/super rows unchanged), R3-C2 (image allow-list — html/svg/lying-png/magic-splice all 400, real png/jpeg stored by magic-byte extension, served with `nosniff` + `default-src 'none'; sandbox`, cross-tenant 403), R3-H1 (narrow HQ 403 on `/api/documents/*` incl. file + delete; owner/super/operations still work; cross-tenant 403; traversal/path-guess 404), R3-H2 (staff/teacher/student/narrow-HQ refused on `/stripe/onboard/`, and two concurrent owner calls produced **exactly one** account `acct_1UEZQbKWw09Twzen` — no orphan, no leaked Python error), R3-H4 (founder role-change/delete refused even by a co-owner; promotion reversible), R3-M10 (student self-profile mass-assign closed; `/auth/me` ignores role/email/active_school/password), R3-M11 (timezone value validated), R3-M13 (calendar WS refuses support/tech/finance/analytics), R3-L11 (chat-create gate, empty-row refusal, case-insensitive login, simulate bounds, typed chat content). **Cross-tenant isolation is clean across all 5,786 combinations: zero E1 identifiers in any attacker-token response, every `?school=<E1>` override ignored for the attacker, every attacker-vs-E1 object → 401/403/404, no successful cross-tenant write.**

New/residual issues: **(High) a co-owner can rewrite the founder's login e-mail** through `PATCH /api/school/team/` — R3-H4 guarded only role-change and delete, not the identity fields, so the same account-takeover-via-email pattern R3-C1 closed on the HQ side is still open on the school side. **(Medium)** `School.timezone` is writable by any member incl. a `staff` with no `settings` permission (silent booking-policy drift — the R3-M11 value-validation fix does not gate *who* may write it); R3-M8 is only partly fixed (a top-level JSON **array** body, and objects with wrong-typed fields, still 500 on ~13 endpoints, 5 of them anonymous); R3-M12 is only partly fixed (unroutable-but-RFC-valid invite addresses still create ghost users, and an over-long address 500s). **(Low)** teacher self-profile serializer is over-permissive (own `active`/`photo_url` writable); a concurrent duplicate `(school, code)` create 500s on an uncaught IntegrityError; `staff` still reads `owner`/`ical_token`/`grace_period_days`/`free_trial_ends_at` on `GET /school/profile/`.

Counts: **Critical 0 · High 1 · Medium 3 · Low 3.** R3-L12 (HSTS `includeSubDomains`) is still NOT live.

---

## 1. Coverage table

| Area | What ran | Tokens | Result |
|---|---|---|---|
| Authorization matrix | ~330 endpoint variants × 16 tokens = 5,786 requests (incl. PUT verbs, `?school=` overrides, image endpoints) | all 16 | dist 200/201/204/400/401/403/404/405 + 2 unexpected 500 + 4 expected 503; 0 real cross-tenant leaks |
| R3 security re-verify | C1, C2, H1, H2, H4, M8, M10, M11, M12, M13, L11, L12 | all | §3 |
| WebSockets | `/ws/calendar/school|teacher/<id>/`, `/ws/chat/<4 threads>/`, `/ws/inbox/`, `/ws/nope/` — anon, wrong-tenant, wrong-role, expired/tampered/refresh-as-access, forged `as=`, Authorization/Cookie header; live relay | 15 | isolation clean; §3/§5 |
| Public surface | security headers on 10 URLs, CORS ×4, docs gating ×6 tokens, 26 misc paths, media/public headers, iCal, TRACE/Host/http→https/9KB query/20KB header | anon+all | §5; HSTS gap §3 |
| Auth flows | login variants, alg=none/tamper, refresh rotation+blacklist, logout, google, complete-invite reuse/wrong-uid, password reset e2e, mass-assign | fresh pairs | §3/§5 |
| Robustness | array/scalar/wrong-typed bodies (55 shapes), path-id `x`, pagination `?page=0/-1/1e9`, unicode/emoji/6KB chat, 5KB name, concurrent last-seat booking, double-cancel, grant additivity | owner/student/anon | §2/§5 |

---

## 2. Findings

### HIGH

**X-R4-01 (High) — A co-owner can rewrite the founder's login e-mail (and phone/name) via `PATCH /api/school/team/`; R3-H4 guarded only role-change and delete.**
- Where: `backend/schools/views.py::SchoolTeamView.patch` (lines ~709-755). `_is_founder_membership()` is consulted only inside the `role_changes` branch and in `delete()`. The e-mail write below it (`user.email = new_email`, with only a "shared account" guard and a uniqueness check) has **no founder guard**.
- Repro (E1, all via API, `qa.whoAmI`-checked): founder = `School.owner` = `qa-r4-school-e1@uberip.com` (membership id 46). Founder promotes staff to a co-owner: `PATCH /school/team/ {id:49, school_sub_role:"owner"}` → 200 (only an owner may do this — verified `only_owner_assigns_owner` for non-owners). The co-owner (`qa-r4-x-e1-staff@`, now sub_role owner) then `PATCH /school/team/ {id:46, email:"qa-r4-x-hijack@uberip.com"}` → **200**, response `email: qa-r4-x-hijack@uberip.com`; `GET /auth/me/` on the founder's token then returns `email: qa-r4-x-hijack@uberip.com` (proving the login credential `User.email` was moved, not just a display copy). `PATCH {id:46, phone:"+39000000011"}` by the co-owner → 200 too. The co-owner correctly **cannot** delete or demote the founder (`cannot_remove_founder` / `cannot_change_founder_role`, 403).
- Expected vs actual: R3-H4's stated goal is that "the founder cannot be locked out by a peer owner" — but rewriting the founder's login e-mail to an unused address, then running the public `POST /auth/password-reset/` against it, is a full takeover of the school owner, defeating the protection. On the HQ side the sibling fix (R3-C1 `_hq_hierarchy_guard`) blocks **any** field write on an owner-equivalent target; the school side does not.
- Impact: within-tenant privilege escalation / account takeover of the founder by a co-owner. Reachability: requires an owner-grade co-owner (a co-owner can itself mint further co-owners, since "only owner assigns owner" and a co-owner is an owner).
- Evidence: `state.json → tz_email_founder.{promote_staff_to_owner, coowner_rewrite_founder_email, coowner_patch_founder_phone, founder_after}`, apilog `coowner-patch-founder-email`, code `schools/views.py:731-745`. Reverted: founder e-mail/phone restored, co-owner demoted to staff (verified `team_final` = `46:qa-r4-school-e1@:owner, 49:qa-r4-x-e1-staff@:staff`).
- vs R3: **PARTIAL fix of R3-H4** (role/delete verified fixed; identity-field write on the founder still open).

### MEDIUM

**X-R4-02 (Medium) — `School.timezone` is writable by any school member, incl. a `staff` with no `settings` permission → silent booking-policy drift (R3-M11 validates the *value* but not *who* may write it).**
- Where: `backend/schools/views.py::SchoolProfileView.patch`. The field gate splits into `_SCHOOL_HQ_ONLY_FIELDS` (→403), `_SCHOOL_SETTINGS_FIELDS | _SCHOOL_IDENTITY_FIELDS` (→ needs `settings`). `timezone` is in **none** of the three sets, so it falls through both gates for every member.
- Repro: baseline `Europe/Rome`. `qa-r4-x-e1-staff@` (sub_role staff; `PATCH {cancellation_policy_hours:48}` → 403 `forbidden`, `PATCH {name:...}` → 403) sends `PATCH /school/profile/ {timezone:"Europe/Paris"}` → **200**; `GET` as owner confirms `timezone: Europe/Paris`. Restored to `Europe/Rome`.
- Impact: `bookings/services.py::_lesson_datetime` interprets every lesson's naive date+time in `School.timezone`; a staff member can shift the whole school's cancellation-window / min-notice wall clock by any UTC offset — the exact R2-H14/R3-M11 policy drift, now reachable by an under-privileged role and invisible. Value validation (Mars/Olympus→400, blank/null/lowercase/list/>60char→400) is correct.
- Evidence: `state.json → tz_staff_reverify` (`staff_patch_timezone_status:200`, `timezone_after_staff_patch:"Europe/Paris"`, `restored:"Europe/Rome"`), `staff_profile_fields`. Reverted.
- vs R3: NEW (adjacent to R3-M11 — the value check was added, the field was not added to a permission set).

**X-R4-03 (Medium) — R3-M8 is partial: a top-level JSON *array* body, and objects with wrong-typed fields, still return HTTP 500 on ~13 endpoints, 5 of them anonymous.**
- Where: `core/parsers.py::ObjectOrArrayJSONParser` deliberately lets a top-level list through (attendance needs it), so `[1]`/`[1,2]` reaches a hand-rolled `request.data.get(...)` and `[1].get` is an AttributeError (500). Separately, objects with list-valued fields blow up inside untyped decode/token paths.
- Repro (all → 500 `Server Error (500)` HTML, no traceback leak):
  - Anonymous: `POST /auth/password-reset-confirm/`, `/auth/complete-invite/`, `/auth/logout/`, `/auth/password-reset-validate/`, `/auth/google/` with body `[1,2]`; and `password-reset-confirm`/`complete-invite`/`password-reset-validate` with `{"uid":[1],"token":{...},"new_password":[1]}`.
  - Authenticated (owner): `POST /school/team/`, `/school/teachers/`, `PATCH /school/profile/`, `POST /school/classes/`, `/school/quick-replies/`, `/school/packages/`, `/school/locations/`, `/school/document-types/` — all with body `[1]` → 500. (Scalar bodies `"str"`/`42`/`null` are correctly 400, and `{}` empty is correctly 400 — those halves are fixed.)
- Impact: unauthenticated 500s (noise, monitoring, mild DoS surface); no data corruption, no stack trace. Same finding family as R3-M8.
- Evidence: `state.json → anon_bodies` (15×500), matrix row `POST /school/document-types/ [1] → 500`.
- vs R3: **PARTIAL fix of R3-M8** (scalar bodies + query params fixed; array + wrong-typed-object bodies still 500).

**X-R4-04 (Medium) — R3-M12 is partial: invite endpoints still accept unroutable-but-RFC-valid addresses (ghost users), and an over-long local part 500s.**
- Where: `schools/views.py::SchoolTeamView.post`/`.patch`, `teachers/views.py::SchoolTeacherListView.post` — `parse_email()` runs Django's `validate_email`, which accepts `a@localhost`, `"quoted"@uberip.com`, `a@[127.0.0.1]`, and a whitespace-stripped `A@UBERIP.COM ` / `x@uberip.com\n`.
- Repro (E1 owner): obvious junk now 400 (`not-an-email`, `a@b`, `user@`, `@uberip.com`, `a b@…`, `a@b..com`, `x@…<script>`, `ünïcode@…` → all 400 — the R3-M12 core is fixed). But `a@localhost`, `"quoted"@uberip.com`, `a@[127.0.0.1]` → **201 `email_sent:true`** on both `/school/team/` and `/school/teachers/`, creating unreachable ghost User/Teacher rows; a 300-char local part `x…@uberip.com` → **500**.
- Impact: unroutable accounts / ghost roster rows / bounced Celery mail (as in R3-M12), plus a 500 on the over-long case. Lower reach than R3-M12's `not-an-email`.
- Evidence: `state.json → tz_email_founder.team_invite / teacher_invite`. All ghost rows created were deleted (§6); the over-long one 500'd (no row).
- vs R3: **PARTIAL fix of R3-M12.**

### LOW

**X-R4-05 (Low) — Teacher self-profile serializer is over-permissive.** `PATCH /api/teacher/profile/` (`TeacherSerializer`, `fields` include `active`, `photo_url`) lets a teacher set her own `active:false` (self-deactivate → 200) and `photo_url` to an arbitrary string, e.g. `"javascript:alert(1)"` (stored verbatim, 200). `photo_url` is rendered as an `<img src>` (inert for a `javascript:` URI) and bypasses the R3-C2 upload allow-list because it is a free string field, not an upload. `email` is writable but correctly syncs `User.email` with a collision check (intended). Reverted (`active:true`, `email`/`photo_url` restored). vs R3: NEW.

**X-R4-06 (Low) — A concurrent duplicate create on a unique-constrained row 500s (uncaught IntegrityError).** During the matrix, 5 workers POSTed the same `document-types` `code` into E1 within the same instant; the serializer's uniqueness check is SELECT-then-INSERT, so one request raised an unhandled `IntegrityError` → `POST /school/document-types/ → 500` (a *sequential* duplicate is a clean 400 `unique set`). Same race exists for any `UniqueConstraint`-bearing school model. Low (needs concurrent identical creates). vs R3: NEW.

**X-R4-07 (Low) — `staff` reads school infra fields on `GET /school/profile/`.** R3's L-1 fix correctly hides `stripe_account_id`/`platform_fee_percentage`/`shop_commission_percentage`/`stripe_onboarding_complete` from a non-`settings` member, but `owner` (the owner's User UUID), `ical_token`, `free_trial_ends_at` and `grace_period_days` are still returned to `staff`. Minor info exposure (`ical_token` feed is already reachable by school id; `owner` is an internal UUID). vs R3: NEW (minor).

---

## 3. Round-3 fix re-verification (my scope)

| R3 item | Verdict | Evidence |
|---|---|---|
| **R3-C1** HQ team hierarchy on PUT (`705fe4c`) | **VERIFIED FIXED LIVE** | support/tech/finance/analytics/ops × PUT/PATCH/DELETE on owner & super rows, PUT-self→owner, PATCH-self→super_admin, `POST /hq/invitations/ {role_detail:owner}` → **all 403**; owner/super rows byte-identical after (`hq_c1.owner_unchanged/super_unchanged/member_count_same` = true) |
| **R3-C2** image upload allow-list + served headers (`b590def`,`8e8d8d0`,`e532a6b`,`6240646`) | **VERIFIED FIXED LIVE** | course/package/teacher image: html/html-lying-png/svg/svg-lying-png/png-named-html/png-magic+html → **400 invalid_type**; real 8×8 PNG & JPEG & PNG-no-content-type → 200 stored `.png`/`.jpg`; served `/media/public/…` → `X-Content-Type-Options: nosniff` + `Content-Security-Policy: default-src 'none'; sandbox`; cross-tenant upload → 403 |
| **R3-H1** narrow HQ on `/api/documents/*` (`f974e0f`) | **VERIFIED FIXED LIVE** | support/tech/finance/analytics → **403** on GET meta, `file/?path=&token=`, DELETE of my E1 document; owner/super_admin/operations → 200; e1_teacher & all attacker tokens → 403; path-guess/traversal → 404; file served `nosniff` inline pdf |
| **R3-H2** stripe onboard gate + race (`11fc41f`) | **VERIFIED FIXED LIVE** | staff → 403 `section_forbidden: payments`; teacher/student/narrow-HQ → 400 `no_active_school`; anon 401; **two concurrent owner calls → exactly one account `acct_1UEZQbKWw09Twzen`** (both URLs same acct); sequential call reuses it; `"str"`/`[1]`/`null` body → clean 400 (no leaked Python error) |
| **R3-H4** founder protection (`8aa678b`) | **PARTIAL** | role-change & delete on founder refused even by a co-owner (`cannot_change_founder_role`/`cannot_remove_founder`), promotion reversible (demote co-owner → 200) — VERIFIED. **But** co-owner can rewrite the founder's login e-mail/phone → **X-R4-01** |
| **R3-M8** malformed bodies → 400 (`86f8fe1`) | **PARTIAL** | scalar bodies (`"str"`,`42`,`null`), query params, path-ids (`team/teachers` id `x`, `stripe/refund` id `x`) all 400; onboard bad body 400 not 502. **But** array `[1]`/`[1,2]` and wrong-typed-object bodies still 500 on 13 endpoints (5 anon) → **X-R4-03** |
| **R3-M10** student self-profile mass-assign (`a9291ac`) | **VERIFIED FIXED LIVE** | `PATCH /student/profile/ {school, email, ical_token, user, id, free_lesson_used, created_at}` → all ignored (only name/language changed); `PATCH /auth/me/ {role,roles,email,active_school,hq_sub_role,school_sub_role,password,is_staff}` → all ignored (login with the attempted password → 401) |
| **R3-M11** timezone value validation (`3fad7e4`) | **VERIFIED FIXED LIVE** (value) | Mars/Olympus, blank, null, lowercase `europe/rome`, numeric, list, >60char → 400; UTC/Europe/Paris → 200. Adjacent gap: any member can write it → **X-R4-02** |
| **R3-M12** invite e-mail validation (`27b93b6`) | **PARTIAL** | `not-an-email`/`a@b`/`user@`/`@x`/`a b@`/`a@b..com`/`<script>`/unicode → 400. **But** `a@localhost`/`"quoted"@`/`a@[127.0.0.1]` → 201 ghost user, over-long → 500 → **X-R4-04** |
| **R3-M13** calendar WS narrow HQ (`8579b8d`) | **VERIFIED FIXED LIVE** | `/ws/calendar/school/<E1>/` and `/ws/calendar/teacher/<T>/`: support/tech/finance/analytics → **HTTP 403**; owner/super_admin/operations/school-owner/school-staff/that-teacher → OPEN; e1_student, all attacker tokens, no-token, garbage, refresh-as-access, tampered, forged `as=`, Authorization/Cookie header, bad-uuid, `/ws/*/nope/` → 403. Close codes 4401/4403/4404 still surface as HTTP 403 to the client (per design, per commit note) |
| **R3-L11** chat create / empty rows / login case / bounds (`349c01f`) | **VERIFIED FIXED LIVE** | `POST /chat/conversations/` finance/analytics → 403, support/tech/ops/owner require `hq_school`+school (empty/no-school → 400), student at un-enrolled school → 403; `POST /school/courses/ {}` → 400, `POST /school/subscriptions/` → 405 read-only; case-insensitive login (`QA-R4-SCHOOL-E1@…`) → 200; `simulate {students:-1 / 1e12 / "abc"}` → 400, `{students:5}` → 200; chat `content:123` / `attachment_url:["x"]` → 400; student `is_internal:true` forced false |
| **R3-L12** HSTS `includeSubDomains` (`35f9a99`) | **NOT FIXED LIVE** | `/`, `/en`, `/api/health/` → `strict-transport-security: max-age=63072000` (no `includeSubDomains`). Documented as a manual edge-nginx ops step; not on the CI path — as expected |

---

## 4. E-mails verified (mail.tm `@uberip.com`)

| trigger | inbox | subject | locale | delivery |
|---|---|---|---|---|
| staff team invite (`locale:it`) | qa-r4-x-e1-staff | "✉️ Invito da QA R4 School E1 — Staff" | it ✓ | 4.4 s → completed via `complete-invite` (reuse → 400, wrong-uid → 400 `invalid_link`) |
| teacher invite | qa-r4-x-e1-teacher | "✉️ Invito da QA R4 School E1 — insegnante" | it ✓ | completed (reuse → 400) |
| student welcome (register, `language_preference:es`) | qa-r4-x-e1-student | "🩰 ¡Bienvenida a Danza Classica No Under 40!" | es ✓ | 0.8 s |
| password reset (UPPERCASE address + `locale:fr`) | qa-r4-x-e1-student | "🔑 Réinitialisez votre mot de passe" | fr ✓ (UI locale wins) | 1.8 s; token single-use (validate before use → valid; after use → `invalid_or_expired_token`; reuse confirm → 400); similar-to-email/weak/short rejected without consuming the token |

Note: tokens from register/complete-invite/reset-confirm carry only `user_id` (no role/roles); only `login` carries role claims — harmless (frontend reads `/auth/me/`), noted for JWT-decoding clients.

---

## 5. Verified good (tested, passed)

- **Cross-tenant isolation:** 5,786 combinations — **0 E1 identifiers in any attacker-token response** (the 9 real-UUID hits are all public endpoints: `/student/lessons/?school_id=`, `/schools/<id>/document-types/`, and a `/bookings/multiple/` echo of the attacker's own request); every `?school=<E1>` override returned the attacker's own tenant data; attacker × every E1 detail object → only 400/403/404/405; no attacker write succeeded on E1.
- **WebSockets:** calendar + chat + inbox isolation exactly per the visibility matrix (teacher blocked from school↔student & HQ↔school; student blocked from school↔teacher & teacher-support; finance/analytics blocked everywhere; support/tech see hq_school + teacher_support only); no-token/garbage/refresh-as-access/tampered/forged-`as=`/Authorization-header/Cookie/unknown-path/bad-uuid → all rejected, no 500; PR#105 relay: student post → E1 owner inbox `inbox_event` + cs chat socket `message`; teacher/HQ/attacker inboxes receive nothing.
- **Auth:** wrong-password/unknown-email → uniform 401; alg=none forgery, tampered, refresh-as-access, garbage → 401 `token_not_valid`; refresh rotates both tokens, old refresh → blacklisted, access-as-refresh → wrong type; logout 205 + blacklist (idempotent for anon/garbage), stateless access valid until exp; google garbage → 503, empty → 400; change-password wrong-current/common/similar-email → 400.
- **Public surface / headers:** CSP (`default-src 'self'`, `frame-ancestors 'none'`, `media-src/frame-src 'self' https:`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, no `x-powered-by`; CORS: foreign & `null` Origin get no ACAO, same-origin gets ACAO+credentials; docs gating (`/api/docs` `/api/schema`: anon 401, school/teacher/student 403, every HQ role 200); `Host: evil` served (no redirect leak), `http→https` 301, TRACE 405, 9KB query 414, 20KB header 400; `/.env` `/.git/config` `/backend/config/settings.py` → 404; `/media/public/…` carries `nosniff` + sandbox CSP; `/media/private|documents|internal-media/…` → 404; iCal by id public, bad `?type/teacher` → 400, unknown → 404; `/schools/public/` exposes only id/name/slug/city/province/country/logo/website and lists no inactive school.
- **Robustness:** 3× concurrent booking of a cap-1 lesson → exactly one 201, others `400 full`; double-cancel → second `400 not_cancellable`; grants additive by design (two distinct rows); 6KB emoji/unicode chat stored (201); 5KB name → 400; empty-body creates on all school routers → clean 400 (403/405 for lesson-types/subscriptions); pagination `?page=0/-1/1e9/999999999`, `?page_size=-1/1e9`, `?limit=1e9`, `q=%00🩰×2000` → 200/414, never 500.
- **Section guard:** staff 403 on team/transactions/reports/packages-write/compensation/settings & identity fields of `/school/profile/`; narrow HQ 403 on all `/school/*` incl. `?school=<E1>`; owner/super_admin/operations keep cross-school access.

---

## 6. Test data created / changed (all on QA R4 School E1 unless noted)

**Fixtures (left in place, `QA R4 X …`):** location `cc797b0a-9f22-475d-abc2-662acfe9c7d1`, room `114d2015-ac0b-4e2c-8027-5c5ed3a397df` (cap 2), document-type `9a0997fd-5373-4912-9a69-abf50f2e3dff` (`qa_r4_x_med`, required, expiry), attendance statuses `eecbcc3e-…` (Present, default) / `f9dd0806-…` (No-show, burns), compensation plan `f1e518b7-…`, package `c72cb2ab-…`, discount `908b52cc-…` (`QAR4X10`), closure `815c47be-…` (2026-12-24), course `943a44ee-68c8-4331-997c-e9262f4fc2c2` with lessons `1f338899…`/`7a18f15c…`/`14cbb71b…` (last cap-1), teacher `2e994407-…` (`qa-r4-x-e1-teacher@`), staff membership id 49 (`qa-r4-x-e1-staff@`), student `8915dd7f-…` / user `5b5a999e-…` (`qa-r4-x-e1-student@`, ical `d08b1078-…`), grant `b5fb8a5a-…` (5 cr) + two 0.5-cr idempotency-probe grants `48abb449-…`/`98a67959-…` (wallet now 5 cr; grants can't be undone via product), document **v2** `aa70c212-2d01-4c60-80e5-f371fc472c6d` (v1 `6b684a37-…` was self-deleted by `e1_student` during the matrix — a legitimate own-non-approved-doc delete), conversations `77674f2d…`(school↔student) / `ccebe4b3…`(school↔teacher) / `6273db3c…`(HQ↔school) / `68b9ee7c…`(teacher-support). Booking on lesson 1 `b2b59f89-…`. All accounts `QaRound4!2026`.
**Probe rows created & deleted:** 61 matrix rows (rooms/closures/comp-payments/plans/attendance/doctypes/discounts/quick-replies/lessons/packages/locations + 9 conversations + 25 messages) — all DELETE→204; 8 ghost invite rows from the invalid-e-mail test (team ids 51-55 + teachers `dabc8959`/`6e3684ee`/`c0738a60`/`2a6affe2`/`bf9fbc21`) — deleted; several HQ-token `hq_school` probe threads — deleted; 1 WS relay message + 1 unicode chat message — deleted; concurrent-booking L3 booking `b0c3b4bc-…` — cancelled.
**Settings changed & restored:** E1 `timezone` Rome→Paris→Rome (×3, incl. staff-write test); founder (id 46) e-mail Rome-addr→`qa-r4-x-hijack@`→restored & phone restored; staff (id 49) owner↔staff (promoted then demoted back); student profile name/language changed→restored; teacher profile `active`/`email`/`photo_url` changed→restored; student password (reset test) →tmp→restored to `QaRound4!2026`; near-similar password change→restored.
**Not revertible through the product (note for Hakan/DB):** Stripe test account **`acct_1UEZQbKWw09Twzen`** created on E1 by the R3-H2 concurrency probe (single account, no orphan; KYC NOT completed); ghost `User` rows for the RFC-valid-but-unroutable invite addresses `a@localhost` / `"quoted"@uberip.com` / `a@[127.0.0.1]` (memberships/teacher links deleted, User rows remain); the over-long-address invite 500'd without creating a row.
**Attacker tenant (round-3 E1 `a89e1e5a…`):** read-only + short-lived probe rows, all reverted — no QA R4 residue in any segment, no comp payments referencing E1, Stripe binding unchanged (`acct_1UDLrUKgzt1eSuqR` from R3). No production-like or other agents' tenants touched.
**Ledger:** 1 `register` (18:35 UTC), 1 `reset` (~20:xx UTC).

---

## 7. Artifacts

`$SP/reports/crosscut-matrix-r4.json` (5,786 rows + skipped), `crosscut-matrix-r4-condensed.md` (condensed table), `$SP/work/xcut/matrix-r4-anomalies.json`, `$SP/work/xcut/state.json` (all probe results), `$SP/work/xcut/apilog.jsonl`, scripts `$SP/work/xcut/*.js`.

---

## 8. Assumptions / decisions / hazards

- **Cross-tenant leak count:** the automated `leakE1` flag over-counted (82) because `E1_IDS` included the 2-char staff-membership id `"49"`, which substring-matches most JSON. Recomputed against real UUIDs only → 9 hits, all on public catalog endpoints / request-echo → **0 genuine leaks**.
- Destructive matrix calls were skipped for legitimately-allowed tokens; with denied tokens the one fixture lost was the student's own document (self-delete, legitimate) — rebuilt as v2.
- The two matrix 500s: `POST /school/document-types/` = a concurrency unique-race (X-R4-06); `GET /api/schema/` for hq_support = transient under 5,786-req load (4/4 → 200 on retest) — not a finding.
- `/student/shop/` is readable anonymously (public storefront, consistent with `student_shop_enable`) — treated as by-design.
- Throttle etiquette: 1 registration, 1 password reset, ~8 deliberate login hits (spread), invite flows (unthrottled) for ghost-e-mail tests. Malformed anonymous-body 500s were confirmed only on the 3 nginx-rate-limited auth endpoints with 6.5 s spacing to avoid the 10/min lock.
- Founder-e-mail takeover (X-R4-01) confirmed by both live probe and code (`schools/views.py`), then fully reverted; I did not exercise the actual `password-reset` step against the hijacked address.
- Django Admin not used; no DB access; application code read-only.
