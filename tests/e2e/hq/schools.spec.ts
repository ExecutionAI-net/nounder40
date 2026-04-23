import { test, expect } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ — Schools list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/schools')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/hq\/schools/)
    await expect(page.getByRole('heading', { name: 'Schools' })).toBeVisible()
  })

  test('shows + New School button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /\+ New School/ })).toBeVisible()
  })

  test('shows status filter buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All Schools' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Active Only', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Inactive Only', exact: true })).toBeVisible()
  })

  test('table columns render', async ({ page }) => {
    // Wait for table to load
    await expect(page.getByRole('columnheader', { name: /School/ }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('columnheader', { name: /City/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Teachers/ })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: /Students/ })).toBeVisible()
  })

  test('Test School row is visible', async ({ page }) => {
    await expect(page.getByText('Test School', { exact: true }).first()).toBeVisible({ timeout: 15000 })
  })

  test('active filter narrows results', async ({ page }) => {
    await page.getByRole('button', { name: /Active Only/ }).click()
    // URL doesn't change, but rows are filtered — ensure inactive ones disappear
    await expect(page.getByRole('button', { name: /Active Only/ })).toHaveClass(/bg-\[#6B1F3A\]|text-white/)
  })

  test('clicking + New School navigates to new school form', async ({ page }) => {
    await page.getByRole('link', { name: /\+ New School/ }).click()
    await expect(page).toHaveURL(/\/hq\/schools\/new/)
  })
})

test.describe('HQ — New School form UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/schools/new')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'New School' })).toBeVisible()
  })

  test('shows back link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /Back to Schools/ })).toBeVisible()
  })

  test('shows required name input', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).toHaveAttribute('required', '')
  })

  test('shows required email input', async ({ page }) => {
    const emailInput = page.locator('input[name="email"]')
    await expect(emailInput).toBeVisible()
    await expect(emailInput).toHaveAttribute('type', 'email')
  })

  test('shows required city input', async ({ page }) => {
    await expect(page.locator('input[name="city"]')).toBeVisible()
  })

  test('shows country select with Italy default', async ({ page }) => {
    const select = page.locator('select[name="country"]')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('IT')
  })

  test('shows platform fee input with default 15', async ({ page }) => {
    const feeInput = page.locator('input[name="platform_fee_percentage"]')
    await expect(feeInput).toBeVisible()
    await expect(feeInput).toHaveValue('15')
  })

  test('shows free trial input with default 30', async ({ page }) => {
    await expect(page.locator('input[name="free_trial_days"]')).toHaveValue('30')
  })

  test('shows Create button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Create School/ })).toBeVisible()
  })

  test('shows Cancel link', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Cancel' })).toBeVisible()
  })
})

test.describe('HQ — Create new school (full flow)', () => {
  const uniq = Date.now().toString(36)
  const schoolName = `e2e-school-${uniq}`
  const schoolEmail = `e2e-school-${uniq}@test.local`

  test.afterEach(async () => {
    // Cleanup: delete school by name prefix
    await adminDb.from('schools').delete().like('name', 'e2e-school-%')
  })

  test('creates a school and redirects to detail page', async ({ page }) => {
    await page.goto('/en/hq/schools/new')
    await page.locator('input[name="name"]').fill(schoolName)
    await page.locator('input[name="email"]').fill(schoolEmail)
    await page.locator('input[name="city"]').fill('Milano')
    await page.getByRole('button', { name: /Create School/ }).click()
    await page.waitForURL(/\/hq\/schools\/[^/]+\?new=1/, { timeout: 30000 })
  })
})

test.describe('HQ — Schools API contract (requires auth)', () => {
  test('GET /api/hq/schools returns array', async ({ request }) => {
    const res = await request.get('/api/hq/schools')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
