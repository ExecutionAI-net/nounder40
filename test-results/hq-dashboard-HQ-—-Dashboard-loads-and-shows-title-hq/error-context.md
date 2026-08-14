# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hq\dashboard.spec.ts >> HQ — Dashboard >> loads and shows title
- Location: tests\e2e\hq\dashboard.spec.ts:11:7

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/hq\/dashboard/
Received string:  "http://localhost:3000/en/login?next=%2Fen%2Fhq%2Fdashboard"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    9 × unexpected value "http://localhost:3000/en/login?next=%2Fen%2Fhq%2Fdashboard"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - heading "No Under 40" [level=1] [ref=e5]
      - paragraph [ref=e6]: Sign in to your account
    - button "Continue with Google" [ref=e7]:
      - img [ref=e8]
      - text: Continue with Google
    - generic [ref=e17]: or continue with email
    - generic [ref=e18]:
      - generic [ref=e19]:
        - generic [ref=e20]: Email
        - textbox "Email" [ref=e21]:
          - /placeholder: you@example.com
      - generic [ref=e22]:
        - generic [ref=e23]: Password
        - textbox "Password" [ref=e24]:
          - /placeholder: ••••••••
      - button "Sign in" [ref=e25]
      - button "Forgot password?" [ref=e27]
    - paragraph [ref=e28]:
      - text: Don't have an account?
      - link "Register" [ref=e29] [cursor=pointer]:
        - /url: /en/register
  - button "Open Next.js Dev Tools" [ref=e35] [cursor=pointer]:
    - img [ref=e36]
  - alert [ref=e39]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | import path from 'node:path'
  3  | 
  4  | test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })
  5  | 
  6  | test.describe('HQ — Dashboard', () => {
  7  |   test.beforeEach(async ({ page }) => {
  8  |     await page.goto('/en/hq/dashboard')
  9  |   })
  10 | 
  11 |   test('loads and shows title', async ({ page }) => {
> 12 |     await expect(page).toHaveURL(/\/hq\/dashboard/)
     |                        ^ Error: expect(page).toHaveURL(expected) failed
  13 |     await expect(page.getByRole('heading', { name: 'HQ Dashboard' })).toBeVisible()
  14 |   })
  15 | 
  16 |   test('shows welcome text with admin name', async ({ page }) => {
  17 |     await expect(page.getByText(/Welcome back, Test HQ/)).toBeVisible()
  18 |   })
  19 | 
  20 |   test('shows SUPER ADMIN badge', async ({ page }) => {
  21 |     await expect(page.getByText(/super admin/i)).toBeVisible()
  22 |   })
  23 | 
  24 |   test('shows 4 KPI cards', async ({ page }) => {
  25 |     await expect(page.getByText('Active Schools')).toBeVisible()
  26 |     await expect(page.getByText('Total Students')).toBeVisible()
  27 |     await expect(page.getByText('Weekly Lessons')).toBeVisible()
  28 |     await expect(page.getByText('Active Subscriptions')).toBeVisible()
  29 |   })
  30 | 
  31 |   test('shows + New School quick action button', async ({ page }) => {
  32 |     await expect(page.getByRole('link', { name: /\+ New School/ })).toBeVisible()
  33 |   })
  34 | 
  35 |   test('shows Recent Schools section', async ({ page }) => {
  36 |     await expect(page.getByRole('heading', { name: 'Recent Schools' })).toBeVisible()
  37 |     await expect(page.getByRole('link', { name: 'View all' })).toBeVisible()
  38 |   })
  39 | 
  40 |   test('Recent Schools links open school detail', async ({ page }) => {
  41 |     const firstSchoolLink = page.locator('a[href^="/hq/schools/"]').first()
  42 |     await expect(firstSchoolLink).toBeVisible()
  43 |   })
  44 | })
  45 | 
  46 | test.describe('HQ — Sidebar navigation', () => {
  47 |   test('navigates to Schools', async ({ page }) => {
  48 |     await page.goto('/en/hq/dashboard')
  49 |     await page.getByRole('link', { name: 'Schools', exact: true }).click()
  50 |     await expect(page).toHaveURL(/\/hq\/schools/)
  51 |   })
  52 | 
  53 |   test('navigates to Team', async ({ page }) => {
  54 |     await page.goto('/en/hq/dashboard')
  55 |     await page.getByRole('link', { name: 'Team', exact: true }).click()
  56 |     await expect(page).toHaveURL(/\/hq\/team/)
  57 |   })
  58 | 
  59 |   test('navigates to Lesson Types', async ({ page }) => {
  60 |     await page.goto('/en/hq/dashboard')
  61 |     await page.getByRole('link', { name: 'Lesson Types', exact: true }).click()
  62 |     await expect(page).toHaveURL(/\/hq\/lesson-types/)
  63 |   })
  64 | 
  65 |   test('navigates to Payments', async ({ page }) => {
  66 |     await page.goto('/en/hq/dashboard')
  67 |     await page.getByRole('link', { name: 'Payments', exact: true }).click()
  68 |     await expect(page).toHaveURL(/\/hq\/payments/)
  69 |   })
  70 | 
  71 |   test('navigates to Reports', async ({ page }) => {
  72 |     await page.goto('/en/hq/dashboard')
  73 |     await page.getByRole('link', { name: 'Reports', exact: true }).click()
  74 |     await expect(page).toHaveURL(/\/hq\/reports/)
  75 |   })
  76 | 
  77 |   test('navigates to Inbox', async ({ page }) => {
  78 |     await page.goto('/en/hq/dashboard')
  79 |     await page.getByRole('link', { name: 'Inbox', exact: true }).click()
  80 |     await expect(page).toHaveURL(/\/hq\/inbox/)
  81 |   })
  82 | })
  83 | 
```