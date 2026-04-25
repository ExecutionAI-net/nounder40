import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ — Payments page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/payments')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/hq\/payments/)
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
  })

  test('shows 4 KPI cards', async ({ page }) => {
    await expect(page.getByText(/Total GMV/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Platform Fees/i).first()).toBeVisible()
    await expect(page.getByText(/Fees This Month|Monthly/i)).toBeVisible()
    await expect(page.getByText(/Transactions/i).first()).toBeVisible()
  })

  test('shows Export CSV button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible()
  })

  test('shows status filter', async ({ page }) => {
    const statusSelect = page.locator('select').first()
    await expect(statusSelect).toBeVisible()
  })
})

test.describe('HQ — Reports page', () => {
  test('loads and shows title', async ({ page }) => {
    await page.goto('/en/hq/reports')
    await expect(page).toHaveURL(/\/hq\/reports/)
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  })
})

test.describe('HQ — Inbox page', () => {
  test('loads without error', async ({ page }) => {
    await page.goto('/en/hq/inbox')
    await expect(page).toHaveURL(/\/hq\/inbox/)
  })
})

test.describe('HQ — Other pages load', () => {
  const pages = [
    ['/en/hq/packages', /\/hq\/packages/],
    ['/en/hq/library', /\/hq\/library/],
    ['/en/hq/shop', /\/hq\/shop/],
    ['/en/hq/emails', /\/hq\/emails/],
    ['/en/hq/locations', /\/hq\/locations/],
    ['/en/hq/permissions', /\/hq\/permissions/],
    ['/en/hq/translations', /\/hq\/translations/],
    ['/en/hq/homepage-settings', /\/hq\/homepage-settings/],
  ] as const

  for (const [url, re] of pages) {
    test(`loads ${url}`, async ({ page }) => {
      await page.goto(url)
      await expect(page).toHaveURL(re)
    })
  }
})

test.describe('HQ — API contracts', () => {
  test('GET /api/hq/transactions', async ({ request }) => {
    const res = await request.get('/api/hq/transactions')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/hq/reports', async ({ request }) => {
    const res = await request.get('/api/hq/reports')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/hq/packages', async ({ request }) => {
    const res = await request.get('/api/hq/packages')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/hq/shop', async ({ request }) => {
    const res = await request.get('/api/hq/shop')
    expect(res.ok()).toBe(true)
  })
})
