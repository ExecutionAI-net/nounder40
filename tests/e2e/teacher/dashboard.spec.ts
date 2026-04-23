import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../../.auth/teacher.json') })

test.describe('Teacher — Dashboard', () => {
  test('loads teacher dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).toHaveURL(/\/teacher\/dashboard/)
  })

  test('blocks access to school pages', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).not.toHaveURL(/\/school\/dashboard/)
  })

  test('blocks access to hq pages', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  })
})
