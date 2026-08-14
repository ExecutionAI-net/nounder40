# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: student\other-pages.spec.ts >> Student — Access control >> blocked from /hq/dashboard
- Location: tests\e2e\student\other-pages.spec.ts:38:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/hq/dashboard
Call log:
  - navigating to "http://localhost:3000/en/hq/dashboard", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | import path from 'node:path'
  3  | 
  4  | test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })
  5  | 
  6  | test.describe('Student — Other pages load', () => {
  7  |   const pages: Array<[string, string, RegExp]> = [
  8  |     ['/en/student/shop', 'Shop', /\/student\/shop/],
  9  |     ['/en/student/support', 'Support', /\/student\/support/],
  10 |     ['/en/student/profile', 'Profile', /\/student\/profile/],
  11 |   ]
  12 | 
  13 |   for (const [url, heading, urlPattern] of pages) {
  14 |     test(`${url} loads`, async ({ page }) => {
  15 |       await page.goto(url)
  16 |       await expect(page).toHaveURL(urlPattern)
  17 |       await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15000 })
  18 |     })
  19 |   }
  20 | })
  21 | 
  22 | test.describe('Student — Profile tabs', () => {
  23 |   test('shows Profile and Documents tabs', async ({ page }) => {
  24 |     await page.goto('/en/student/profile')
  25 |     await expect(page.getByRole('button', { name: /^Profile$/ })).toBeVisible({ timeout: 15000 })
  26 |     await expect(page.getByRole('button', { name: /^Documents$/ })).toBeVisible()
  27 |   })
  28 | 
  29 |   test('can switch to Documents tab', async ({ page }) => {
  30 |     await page.goto('/en/student/profile')
  31 |     await page.getByRole('button', { name: /^Documents$/ }).click()
  32 |     // Documents tab should show upload controls or existing documents
  33 |     await expect(page.getByRole('button', { name: /^Documents$/ })).toHaveClass(/border-\[#6B1F3A\]|text-\[#6B1F3A\]/)
  34 |   })
  35 | })
  36 | 
  37 | test.describe('Student — Access control', () => {
  38 |   test('blocked from /hq/dashboard', async ({ page }) => {
> 39 |     await page.goto('/en/hq/dashboard')
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/hq/dashboard
  40 |     await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  41 |   })
  42 | 
  43 |   test('blocked from /school/dashboard', async ({ page }) => {
  44 |     await page.goto('/en/school/dashboard')
  45 |     await expect(page).not.toHaveURL(/\/school\/dashboard/)
  46 |   })
  47 | 
  48 |   test('blocked from /teacher/dashboard', async ({ page }) => {
  49 |     await page.goto('/en/teacher/dashboard')
  50 |     await expect(page).not.toHaveURL(/\/teacher\/dashboard/)
  51 |   })
  52 | })
  53 | 
  54 | test.describe('Student — API contracts', () => {
  55 |   test('GET /api/student/credits', async ({ request }) => {
  56 |     const res = await request.get('/api/student/credits')
  57 |     expect(res.ok()).toBe(true)
  58 |   })
  59 | 
  60 |   test('GET /api/student/lessons', async ({ request }) => {
  61 |     const res = await request.get('/api/student/lessons')
  62 |     expect(res.ok()).toBe(true)
  63 |   })
  64 | 
  65 |   test('GET /api/student/packages', async ({ request }) => {
  66 |     const res = await request.get('/api/student/packages')
  67 |     expect(res.ok()).toBe(true)
  68 |   })
  69 | 
  70 |   test('GET /api/student/subscriptions', async ({ request }) => {
  71 |     const res = await request.get('/api/student/subscriptions')
  72 |     expect(res.ok()).toBe(true)
  73 |   })
  74 | 
  75 |   test('GET /api/student/documents', async ({ request }) => {
  76 |     const res = await request.get('/api/student/documents')
  77 |     expect(res.ok()).toBe(true)
  78 |   })
  79 | 
  80 |   test('GET /api/student/shop', async ({ request }) => {
  81 |     const res = await request.get('/api/student/shop')
  82 |     expect(res.ok()).toBe(true)
  83 |   })
  84 | 
  85 |   test('GET /api/student/school-packages', async ({ request }) => {
  86 |     const res = await request.get('/api/student/school-packages')
  87 |     expect(res.ok()).toBe(true)
  88 |   })
  89 | })
  90 | 
```