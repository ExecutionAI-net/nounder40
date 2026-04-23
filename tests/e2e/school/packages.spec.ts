import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Packages page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/packages')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/packages/)
    await expect(page.getByRole('heading', { name: 'Packages' })).toBeVisible()
  })

  test('shows + New Package button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /\+ New Package/ })).toBeVisible()
  })

  test('clicking New Package opens creation form', async ({ page }) => {
    await page.getByRole('button', { name: /\+ New Package/ }).click()
    await expect(page.getByPlaceholder(/Starter Pack/i)).toBeVisible()
    await expect(page.getByPlaceholder(/Pacchetto Base/i)).toBeVisible()
  })
})

test.describe('School — Subscriptions page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/subscriptions')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/subscriptions/)
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible()
  })

  test('shows New Subscription button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /New Subscription/ })).toBeVisible()
  })
})

test.describe('School — API contracts', () => {
  test('GET /api/school/packages', async ({ request }) => {
    const res = await request.get('/api/school/packages')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/school/subscriptions', async ({ request }) => {
    const res = await request.get('/api/school/subscriptions')
    expect(res.ok()).toBe(true)
  })
})
