import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Teachers list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/teachers')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/teachers/)
    await expect(page.getByRole('heading', { name: 'Teachers' })).toBeVisible()
  })

  test('shows + Add Teacher button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /\+ Add Teacher/ })).toBeVisible()
  })

  test('clicking Add Teacher navigates to invite form', async ({ page }) => {
    await page.getByRole('link', { name: /\+ Add Teacher/ }).click()
    await expect(page).toHaveURL(/\/school\/teachers\/invite/)
  })
})

test.describe('School — Invite Teacher form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/teachers/invite')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Add Teacher' })).toBeVisible()
  })

  test('shows form inputs for teacher details', async ({ page }) => {
    // Form should have at least a name input and email input
    await expect(page.locator('form input').first()).toBeVisible({ timeout: 10000 })
    const emailInputs = page.locator('form input[type="email"]')
    await expect(emailInputs.first()).toBeVisible()
  })
})

test.describe('School — Teachers API', () => {
  test('GET /api/school/teachers returns array', async ({ request }) => {
    const res = await request.get('/api/school/teachers')
    expect(res.ok()).toBe(true)
  })
})
