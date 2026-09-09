> Round-3 live regression, 2026-09-08 — per-panel detail report written by the i18n QA agent. Entry point: [QA_REGRESSION_ROUND3_SUMMARY.md](QA_REGRESSION_ROUND3_SUMMARY.md). Screenshots/text dumps referenced as `$SP/shots/…`, `$SP/reports/…` or `$SP/work/…` were produced in the QA session's scratchpad and are **not** committed; a curated subset of key-evidence screenshots lives in [docs/qa/round3-screenshots/](docs/qa/round3-screenshots/).

# QA Round 3 — i18n + responsive-layout crawl report

- Agent: `i18n` · Playwright profiles `i18n-agent` (1366×900) / `i18n-agent-mobile` (390×844, iPhone UA, touch) · screenshot prefix `i18n-` · finding IDs `I18N-R3-NN`
- Target: https://dev.danzaclassicanounder40.com at commit `6c0cef1` (CI run 34209392001)
- Tenants / accounts (all READ-ONLY, nothing saved): HQ owner `qa.hq.owner@qa-nounder40.test`; round-2 School B `ab51f9ff-b566-4247-995f-b49d37b36578` owner `qa-r2-school-b@uberip.com`, teacher `qa-r2-school-teacher1@uberip.com` (user `4fc1786e…`), student `qa-r2-school-student1@uberip.com` (user `1b48d805…`); anonymous.
- Time window: 2026-09-08 09:55 – 10:58 UTC
- Method: (1) static analysis of `frontend/messages/{en,it,es,fr,de}.json` + grep of `frontend/src` for hardcoded copy (`$SP/work/i18n/static_check.js`, `placeholders.js`, output `$SP/reports/dumps/i18n-static-check.txt`); (2) live crawl of every `page.tsx` route under `app/[locale]/<role>/**` plus the public routes and a 404 URL, × 5 locales × 2 viewports, JWT injected via `qa.injectJwt`, network-idle + 1.5 s, full-page screenshot + text dump per page, automated checks (`qa.scanText`, JS leaks, placeholder copy, wrong-language month/weekday names, 12-hour times, MM/DD dates, horizontal overflow, overflowing elements, overlapping fixed/sticky elements, ellipsis truncation, primary tap targets < 40 px, console errors, line-level diff of each non-English dump against the English dump of the same page classified against the message catalogue) — `$SP/work/i18n/crawl.js`, raw results `$SP/work/i18n/results-{desktop,mobile}.jsonl`, analyzer `analyze.js`; (3) mobile drawer open/close on every panel dashboard × locale; (4) language switcher on every panel (URL locale change, reload persistence, locale-less link stickiness), with the account's `language_preference` captured before and restored after.
- Budgets used: 0 registrations, 0 password resets, 4 logins (`qa-r2-school-teacher1`, `qa-r2-school-student1`, `qa-r2-teacher-t1`, `qa-r2-teacher-s1`), everything else via cached tokens / refresh.

## §0 Executive summary

- **Scope done**: static audit of the five message catalogues + source grep; live crawl of **77 routes × 5 locales × 2 viewports = 770 page-loads** (every `page.tsx` under `app/[locale]/{hq,school,teacher,student}` with real ids, plus `/`, `/login`, `/register`, `/reset-password`, `/setup-account`, `/select-role`, a 404 URL and an anonymous hit on a student page); mobile drawer open/close on 4 panels × 5 locales (20/20 pass); language switcher on 4 panels × 2 viewports + landing.
- **Result**: 0 Critical, 0 High, **3 Medium**, **11 Low**, plus a static inventory of hardcoded strings. 716/770 page-loads pass every automated check; the 54 "issue" loads are 8 routes, all attributable to the findings below (raw level/type enums, the clipped teacher-compensation table, one Spanish title-case date, a broken student-profile link in the school inbox thread, a 404 API call on HQ packages).
- **Round-2 verdicts**: R2-M11 setup-account placeholder copy **VERIFIED FIXED LIVE**; HQ-R2-06 greeting, HQ-R2-08 permission labels, HQ-R2-10 school-detail buttons, X-R2-10 `citiesLabel` plural + export `{count}` tooltips, ST-R2-13 `spotsLeft` plural, ST-R2-14 Spanish month casing, ST-R2-16 24-h chat times, TCH-R2-08 year-view initials / Performance labels / library filter options / `email_taken` key — **all VERIFIED FIXED LIVE**; R2-M15 throttle copy verified in code only (not triggered). **PARTIAL**: the same raw-enum badges (library cards, landing) and the same `capitalize` date bug remain in sibling components not covered by PRs #109/#110; R2-L3's school-panel list (SCH-R2-20) is **STILL OPEN** — PR #112 fixed other SCH items, none of the school-panel i18n strings (school calendar year view still shows "M T W T F S S" and "1 classes" in it/es/fr/de — verified live).
- **New Medium**: (0) the School inbox thread's "View student profile" action links to a route that does not exist (404); (1) Teacher › Compensation table is clipped with no horizontal scroll on 390 px — the "Compenso Base" column is unreachable in all locales; (2) no language switcher exists on /login, /register, /reset-password, /setup-account (any viewport) nor on the landing page below 640 px — invited users complete their account in the inviting school's language.
- Catalogue health: 3,198 keys, identical in all 5 files, no ICU errors, placeholder sets identical, plurals complete; the R2-M11 placeholder strings are gone.

## §1 Coverage table (77 routes × 5 locales × 2 viewports)

Legend: ✓ = every automated check passed (HTTP, key/var/JS leaks, placeholder copy, wrong-language dates, 12-h/MM-DD, horizontal overflow, fixed overlaps, clipped tables, console, untranslated UI strings, drawer); **✗** = at least one real issue (named in *notes*, all mapped to §2 findings); cosmetic notes (tap<40, ellipsis, loan words, scrollable wide tables) are listed in italics and do not fail the cell. Sub-roles: HQ owner, School owner, Teacher, Student, anonymous. Accounts and ids as in the header; dynamic ids: school `ab51f9ff…`, course `3b2e3659…`, lesson/class `e68ad889…`, teacher lesson `0cc95230…`, conversations `c7578e38…` (HQ), `cad7ee3c…` (school), `d11b0a6f…` (teacher), product `4f3a9525…`. Manual additions not caught automatically: the 404 page is bilingual it/en on every locale (I18N-R3-03); auth pages/landing-mobile have no language switcher (I18N-R3-07).

