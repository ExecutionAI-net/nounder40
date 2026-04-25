# Load testing (k6)

Stress + scenario tests for No Under 40, run via [k6](https://k6.io). Used both locally to spot regressions and nightly in CI to track production capacity.

## Layout

```
tests/load/
├── lib/
│   ├── config.js          shared env + constants (BASE_URL, SUPABASE_URL, ...)
│   └── auth.js            login helper for k6 VUs
├── scenarios/
│   ├── login-throughput.js   ramp 0→25 VUs hitting /auth/v1/token
│   ├── booking-race.js       N students stampede same lesson
│   ├── browse-and-book.js    realistic student session
│   └── dashboard-hq.js       sustained HQ dashboard reads
├── reporters/
│   └── slack-loadtest.mjs    posts a k6 summary to Slack via Block Kit
├── results/                  (gitignored) k6 --summary-export targets
├── seed.mjs                  Node script: creates students + test lesson
├── teardown.mjs              Node script: removes everything seed created
└── README.md
```

## One-time setup

Install k6:

```bash
# macOS
brew install k6
# Windows (winget)
winget install k6 --source winget
# Linux
sudo apt install k6
```

Required env in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_service_...
LOAD_SCHOOL_ID=<uuid of a real school>
LOAD_COURSE_ID=<uuid of a real course belonging to that school>
```

`LOAD_COURSE_ID` is used as the template for the test lesson — its room, teacher, lesson_type, and start_time are copied onto a fresh lesson dated tomorrow.

## Run locally

```bash
# 1. Seed (creates 20 students + a fresh test lesson)
npm run loadtest:seed
#   → prints { LOAD_LESSON_ID: "<uuid>", ... } — copy this UUID

# 2. Pick a scenario
LOAD_LESSON_ID=<uuid> npm run loadtest:booking
LOAD_LESSON_ID=<uuid> npm run loadtest:journey
npm run loadtest:login        # no lesson required
HQ_EMAIL=... HQ_PASSWORD=... npm run loadtest:hq

# 3. Clean up when done
LOAD_LESSON_ID=<uuid> npm run loadtest:teardown
```

`npm run loadtest:all` runs all four scenarios sequentially (you still need to pre-seed and export `LOAD_LESSON_ID`).

## What each scenario proves

| Scenario | What we check | Threshold |
|---|---|---|
| **login-throughput** | Supabase `/token` survives a morning rush | `p95 < 1500ms`, `fail < 1%` |
| **booking-race** | Capacity holds under simultaneous booking attempts; no 5xx, no overbooking | `successes == capacity`, no 5xx |
| **browse-and-book** | Realistic student flow stays responsive end-to-end | lessons p95 < 800ms, detail p95 < 600ms |
| **dashboard-hq** | Network-wide aggregates don't slow down with concurrent admins | p95 < 2000ms |

The booking-race scenario is a regression guard for the `current_bookings` race we hit earlier — if anyone reverts that fix, this test will fail loudly (more 2xx than `LOAD_LESSON_CAPACITY`).

## CI (nightly)

`.github/workflows/loadtest-nightly.yml` runs every night at 03:00 UTC against staging. Required GitHub secrets:

- `LOADTEST_BASE_URL` — staging URL
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `LOADTEST_SCHOOL_ID`, `LOADTEST_COURSE_ID`
- `LOADTEST_HQ_EMAIL`, `LOADTEST_HQ_PASSWORD`
- `SLACK_WEBHOOK_URL`

Each scenario posts a Block Kit summary to Slack with request count, fail rate, p95 latency, and a link back to the GitHub Actions run. Results are also uploaded as artifacts (30-day retention).

You can trigger an ad-hoc run from the Actions tab — pick a single scenario or `all`.

## Cleaning up if a run crashed

If a run dies before teardown, the next run's seed is idempotent (upserts users) so it won't break, but you can manually clean by running:

```bash
LOAD_LESSON_ID=<uuid> npm run loadtest:teardown
```

This removes all `loadtest+s*@alinaquintana.com` users plus any lingering bookings/lesson rows tied to the given lesson.
