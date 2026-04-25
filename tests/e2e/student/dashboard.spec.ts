import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })

test.describe('Student Dashboard', () => {
  test('loads student dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).toHaveURL(/\/student\/dashboard/)
  })

  test('loads book page', async ({ page }) => {
    await page.goto('/en/student/book')
    await expect(page).toHaveURL(/\/student\/book/)
  })

  test('blocks access to school pages', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).not.toHaveURL(/\/school\/dashboard/)
  })
})