| Role / route | desktop en·it·es·fr·de | mobile en·it·es·fr·de | notes |
|---|---|---|---|
| anon / | ✓ **✗** **✗** **✗** **✗** | ✓ **✗** **✗** **✗** **✗** | d/it:untranslated:entry/intermediate; d/es:untranslated:entry/intermediate; d/fr:untranslated:entry/intermediate; d/de:untranslated:entry/intermediate; m/it:untranslated:entry/intermediate; m/es:untranslated:entry/intermediate … _(cosmetic: loanwords, ellipsis)_ |
| anon /login | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords)_ |
| anon /register | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  |
| anon /reset-password | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  |
| anon /setup-account?uid=x&token=y | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords)_ |
| anon /select-role | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords)_ |
| anon /this-page-does-not-exist-404 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  |
| anon /student/dashboard | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| student /student/dashboard | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, drawer-ok, wide-table(scrollable))_ |
| student /student/book | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/bookings | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/buy | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/packages | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/profile | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/shop | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/shop/4f3a9525-9c74-46ad-9d2c-e2b19beb63eb | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /student/support | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /select-role | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| student /this-page-does-not-exist-404 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  |
| teacher /teacher/dashboard | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, ellipsis, tap<40, drawer-ok)_ |
| teacher /teacher/attendance | ✓ ✓ **✗** ✓ ✓ | ✓ ✓ **✗** ✓ ✓ | d/es:titlecase-de; m/es:titlecase-de _(cosmetic: loanwords, ellipsis, tap<40)_ |
| teacher /teacher/attendance/0cc95230-2d8a-4a2d-a0de-16382582bb82 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/calendar | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/compensation | ✓ ✓ ✓ ✓ ✓ | **✗** **✗** **✗** **✗** **✗** | m/en:clipped-table; m/it:clipped-table; m/es:clipped-table; m/fr:clipped-table; m/de:clipped-table _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/inbox | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| teacher /teacher/inbox/d11b0a6f-e3fa-4b5d-9231-74a83bdc75d4 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/library | ✓ **✗** **✗** **✗** **✗** | ✓ **✗** **✗** **✗** **✗** | d/it:untranslated:intermediate/advanced/entry; d/es:untranslated:intermediate/advanced/entry; d/fr:untranslated:intermediate/advanced/entry; d/fr:PAGE-LEVEL-EN; d/de:untranslated:intermediate/advanced/entry; m/it:untranslated:intermediate/advanced/entry … _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/performance | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| teacher /teacher/profile | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/dashboard | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40, drawer-ok)_ |
| school /school/attendance/e68ad889-d76d-4659-9363-2060ec9fcb8e | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/calendar | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/compensation | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/courses | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/courses/3b2e3659-40e0-4bfc-b67f-ffd14bcf9337 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/courses/3b2e3659-40e0-4bfc-b67f-ffd14bcf9337/edit | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/courses/3b2e3659-40e0-4bfc-b67f-ffd14bcf9337/classes/e68ad889-d76d-4659-9363-2060ec9fcb8e | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/courses/new | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/credits | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| school /school/documents | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| school /school/inbox | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| school /school/inbox/cad7ee3c-1d66-487d-a0d3-e41113bd95ec | **✗** **✗** **✗** **✗** **✗** | ✓ ✓ ✓ ✓ ✓ | d/en:console; d/it:console; d/es:console; d/fr:console; d/de:console _(cosmetic: loanwords, tap<40)_ |
| school /school/lessons | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |
| school /school/locations | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/packages | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, wide-table(scrollable), tap<40)_ |
| school /school/payments | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/profile | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/reports | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |
| school /school/settings | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/settings/statuses | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/students | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| school /school/subscriptions | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, wide-table(scrollable), tap<40)_ |
| school /school/teachers | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| school /school/teachers/invite | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| school /school/team | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/dashboard | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40, drawer-ok)_ |
| hq /hq/account | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/brand-settings | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/debug | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  |
| hq /hq/emails | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: ellipsis, loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/homepage-settings | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/inbox | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/inbox/c7578e38-cd47-4e10-81f8-d44155a4c0e4 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/lesson-types | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |
| hq /hq/library | ✓ **✗** **✗** **✗** **✗** | ✓ **✗** **✗** **✗** **✗** | d/it:untranslated:entry/intermediate; d/es:untranslated:entry/intermediate; d/fr:untranslated:entry/intermediate; d/de:untranslated:entry/intermediate; m/it:untranslated:entry/intermediate; m/es:untranslated:entry/intermediate … _(cosmetic: loanwords, tap<40)_ |
| hq /hq/locations | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/packages | **✗** **✗** **✗** **✗** **✗** | **✗** **✗** **✗** **✗** **✗** | d/en:console; d/it:console; d/es:console; d/fr:console; d/de:console; m/en:console … _(cosmetic: ellipsis, loanwords, tap<40, wide-table(scrollable))_ |
| hq /hq/payments | ✓ **✗** **✗** **✗** **✗** | ✓ **✗** **✗** **✗** **✗** | d/it:untranslated:package/subscription; d/es:untranslated:package/subscription; d/fr:untranslated:package/subscription; d/de:untranslated:package/subscription; m/it:untranslated:package/subscription; m/es:untranslated:package/subscription … _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |
| hq /hq/permissions | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/reports | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/schools | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/schools/ab51f9ff-b566-4247-995f-b49d37b36578 | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/schools/ab51f9ff-b566-4247-995f-b49d37b36578/edit | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/schools/new | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, tap<40)_ |
| hq /hq/shop | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |
| hq /hq/team | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: loanwords, wide-table(scrollable), tap<40)_ |
| hq /hq/translations | ✓ ✓ ✓ ✓ ✓ | ✓ ✓ ✓ ✓ ✓ |  _(cosmetic: wide-table(scrollable), loanwords, tap<40)_ |

770 page-loads, 716 pass, 54 with a real issue.

## §2 Findings by severity

No Critical, no High.

### Medium

