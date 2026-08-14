# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: teacher\dashboard.spec.ts >> Teacher — Sidebar navigation >> navigates to Performance
- Location: tests\e2e\teacher\dashboard.spec.ts:44:9

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/teacher\/performance/
Received string:  "http://localhost:3000/en/teacher/dashboard"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    9 × unexpected value "http://localhost:3000/en/teacher/dashboard"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - text: No Under 40
          - generic [ref=e6]: Teacher Panel
          - generic [ref=e7]:
            - generic [ref=e8]: Test Teacher
            - generic [ref=e9]: support+teacher@alinaquintana.com
        - navigation [ref=e10]:
          - link "Dashboard" [ref=e11] [cursor=pointer]:
            - /url: /en/teacher/dashboard
          - link "Calendar" [ref=e12] [cursor=pointer]:
            - /url: /en/teacher/calendar
          - link "Attendance" [ref=e13] [cursor=pointer]:
            - /url: /en/teacher/attendance
          - link "Performance" [active] [ref=e14] [cursor=pointer]:
            - /url: /en/teacher/performance
          - link "Compensation" [ref=e15] [cursor=pointer]:
            - /url: /en/teacher/compensation
          - link "Library" [ref=e16] [cursor=pointer]:
            - /url: /en/teacher/library
          - link "Inbox" [ref=e17] [cursor=pointer]:
            - /url: /en/teacher/inbox
          - link "Profile" [ref=e18] [cursor=pointer]:
            - /url: /en/teacher/profile
        - combobox [ref=e20] [cursor=pointer]:
          - option "🇬🇧 EN" [selected]
          - option "🇮🇹 IT"
          - option "🇪🇸 ES"
          - option "🇫🇷 FR"
          - option "🇩🇪 DE"
        - button "Sign Out" [ref=e22]
    - main [ref=e23]:
      - generic [ref=e25]:
        - generic [ref=e26]:
          - heading "Hi, Test" [level=1] [ref=e27]
          - paragraph [ref=e28]: Here's your schedule for today.
        - generic [ref=e29]:
          - heading "Today" [level=2] [ref=e30]
          - generic [ref=e31]: No lessons today.
        - generic [ref=e32]:
          - heading "Next 7 Days" [level=2] [ref=e33]
          - generic [ref=e34]: No upcoming lessons.
    - button "Close sidebar" [ref=e35]:
      - img [ref=e36]
      - text: Close sidebar
  - button "Open Next.js Dev Tools" [ref=e43] [cursor=pointer]:
    - img [ref=e44]
  - alert [ref=e47]
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | import path from 'node:path'
  3   | 
  4   | test.use({ storageState: path.join(__dirname, '../../.auth/teacher.json') })
  5   | 
  6   | test.describe('Teacher — Dashboard', () => {
  7   |   test.beforeEach(async ({ page }) => {
  8   |     await page.goto('/en/teacher/dashboard')
  9   |   })
  10  | 
  11  |   test('loads', async ({ page }) => {
  12  |     await expect(page).toHaveURL(/\/teacher\/dashboard/)
  13  |   })
  14  | 
  15  |   test('shows personalized greeting', async ({ page }) => {
  16  |     await expect(page.getByRole('heading', { name: /^Hi,/ })).toBeVisible()
  17  |   })
  18  | 
  19  |   test('shows schedule subtitle', async ({ page }) => {
  20  |     await expect(page.getByText(/Here's your schedule/i)).toBeVisible()
  21  |   })
  22  | 
  23  |   test('shows Today section', async ({ page }) => {
  24  |     await expect(page.getByText(/^Today$/)).toBeVisible()
  25  |   })
  26  | 
  27  |   test('shows Next 7 Days section', async ({ page }) => {
  28  |     await expect(page.getByText('Next 7 Days')).toBeVisible()
  29  |   })
  30  | })
  31  | 
  32  | test.describe('Teacher — Sidebar navigation', () => {
  33  |   const links: Array<[string, RegExp]> = [
  34  |     ['Calendar', /\/teacher\/calendar/],
  35  |     ['Attendance', /\/teacher\/attendance/],
  36  |     ['Performance', /\/teacher\/performance/],
  37  |     ['Compensation', /\/teacher\/compensation/],
  38  |     ['Inbox', /\/teacher\/inbox/],
  39  |     ['Library', /\/teacher\/library/],
  40  |     ['Profile', /\/teacher\/profile/],
  41  |   ]
  42  | 
  43  |   for (const [label, urlPattern] of links) {
  44  |     test(`navigates to ${label}`, async ({ page }) => {
  45  |       await page.goto('/en/teacher/dashboard')
  46  |       await page.getByRole('link', { name: label, exact: true }).click()
> 47  |       await expect(page).toHaveURL(urlPattern)
      |                          ^ Error: expect(page).toHaveURL(expected) failed
  48  |     })
  49  |   }
  50  | })
  51  | 
  52  | test.describe('Teacher — Sub-pages load with correct heading', () => {
  53  |   const pages: Array<[string, string, RegExp]> = [
  54  |     ['/en/teacher/calendar', 'Calendar', /\/teacher\/calendar/],
  55  |     ['/en/teacher/attendance', 'Attendance', /\/teacher\/attendance/],
  56  |     ['/en/teacher/performance', 'Performance', /\/teacher\/performance/],
  57  |     ['/en/teacher/compensation', 'Compensation', /\/teacher\/compensation/],
  58  |     ['/en/teacher/inbox', 'Inbox', /\/teacher\/inbox/],
  59  |     ['/en/teacher/library', 'Metodo Library', /\/teacher\/library/],
  60  |     ['/en/teacher/profile', 'Profile', /\/teacher\/profile/],
  61  |   ]
  62  | 
  63  |   for (const [url, heading, urlPattern] of pages) {
  64  |     test(`${url} loads`, async ({ page }) => {
  65  |       await page.goto(url)
  66  |       await expect(page).toHaveURL(urlPattern)
  67  |       await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15000 })
  68  |     })
  69  |   }
  70  | })
  71  | 
  72  | test.describe('Teacher — Access control', () => {
  73  |   test('blocked from /hq/dashboard', async ({ page }) => {
  74  |     await page.goto('/en/hq/dashboard')
  75  |     await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  76  |   })
  77  | 
  78  |   test('blocked from /school/dashboard', async ({ page }) => {
  79  |     await page.goto('/en/school/dashboard')
  80  |     await expect(page).not.toHaveURL(/\/school\/dashboard/)
  81  |   })
  82  | 
  83  |   test('blocked from /student/dashboard', async ({ page }) => {
  84  |     await page.goto('/en/student/dashboard')
  85  |     await expect(page).not.toHaveURL(/\/student\/dashboard/)
  86  |   })
  87  | })
  88  | 
  89  | test.describe('Teacher — API contracts', () => {
  90  |   test('GET /api/teacher/lessons', async ({ request }) => {
  91  |     const res = await request.get('/api/teacher/lessons')
  92  |     expect(res.ok()).toBe(true)
  93  |   })
  94  | 
  95  |   test('GET /api/teacher/calendar', async ({ request }) => {
  96  |     const res = await request.get('/api/teacher/calendar')
  97  |     expect(res.ok()).toBe(true)
  98  |   })
  99  | 
  100 |   test('GET /api/teacher/stats', async ({ request }) => {
  101 |     const res = await request.get('/api/teacher/stats')
  102 |     expect(res.ok()).toBe(true)
  103 |   })
  104 | 
  105 |   test('GET /api/teacher/compensation', async ({ request }) => {
  106 |     const res = await request.get('/api/teacher/compensation')
  107 |     expect(res.ok()).toBe(true)
  108 |   })
  109 | 
  110 |   test('GET /api/teacher/library', async ({ request }) => {
  111 |     const res = await request.get('/api/teacher/library')
  112 |     expect(res.ok()).toBe(true)
  113 |   })
  114 | })
  115 | 
```