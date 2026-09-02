# Cleanup report — August 16, 2026

Full-codebase cleanup pass (~45,000 lines, 298 files) using knip, eslint, tsc and jscpd, plus manual verification of every removal. **No behavior changes** except the two security items below. Production build verified after all changes.

---

## 1. Security

### `.env.test` removed from git
The file was tracked and contained the **Supabase service role key** (bypasses RLS) plus the test account passwords. Now:
- removed from tracking (kept on disk for local test runs);
- added `.env.test.example` with placeholders;
- `.gitignore` updated so `*.example` templates stay trackable.

> ⚠️ **Manual action required:** the key remains in git history — it must be **rotated** from the Supabase dashboard (Settings → API → rotate service role key) and updated in `.env.local` / Vercel / `.env.test`.

### `/api/dev` routes secured
- `GET /api/dev/debug-translations`: **deleted** (unauthenticated debug endpoint using the service key; no callers in the codebase).
- `GET /api/dev/revalidate-translations`: **protected** — in production it now requires an authenticated HQ user (stays open in local dev). Still works from the browser when logged in as HQ.

## 2. Git ballast removed

| What | Detail |
|---|---|
| `playwright-report/` | 61 MB / 73 files of test output tracked by mistake (ignore rules already existed but the files were committed before them) |
| `CODE_REVIEW_REPORT.{html,md,pdf}` + `CODE_REVIEW_SUMMARY.txt` | artifacts of a past review |
| `tests/load/results/login-smoke.json` | k6 output; added ignore rule for `tests/load/results/` |

## 3. Dead code removed

**Entire files** (never imported anywhere):
- `src/lib/api-error.ts`
- `src/types/index.ts`

**npm dependencies uninstalled:**
- `@lexical/utils` (never imported)
- `@types/dompurify` (dompurify v3 ships its own types)
- `dompurify` (the only two functions using it were themselves dead — see below)

**Dead functions/blocks deleted:**
- `sanitizeInput` and `sanitizeHtml` in `src/lib/sanitize.ts` (the two used ones remain: `sanitizeRichText`, `richTextToPlain`)
- `welcomeEmailHtml` in `src/lib/email-templates.ts` (~50 lines of legacy template: the system now uses DB-stored templates)
- `ROLE_LABELS` in `src/lib/hq-permissions.ts`
- `ClosureBanner` in `school/calendar/CalendarClient.tsx` (component defined but never rendered)
- `getYouTubeEmbedUrl` in `hq/library/page.tsx` (duplicate, never called)
- `docFileCount` in `src/lib/documents.ts`
- `MAX_ACTIVE_PACKAGES_PER_BOOKING` in `src/lib/constants.ts`
- `StudentDoc` interface, `LANGUAGES` constant, `DOC_LABELS`, `PhoneInput` import in `student/profile/page.tsx` (half-finished refactor)
- useless DB queries: the `stripe_customer_id` lookup in the Stripe checkout (result never used) and the `platform_fee_percentage` lookup in the webhook's "package cancelled" branch (same) — two round-trips saved
- `currentUserId` prop of `ChatWindow` (never read by the component; removed from its 4 callers)

**Exports made private** (only used within their own file):
`PALETTE` (ColorPicker), `ImageNode` (EmailRichEditor), `splitPhone` (PhoneInput), `shade` (brand.ts), `NAV_ITEMS` + `hasPermission` (hq-permissions), `DOC_ALLOWED_MIME`/`MAX_DOC_FILES`/`MAX_DOC_SIZE` (documents.ts).

**Deliberately kept** (not accidental dead code — spec-mandated features that were never wired up):
- `sendLessonCancelledBySchoolEmail` — the spec requires emailing booked students when a school cancels a lesson; today `DELETE /api/school/classes/[classId]` refunds credits **without notifying anyone**
- `sendWelcomeEmail` — post-registration welcome email
- `sendHQNewSchoolEmail` — HQ notification for a newly registered school

These three should be **wired up**, not deleted (added to the project to-do list).

## 4. Lint & hygiene

- **eslint: from 4 errors + 47 warnings → 0 errors + 6 warnings.**
  - fixed the 4 `prefer-const` in the role layouts, ~10 stale `eslint-disable` directives, ~20 dead variables/imports across API files and pages
  - the 2 ternaries used as statements (`toggleSelect`) rewritten as if/else
  - added config: `_prefixed` names are recognized as "intentionally unused"
- Fixed 1 TypeScript error in `student/profile/page.tsx` (`language_preference` missing from the second select)
- knip config in `package.json` to silence known false positives (`dotenv` used by scripts, `eslint-config-next` used by the eslint config)
- Misleading comment fixed in `api/student/lessons` (the online link is hidden for everyone in search, not just anonymous users)

## 5. Not touched (to evaluate separately)

**Pre-existing TypeScript errors (9)** — they need real attention, not mechanical fixes:
- `api/bookings/route.ts` and `api/school/classes/[classId]/route.ts`: Supabase queries passed where a `Promise` is expected / `.catch` on a builder — works at runtime but the types lie
- `hq/homepage-settings/page.tsx`: property access on `{}`
- `api/account/process-invite/route.ts`: `name` property not in the selected type

**Remaining eslint warnings (6)** — behavioral, best decided case by case:
- 3× `useEffect` with missing dependencies (library ×2, payments)
- 3× `<img>` instead of `<Image>` (library ×2, ProductGallery)

**Duplication (jscpd: 92 clones, ~1,600 lines)** — real refactors, to tackle as separate tasks in risk order:
1. **Attendance API**: `api/attendance/[lessonId]` ↔ `api/school/attendance/[lessonId]` — 56 identical lines of business logic (credit burn/confirm). A future fix would have to be made twice: extract into a shared module. **The most important one.**
2. Calendar: `school/CalendarClient` ↔ `teacher/calendar` (~120 lines across 3 blocks)
3. Attendance pages school ↔ teacher (~100 lines)
4. Cron `lesson-reminder-1day` ↔ `2hour` (~80 lines)
5. Auth boilerplate in API routes: `requireRole()` exists in `lib/api/guards.ts` but only ~10 routes out of dozens use it
6. Duplicated local helpers: `timeAgo` ×4, `formatDate` ×6 (`lib/format-date.ts` already exists, barely adopted)

**49 server-side `console.log`** (webhook, auth callback) — useful for debugging on Vercel but some log user ids/emails: consider a leveled logger.

---

*Final verification: `next build` ok · eslint 0 errors · tsc pre-existing errors only · knip clean (only the 3 deliberately kept email helpers and 4 harmless type exports remain).*