**I18N-R3-01 — Teacher › Compensation table clipped on mobile (all 5 locales).** NEW.
- Where: `/<locale>/teacher/compensation`, 390×844, account `qa-r2-school-teacher1@uberip.com` (School B).
- Repro: open the page on a phone-width viewport. The per-school month table (columns Mese · Corso · Piani · Studenti · **Compenso Base** · bonus badge) sits in a card with `overflow-hidden` and no `overflow-x-auto` wrapper (`frontend/src/app/[locale]/teacher/compensation/page.tsx:177` card, `:221` table). Measured: `th "Compenso Base"` right edge 472 px (it) / 434 px (en) vs 390 px viewport, `document.scrollWidth` = 390 → neither the page nor the card scrolls horizontally.
- Expected: horizontally scrollable table (every other wide table in the app — teacher inbox, school credits/lessons/reports/documents, HQ payments/reports — uses `overflow-x-auto`), or a stacked card layout.
- Actual: the money column a teacher opens this page for is unreachable on mobile. Desktop (1366) fine.
- Evidence: `i18n-teacher-mobile-{en,it,es,fr,de}-teacher_compensation.png`, `results-mobile.jsonl` `checks.overflowing`.

**I18N-R3-07 — No language switcher on the auth pages, nor on the landing page below 640 px.** NEW.
- Where: `/login`, `/register`, `/reset-password`, `/setup-account?uid&token` (desktop + mobile); `/` at 390 px.
- Repro: anonymous, open any of those pages; look for a locale control. None exists — `LanguageDropdown` is mounted only in the four panel layouts + `PanelHeader`; the landing's `switchLocale` buttons (`components/landing/LandingHeader.tsx:54-66`) are `hidden sm:flex` and the mobile menu (`:87-96`) contains only nav links. The switch-test script found no trigger (`switch-mobile.json` anon: `triggerVisible:false`, `landingButtons:[]` at 390 px).
- Expected: the same locale control as the panels (or at least the landing buttons) on every public page and viewport — invited teachers/students land on `/<school language>/setup-account` from the e-mail (see `tenants.json` `setup_link_locale: "it"`), a German teacher invited by an Italian school must complete the account in Italian; a phone visitor cannot change the landing language except by editing the URL prefix.
- Actual: no control. Workaround: edit the URL. Panels' switcher itself works everywhere (see §5).
- Evidence: dumps `i18n-anon-{desktop,mobile}-en-{login,register,reset_password,setup_account_uid_x_token_y}.txt` (the only flags on /register are the phone-prefix selector), `i18n-anon-mobile-en-root.txt`, shot `i18n-switch-mobile-anon-*` absent (no trigger).

**I18N-R3-14 — School › Messages thread: "View student profile" links to a non-existent route (404).** NEW (may overlap the School agent's report).
- Where: `/<locale>/school/inbox/<conversation id>` desktop (the side panel is hidden on mobile), `frontend/src/app/[locale]/school/inbox/[id]/page.tsx:272-277` `<Link href={\`/school/students/${studentInfo.id}\`}>{t('viewStudentProfile')}</Link>`; there is no `school/students/[id]/page.tsx` (only `school/students/page.tsx`).
- Repro: open the thread `cad7ee3c-1d66-487d-a0d3-e41113bd95ec` as `qa-r2-school-b@uberip.com`; Next.js prefetches the link → console `404` on every locale (seen on all 5 desktop loads); `GET https://dev…/en/school/students/cf8765c1-4e08-4a00-97c8-787426fa8277` → **404** (independent fetch), `/en/school/students` → 200. Clicking the action lands on the bilingual 404 page.
- Expected: open the student sheet (the Students page opens it via `StudentSheet` with `?student_id`) or link to `/school/students`.
- Evidence: `resources.log` `school-thread`, `results-desktop.jsonl` console entries, `i18n-school-desktop-it-school_inbox_cad7ee3c….png` (side panel with the action).

### Low

**I18N-R3-15 — HQ › Packages requests `/api/hq/courses/?active=true`, which does not exist (404).** NEW. `components/PackagesManager.tsx:254` builds `${panelBase}/courses/` for both panels; `config/api_hq.py` has no `courses` route (school has). The error is swallowed (`courseCosts = []`), so HQ packages silently lose the per-course credit-cost estimate the school panel shows; every HQ › Packages load logs a console 404 (10/10 loads). Evidence `resources.log` `hq-packages`, API check `GET /api/hq/courses/?active=true` → 404 with the HQ owner token.

**I18N-R3-02 — Level / type / language enum values rendered raw (English) on every locale.** PARTIAL vs TCH-R2-08 (PR #110 localized the *filter options* but not the badges).
- `components/landing/LandingBoard.tsx:81` `{lesson.level}` → "ENTRY", "INTERMEDIATE" chips on `/it`, `/es`, `/fr`, `/de` (API `/lessons/public/upcoming/?locale=it` returns `level: "entry"` — raw enum, verified).
- `app/[locale]/teacher/library/page.tsx:151,207` `<span className="capitalize">{item.level}</span>` → "Entry / Intermediate / Advanced" card + viewer badges; language badge "All" for `language=all`; type badge "Video" (it/es/fr; it value is also "Video").
- `app/[locale]/hq/library/page.tsx:393` same for HQ › Library.
- Keys already exist: `hq.lesson-types.levelEntry/levelIntermediate/levelAdvanced`, `teacher.library.*`, `hq.library.filter*`.
- Evidence: `i18n-anon-desktop-it-root.txt` l.217/238, `i18n-teacher-desktop-{it,es,fr,de}-teacher_library.txt` l.36/45/54/64, `i18n-hq-mobile-it-hq_library.txt`.

**I18N-R3-03 — 404 page not localized.** NEW. `frontend/src/app/not-found.tsx:11` lives outside `[locale]` → "Pagina non trovata · Page not found" for es/fr/de as well. Evidence `i18n-anon-desktop-{es,fr,de}-this_page_does_not_exist_404.txt`.

**I18N-R3-05 — Spanish dates title-cased: "Lunes, 14 De Sept De 2026".** Sibling of ST-R2-14 (PARTIAL). `app/[locale]/teacher/attendance/page.tsx:86` wraps `formatLessonDate()` in CSS `capitalize`; same at `app/[locale]/student/packages/page.tsx:192` (credit history, year included) and `teacher/dashboard/page.tsx:128` (no year → "Lunes, 14 Sept", harmless). it/fr/de fine. Evidence `i18n-teacher-{desktop,mobile}-es-teacher_attendance.{txt,png}` l.22/31/41/50/59.

**I18N-R3-06 — Transaction type rendered raw ("Package" / "Subscription") on it/es/fr/de.** NEW. `app/[locale]/hq/payments/page.tsx:231` and `app/[locale]/school/payments/page.tsx:278` `{tx.type}` with `capitalize`. Keys `school.attendance.packageSource/subscriptionSource` exist. Evidence `i18n-hq-{mobile,desktop}-{it,es,fr,de}-hq_payments.txt`.

**I18N-R3-08 — Hardcoded English strings still in the school panel (STILL OPEN part of R2-L3 / SCH-R2-20).** The round-2 school list was only partly fixed by PR #112 (which addressed SCH-R2-18/21/23/24). Still rendering English on every locale (file:line, verified by grep; the calendar year view verified live — see §3):
- `school/calendar/CalendarClient.tsx:637` year view weekday initials `['M','T','W','T','F','S','S']` and `:634` "{n} classes" (the school twin of the teacher fix in PR #110); `:398-421` "Add Class to Existing Course", "Course *", "Date *", "Start Time *", "Duration (min)", `:404` "Select course...", `:738` "Loading...".
- `school/courses/CoursesClient.tsx:524-724` bulk-edit modal (13 labels: "Lesson Type", "Default Teacher", "Start Time", "Duration (min)", "Max Capacity", "Reserve Spots", "Min Booking Notice (hours)", "Calendar Color", "Course Name", "Description", "Notes", "Online / In-Person", "Waitlist"), "No teacher", ×9 `placeholder="— unchanged —"`, "Apply changes to future classes too", "No courses yet."; `school/courses/[id]/page.tsx:458` "Changes saved to all selected classes.", `:597/605/618` "No teacher/No room/No plan", `:628` "Online / In-Person", ×4 "— unchanged —".
- `confirm()` dialogs: `school/settings/statuses/page.tsx:115` "Delete this status?", `school/compensation/page.tsx:164` "Delete this compensation plan?", `school/team/page.tsx:174` "Are you sure you want to remove this pending invitation/team member?"; `school/team/page.tsx:146` "Email and name are required"; `school/teachers/page.tsx:84,88` "Invitation resent to …" / "Error: Failed to resend"; `hq/lesson-types/page.tsx:217` `setError('Error')`.
- Placeholders: `school/compensation/page.tsx:188,216,230` "e.g. Standard, Senior, Guest" / "e.g. 5" / "e.g. 9 (or leave empty)"; `school/locations/page.tsx:291` "Google Maps URL"; `components/PackagesManager.tsx:518,527` "e.g. Starter Pack" / "Short description..." and `:778` badge "Popular" (school + HQ packages); `hq/emails/page.tsx:615` "© No Under 40 · Classical Dance Network".
- Titles/ARIA: `ColorPicker.tsx:56`, `school/settings/statuses/page.tsx:196,327` "Custom color"; `components/ui/ErrorBanner.tsx:15` `aria-label="Dismiss"`; `hq/emails/page.tsx:763` iframe title.
- `hq/schools/[id]/page.tsx:63` "Not found."

**I18N-R3-09 — Exports are English-only / raw-header.** NEW (part of R2-L3 "CSV headers" STILL OPEN). `hq/payments/page.tsx:34` CSV header row hardcoded English (`Date, School, City, Student, Email, Product, Type, Amount (€), HQ Fee (€), School Amount (€), Status, Payment Method`); `school/reports/page.tsx:101` `Object.keys(rows[0])` → raw API field names as CSV headers on all 5 export buttons; `school/students/page.tsx:77` PDF title `'Students List'` + `lib/export.ts:55` "Exported: dd/mm/yyyy" (en-GB) on every locale. (`hq/reports` CSV headers are localized — good.)

**I18N-R3-10 — Formatting that ignores the UI locale.** NEW / same class as ST-R2-16.
- `app/[locale]/student/shop/page.tsx:188` `toLocaleDateString(undefined, {month:'long'…})` — order dates follow the **browser** locale (an it user with an en-US browser gets "8 September 2026").
- `components/DiscountCodesManager.tsx:305` `toLocaleDateString()` (HQ + school discount-code expiry); `components/landing/LandingStats.tsx:97` `toLocaleString()` (thousands separator).
- `app/[locale]/student/buy/page.tsx:560,582` `Intl.NumberFormat('en-EU', …)` — not a real locale, resolves to `en` → "€10.00" on it/de where "10,00 €" is expected (recurring-package next payment / invoices).
- `app/[locale]/school/documents/page.tsx:205` `toLocaleDateString('it', …)` fixed (dd/mm/yy also for de).
- `lib/format-date.ts` `formatDate` always dd/mm/yyyy (hq/team, hq/payments, hq/schools/[id], school/students, school/team, school/lessons): fine for it/es/fr, "05/09/2026" ambiguous for en-US readers and non-standard for de (dd.mm.yyyy). Cosmetic.

**I18N-R3-11 — Catalogue strings identical to English that are real gaps (static).** NEW. `hq.reports.columnFee` "Fee" (it/es/fr/de); `school.reports.noLessonsMatch` "No Lessons Match" (it/fr); `hq.reports.columnNoShow` / `kpiNoShows` "No-shows" (es); `school.calendar.rowCredits` + `school.classes.edit.labelCredits` "Credits" (de); `scheduleFields.cap`, `school.courses.{detail,edit}.cap`, `school.classes.edit.cap`, `school.locations.capPlaceholder` "cap." (it/es/fr — reads as Italian *CAP* = postcode). Full identical-value list (264, mostly legitimate loan words) in `$SP/reports/dumps/i18n-static-check.txt`.

**I18N-R3-12 — Mobile tap targets below 40 px on primary/secondary controls (all panels).** NEW, cosmetic. Hamburger 36×36; Day/Week/Month toggles 28 px high; Upcoming/Past, Packages/History, Shop/My purchases pill tabs 32 px; attendance status buttons 30 px; "Delete" text buttons in chat 14 px high; +/− quantity 32 px; landing-header "Accedi/Registrati" 32–34 px on the anonymous student pages. Consistent design choice, listed for completeness (`results-mobile.jsonl` `checks.smallTap`).

**I18N-R3-13 — Cosmetic truncation.** NEW. Sidebar e-mail `qa-r2-school-student1@uberip.com` cut by 4 px (208/212) on every student page; course title "Danza Classica No Under 40 - Base e Fond…" in teacher dashboard next-7-days rows (131 px column) and attendance list at 390 px; package names "QA R2 Abbonamento Mensile" (139/223) in school packages cards. All use `truncate` deliberately.

### Informational (not bugs)
- Landing "HOME / BLOG" top bar and `Studios:` labels: HQ › Brand-settings nav links are single-language DB content (`BrandTopBar.tsx`).
- HQ permission/team role names ("Owner, Super Admin, Finance…") are `HQRole.label` from the API (DB-defined matrix per CLAUDE.md §4.5).
- Student shop "MOST POPULAR" / "NEW" chips are HQ-entered product `badges` (API `/student/shop/` → `badges[].label`).
- `/hq/emails` `{{user_first_name}}` chips are template variables; `/hq/translations` lists raw keys by design.
- `emailEditor.linkPrompt` `'{{booking_url}}'` is apostrophe-escaped ICU — renders correctly.
- `studentPreview.noMedia` "HQ > Lesson Types" — a bare `>` is plain text for next-intl.
- Transient `net::ERR_CONNECTION_RESET` / "Failed to fetch RSC payload" console lines on 3 page-loads (shared dev host under six agents) — environmental.

## §3 Round-2 fix re-verification (live, dev `6c0cef1`)

| R2 item | PR | Verdict | Evidence |
|---|---|---|---|
| R2-M11 `/setup-account` placeholder copy (TCH-R2-04, X-R2-09) | #110 | **VERIFIED FIXED LIVE** | it "Bastano pochi dettagli e sei pronta a iniziare.", es "Solo unos pocos datos…", fr "Encore quelques informations…", de "Nur noch ein paar Angaben…" — `i18n-anon-{desktop,mobile}-{it,es,fr,de}-setup_account_uid_x_token_y.{txt,png}` |
| R2-M11 HQ role descriptions (HQ-R2-11), package description placeholder, statuses defaults (SCH-R2-20) | #109/#110 | **VERIFIED FIXED (source) / LIVE for statuses & packages pages** | all 5 locales carry real copy (`hq.permissions.role*Desc`, `hq.packages.placeholderDescription`, `school.statuses.defaultStatusDesc/defaultBadge`); `/school/settings/statuses` it shows "Predefinito", `/hq/packages` it placeholder "Descrizione facoltativa" |
| R2-M15 raw 429 body in localized forms | #113? (login/register/reset) | **VERIFIED IN CODE ONLY** (not triggered, shared-IP budget) | `register/page.tsx:117`, `reset-password/page.tsx:84`, `(auth)/login/page.tsx:117,190` → `t('tooManyAttempts')`, key present in 5 locales |
| R2-L1 / HQ-R2-06 greeting "WelcomeOWNER" | #109 | **VERIFIED FIXED LIVE** | "Welcome, QA HQ Owner" + spaced OWNER pill, "Benvenuto, QA HQ Owner" — `i18n-hq-mobile-{en,it}-hq_dashboard.png` |
| HQ-R2-08 permission labels | #109 | **VERIFIED FIXED LIVE** | section labels localized ("Visualizza scuole" …) — `i18n-hq-{desktop,mobile}-it-hq_permissions.txt`; role column headers are DB `HQRole.label` (informational) |
| HQ-R2-10 school-detail buttons | #109 | **VERIFIED FIXED LIVE** | it "Rinvia Invito", "Disattiva", "Attiva" — `i18n-hq-mobile-it-hq_schools_ab51f9ff….txt` l.7-10 |
| X-R2-10 / R2-L4 `hq.locations.citiesLabel` plural | #109 | **VERIFIED FIXED LIVE** | "2 città · 11 scuole / 1 città · 1 scuola", "2 ciudades / 1 ciudad", "2 villes / 1 ville", "2 Städte / 1 Stadt" — `i18n-hq-mobile-{it,es,fr,de}-hq_locations.txt` |
| X-R2-10 export tooltips `{count}` (es/fr/de) | #109/#110 | **VERIFIED FIXED LIVE** | hover bubbles: en "Export 1 lessons / 1 students / 2 teachers", it "Esporta 1 lezioni / 1 studenti / 2 insegnanti", es "Exportar 1 clases / 1 estudiantes / 2 instructores", fr "Exporter 1 cours / 1 élèves / 2 professeurs", de "1 Unterrichtsstunden exportieren / 1 Schüler exportieren / 2 Lehrkräfte exportieren" — `$SP/work/i18n/verify.log` `school-reports-tooltips-alltabs-*` (note: the tooltip has no singular form in any locale — cosmetic) |
| TCH-R2-08 year-view "MTWTFSS" | #110 | **VERIFIED FIXED LIVE (teacher)** — school calendar twin STILL OPEN | teacher: it "L,M,M,G,V,S,D", es "L,M,X,J,V,S,D", fr "L,M,M,J,V,S,D", de "M,D,M,D,F,S,S" + "6 lezioni / 6 clases / 6 cours / 6 Stunden"; school: "M,T,W,T,F,S,S" + "6 classes / 1 classes" on it/es/fr/de — `i18n-{teacher,school}-desktop-*-calendar_year.png` |
| TCH-R2-08 Performance "Present/No-show" (round-1 Teacher L3) | #110 | **VERIFIED FIXED LIVE** | it Presente/Assente, es Presente/Ausente, fr Présente/Absente, de Nicht erschienen — `i18n-teacher-desktop-*-teacher_performance.txt` |
| TCH-R2-08 library filter options | #110 | **VERIFIED FIXED LIVE** (options) / **PARTIAL** (card badges raw, I18N-R3-02) | it "Tipo/Livello/Lingua · Base/Intermedio/Avanzato · Inglese/Italiano/Francese/Spagnolo", es "Filtrar por Tipo/Nivel/Idioma · Inicial/Intermedio/Avanzado" |
| TCH-R2-08 inbox strings, `email_taken` | #110 | **VERIFIED (source + live inbox)** | `teacher.profile.errorEmailTaken` in 5 locales; inbox it "Torna alla Posta in Arrivo", "Ieri", "Scuola / Supporto HQ" |
| ST-R2-12 `school_closed` copy | #110 | **VERIFIED (source)** | `student.book.errSchoolClosed` in 5 locales; not triggered (needs a closure day) |
| ST-R2-13 `spotsLeft` plural | #110 | **VERIFIED FIXED LIVE** | "10 posti disponibili", "9 lugares disponibles", "4 places restantes", "10 verbleibende Plätze" — `i18n-student-desktop-*-student_book.txt` |
| ST-R2-14 "Septiembre De 2026" | #110 | **VERIFIED FIXED LIVE** (booking calendar) / sibling STILL OPEN (I18N-R3-05) | es "Septiembre de 2026" — `i18n-student-desktop-es-student_book.txt`; teacher attendance es "Lunes, 14 De Sept De 2026" |
| ST-R2-16 12-hour chat times | #110 | **VERIFIED FIXED LIVE** | "12:55 · Letto / Leído / Lu / Gelesen", no AM/PM in any it/es/fr/de dump |
| SCH-R2-20 school-panel hardcoded strings (R2-L3) | #112 did not touch them | **STILL OPEN** | I18N-R3-08/09; school calendar year view verified live |
| R2-L3 HQ `email_taken`/raw error codes | #109 | **VERIFIED (source)** | `hq.team.errorEmailTaken`, `school.team.errorEmailTaken` in 5 locales |

## §4 E-mails verified

None — this agent is read-only (0 registrations, 0 resets, 0 invites); no e-mail was triggered or read.

## §5 Verified good

- **770/770 page-loads returned the expected HTTP status** (200; 404 for the 404 URL), no authenticated page bounced to `/login`, no page rendered `undefined` / `NaN` / `Invalid Date` / `[object Object]`, no raw dotted i18n key, no `{var}` leak, no leftover placeholder copy, no wrong-language month/weekday name, no 12-hour time outside `en`, no MM/DD/YYYY outside `en`.
- **No horizontal document overflow on any of the 385 mobile loads**; no overlapping fixed/sticky elements (mobile top bars, student bottom nav, sticky table headers); every wide table except teacher compensation is inside `overflow-x-auto` (source-checked for 16 pages).
- **Mobile drawer: 20/20** (student/teacher/school/HQ × 5 locales) opens with the localized "Open Sidebar" button, lists the localized nav (it "Sedi/Calendario/Corsi/Lezioni/Insegnanti/Compenso/Allieve/Pacchetti…", es "Panel de Control/Ubicaciones/…", fr "Tableau de bord/Lieux/Calendrier/…", de "Standorte/Kalender/Kurse/Stunden/Lehrer/Ausgleich/Schülerinnen/…"), closes with the localized close button — `i18n-*-mobile-*-drawer.png`.
- **Language switcher (panels)**: mobile 4/4 panels and desktop 4/4 panels + the landing page (desktop EN/IT/ES/FR/DE header buttons: → `/it`, cookies set, reload keeps `/it`, locale-less `/` → `/it`) — dropdown lists 5 locales with flags, selecting one navigates to the same path under the new prefix, sets `user_locale` + `NEXT_LOCALE` cookies, survives reload, `<html lang>` follows, a locale-less link (`/student/dashboard`) redirects to the chosen locale, `PATCH /auth/me/ language_preference` is persisted and restored on switching back (API-verified).
- **Console**: zero JS errors on 770 loads other than the expected 404 on the 404 URL, the school-thread prefetch 404 and the HQ-packages API 404 (I18N-R3-14/15), and three transient `net::ERR_CONNECTION_RESET` lines (shared host).
- Auth pages it/es/fr/de fully localized (login, register incl. phone-prefix selector, reset-password → `login?error=reset_expired` without params, setup-account, select-role redirect); register form has no overflow at 390 px in fr/de.
- Student panel it/es/fr/de: dashboard, book (calendar + list + filters, correct month casing "Settembre 2026 / Septiembre de 2026 / Septembre 2026 / September 2026", weekday headers LUN/MAR/… LUN./MAR./… MO/DI/…), bookings, buy, packages, profile, shop + product, support; relative times localized ("Ieri", "23 ore fa", "hace 23 horas"…).
- Teacher panel it/es/fr/de: dashboard greeting "Hallo Teacher 👋 / Hier ist dein Stundenplan", attendance list/register with school-defined status names, calendar day/week/month/**year** (localized initials + "6 lezioni"), compensation (desktop), inbox list + thread, library filters, performance, profile.
- School panel it/es/fr/de: all 26 routes incl. course new/edit, class detail, statuses, credits, documents, reports (5 tabs + CSV buttons with localized `{count}` tooltips), settings, team, teacher invite, packages & discount codes, payments (Stripe onboarding CTA), profile.
- HQ panel it/es/fr/de: all 22 routes incl. schools list/detail/edit/new, team, permissions matrix, packages, lesson types, payments, reports (3 tabs), library, locations, shop, emails editor, brand/homepage settings, translations worklist.
- Catalogue: 3,198 keys × 5 files identical; every plural/placeholder consistent; no empty values.

## §6 Test data created / settings changed

- Objects created: **none** (0 registrations, 0 password resets, 0 invites, 0 bookings, 0 payments, no forms saved, no modals confirmed).
- Settings touched: `language_preference` of four accounts was flipped by the language switcher tests (mobile run 10:41 UTC, desktop run 10:56 UTC — the dropdown PATCHes `/auth/me/`) and flipped back through the same dropdown; verified restored via `GET /auth/me/` after each run (last check 10:58 UTC) — `qa-r2-school-student1@uberip.com` = `en`, `qa-r2-school-teacher1@uberip.com` = `it`, `qa-r2-school-b@uberip.com` = `it`, `qa.hq.owner@qa-nounder40.test` = `en` (their captured originals). Browser cookies `user_locale` / `NEXT_LOCALE` were left in the QA profiles only.
- Logins performed: 4 (`qa-r2-school-teacher1`, `qa-r2-school-student1`, `qa-r2-teacher-t1`, `qa-r2-teacher-s1` — the last two were not needed in the end, School B had data on every page); every other call used cached tokens + refresh.
- Round-2 tenants were read only; round-3 tenants B/C/E1 untouched.


## §7 Screenshots (all in `$SP/shots/`, prefix `i18n-`)

- Crawl, full page: `i18n-<role>-<desktop|mobile>-<locale>-<route-slug>.png` — 770 files (anon 40+40, student 55+60, teacher 54+55, school 130+135, hq 110+115); matching text dumps in `$SP/reports/dumps/` with the same names (`.txt`).
- Mobile drawer open: `i18n-<role>-mobile-<locale>-drawer.png` (20).
- Language switcher: `i18n-switch-<vp>-<role>-to-<locale>-{open,after}.png`, `…-back-<locale>-{open,after}.png` (mobile 15, desktop 20).
- Targeted checks (`verify.js`, `resources.js`): `i18n-teacher-desktop-<locale>-calendar_year.png`, `i18n-school-desktop-<locale>-calendar_year.png` (10), `i18n-student-desktop-<locale>-shop_orders.png` (if an orders tab existed).
- Key evidence: `i18n-teacher-mobile-it-teacher_compensation.png` (clipped table), `i18n-teacher-desktop-es-teacher_attendance.png` ("De Sept De"), `i18n-anon-mobile-it-root.png` / `i18n-anon-desktop-it-root.png` (ENTRY/INTERMEDIATE chips), `i18n-teacher-desktop-it-teacher_library.png`, `i18n-hq-mobile-en-hq_dashboard.png` (greeting), `i18n-anon-desktop-it-setup_account_uid_x_token_y.png` (R2-M11), `i18n-anon-desktop-es-this_page_does_not_exist_404.png`.

## §8 Assumptions / decisions / hazards

- Two crawler processes (desktop + mobile) ran in parallel on the two `i18n-agent*` profiles to halve wall time; they shared `tokens.json` (refresh worked without collisions — no authenticated page bounced to `/login` in 770 loads).
- A `verify.js` syntax check accidentally launched the script for ~1 s against the desktop profile while the crawl was using it (killed immediately; the crawler continued without error — checked). No effect on results.
- "Untranslated" detection = a non-English page line identical to the English page line **and** equal to an `en.json` value; classified `static-identical` when the locale file carries the same value (loan words, reported only when suspicious) and `runtime-english` when the locale file has a translation but the page shows English (real defect or data). Data-driven strings (school/course/product/member names, HQ role labels, HQ nav links, translation worklist keys, e-mail template variables) were excluded by hand after inspection.
- `PAGE-LEVEL` untranslated flag required ≥3 runtime-English UI strings; data-heavy pages (lesson types, team) otherwise trip it on names alone.
- Tap-target and ellipsis checks are reported as cosmetic (Low) because they follow a consistent design system, not a defect in one locale.
- The 429 throttle body (R2-M15) was **not** triggered (shared IP budget); verified in code only: `register/page.tsx:117`, `reset-password/page.tsx:84`, `login/page.tsx:117/190` map 429/503 to `tooManyAttempts`, present in all 5 locales.
- `student.book.spotsLeft` singular branch and `student.book.errSchoolClosed` (needs a closure day) could not be observed live without creating data; verified at the source.
- Browser locale of the QA profiles is `en-US`; any date that followed the browser instead of the URL locale would show as English on it/es/fr/de pages — none did in the crawl, except the shop order date path (I18N-R3-10) which had no orders to render.
- `verify.js` step 6 (failing-resource capture) crashed on the school thread page because `qa.injectJwt` waits for network-idle, which that page never reaches (see I18N-R3-14 prefetch); it was re-run as `resources.js` with `waitUntil: load` + 6 s settle — results in `resources.log`/`resources.json`. `verify.json` was therefore never written; the per-step results are in `verify.log`.
- A first desktop switcher run failed to parse (a dollar-quote sequence in a programmatic patch); the script was rewritten and re-run — switch-desktop.log / switch-desktop.json are from the clean run.
- /hq/debug renders 55 characters ("Translation Debug") — developer page, not assessed.

## Appendix — static analysis detail
## Static analysis results (message catalogue + source grep)

**Message catalogue** (`$SP/reports/dumps/i18n-static-check.txt`):
- All five files share the identical set of **3,198 flattened keys** (0 missing / 0 extra per locale; round 2 counted 3,083, PR #109 3,170 — the extra keys are the PR #109/#110 additions).
- ICU: no unbalanced braces in any locale. Every `{count, plural, …}` present in `en` is present in it/es/fr/de (and vice-versa), every plural has an `other {}` branch. Placeholder sets are identical across locales for every key (proper ICU walk; the only parser exceptions are `emailEditor.linkPrompt` where `'{{booking_url}}'` is correctly apostrophe-escaped literal text — OK).
- `<`/`>` in messages: only `studentPreview.noMedia` / `noDescription` ("HQ > Lesson Types") in all 5 locales — a bare `>` is not a tag and next-intl renders it; not an ICU error (renders as plain text).
- R2 keys at the source: `hq.dashboard.welcome` = "Welcome, {name}" / "Benvenuto, {name}" / … (R2-L1 fixed); `hq.locations.citiesLabel` proper plural in all 5 (X-R2-10 fixed); `school.reports.export{Lessons,Students,Teachers}Tooltip` all carry `{count}` (X-R2-10 fixed); `student.book.spotsLeft` proper plural in all 5 (ST-R2-13 fixed); `student.book.errSchoolClosed` exists in all 5 (ST-R2-12 fixed); `teacher.calendar.weekdayInitials` = `L,M,M,G,V,S,D` (it) / `L,M,X,J,V,S,D` (es) / `L,M,M,J,V,S,D` (fr) / `M,D,M,D,F,S,S` (de) (TCH-R2-08 fixed); `auth.setup.welcomeDesc`, `hq.permissions.role*Desc`, `hq.packages.placeholderDescription`, `school.statuses.defaultStatusDesc/defaultBadge` now carry real copy in all locales (R2-M11 fixed at the source); `teacher.profile.errorEmailTaken` exists in all 5 (TCH-R2-08 `email_taken`).
- Values identical to English in a non-English file: 264 hits, the large majority legitimate loans/identical words (Date, Description, Notes, Code, Name, Format, Transactions, Panel, Shop, Team, VIP, POS, Logo, HTML …). The ones that look genuinely untranslated (listed as I18N-R3 findings below): `hq.reports.columnFee` = "Fee" in **it/es/fr/de**; `school.reports.noLessonsMatch` = "No Lessons Match" in **it/fr**; `hq.reports.columnNoShow`/`kpiNoShows` = "No-shows" in **es**; `school.calendar.rowCredits` / `school.classes.edit.labelCredits` = "Credits" in **de**; `scheduleFields.cap` / `school.courses.*.cap` / `school.classes.edit.cap` / `school.locations.capPlaceholder` = "cap." in **it/es/fr** ("cap." reads as *CAP = postal code* in Italian); `school.statuses.burnsCreditBadge` = "absence" in **fr** (en value is also "absence"); `hq.brand-settings.colorPrimaryLabel` = "Accent" in fr (acceptable); `student.buy.perInterval` = "Per {interval}" in **it** (acceptable, "Per" is Italian). `hq.library.title` / `teacher.library.title` = "Metodo Library" everywhere (brand-like, left as is).
- Placeholder-looking values (R2-M11 pattern): none left. Every "Descrizione/Descripción/Description/Beschreibung" hit is a genuine field label (`labelDescription`) or an input placeholder key. No TODO/Lorem/TBD.
- Empty values: none.

**Hardcoded user-facing strings in `frontend/src` (file:line, all outside `t()`)** — grep for `confirm(`, `alert(`, literal `placeholder=`/`title=`/`aria-label=`, fixed-locale `toLocale*`, `Intl.*Format('…')`, weekday arrays, CSV headers, literal JSX text:
- `app/[locale]/school/settings/statuses/page.tsx:115` `confirm('Delete this status?')`
- `app/[locale]/school/compensation/page.tsx:164` `confirm('Delete this compensation plan?')`
- `app/[locale]/school/team/page.tsx:174` ``confirm(`Are you sure you want to remove this ${isPending ? 'pending invitation' : 'team member'}?`)`` and `:146` `setError('Email and name are required')`
- `app/[locale]/school/teachers/page.tsx:84` ``setSuccess(`Invitation resent to ${name}.`)``, `:88` ``setSuccess(`Error: ${errCode ?? 'Failed to resend'}`)``
- `app/[locale]/hq/lesson-types/page.tsx:217` `setError('Error')`
- `app/[locale]/school/calendar/CalendarClient.tsx:398-421` "Add Class to Existing Course", "Course *", "Date *", "Start Time *", "Duration (min)", `:404` `<option>Select course...`, `:634` ``{monthLessons.length} classes``, **`:637` `['M','T','W','T','F','S','S']` year-view weekday initials** (the school-calendar twin of TCH-R2-08, which PR #110 fixed only in `teacher/calendar/page.tsx`), `:738` "Loading..."
- `app/[locale]/school/courses/CoursesClient.tsx:524` "Loading course details...", `:535-661` bulk-edit modal labels ("Lesson Type", "Default Teacher", "Start Time", "Duration (min)", "Max Capacity", "Reserve Spots", "Min Booking Notice (hours)", "Calendar Color", "Course Name", "Description", "Notes", "Online / In-Person", "Waitlist"), `:547` "No teacher", `:561-625` ×9 `placeholder="— unchanged —"`, `:686` "Apply changes to future classes too", `:724` "No courses yet."
- `app/[locale]/school/courses/[id]/page.tsx:458` "Changes saved to all selected classes.", `:587-625` ×4 `placeholder="— unchanged —"`, `:597/605/618` "No teacher" / "No room" / "No plan", `:628` "Online / In-Person"
- `app/[locale]/school/compensation/page.tsx:188` `placeholder="e.g. Standard, Senior, Guest"`, `:216` `"e.g. 5"`, `:230` `"e.g. 9 (or leave empty)"`
- `app/[locale]/school/locations/page.tsx:291` `placeholder="Google Maps URL"`
- `components/PackagesManager.tsx:518` `placeholder="e.g. Starter Pack"`, `:527` `"Short description..."`, `:778` badge text "Popular" (shared by `/school/packages` and `/hq/packages`)
- `app/[locale]/hq/emails/page.tsx:615` `placeholder="© No Under 40 · Classical Dance Network"` (English tagline as footer placeholder), `:763` iframe `title="Email preview"`
- `app/[locale]/hq/schools/[id]/page.tsx:63` "Not found."
- `app/[locale]/school/settings/statuses/page.tsx:196,327` and `components/ui/ColorPicker.tsx:56` `title="Custom color"`; `components/ui/ErrorBanner.tsx:15` `aria-label="Dismiss"`
- `app/not-found.tsx:11` "Pagina non trovata · Page not found" — the 404 page lives outside `[locale]`, so es/fr/de users get an it/en page (crawled: identical in all 5 locales)
- CSV/PDF exports: `app/[locale]/hq/payments/page.tsx:34` header row `['Date','School','City','Student','Email','Product','Type','Amount (€)','HQ Fee (€)','School Amount (€)','Status','Payment Method']` hardcoded English; `app/[locale]/school/reports/page.tsx:101` `headers = Object.keys(rows[0])` → raw API field names as CSV headers (all 5 export buttons on the page); `app/[locale]/school/students/page.tsx:77` PDF title `'Students List'` + `lib/export.ts:55` ``Exported: ${new Date().toLocaleDateString('en-GB')}`` (English label + en-GB date) on every locale; `hq/reports/page.tsx:159,164` `'Email'` literal header (harmless).
- Fixed / missing locale in formatting: `app/[locale]/school/documents/page.tsx:205` `toLocaleDateString('it', …)` (numeric dd/mm/yy — harmless in it/es/fr, wrong separators for de "dd.mm.yy"); `app/[locale]/student/shop/page.tsx:188` `toLocaleDateString(undefined, {month:'long'…})` → **browser** locale, not the app locale (same defect class as ST-R2-16 — live check in the findings below); `components/DiscountCodesManager.tsx:305` `toLocaleDateString()` (no locale; shared HQ + school discount codes); `components/landing/LandingStats.tsx:97` `toLocaleString()` (thousands separator follows the browser); `app/[locale]/student/buy/page.tsx:560,582` `new Intl.NumberFormat('en-EU', …)` — "en-EU" is not a real locale, resolves to `en` → "€10.00" style in all locales; `lib/format-date.ts:26` `formatLessonDate` uses `'en-GB'` but is unused (dead code; the live `lib/lesson-format.ts` version takes the UI locale).
- `hour12`: no occurrences left (ST-R2-16 fixed in `ChatWindow.tsx`; `school/credits` already passed the UI locale).
