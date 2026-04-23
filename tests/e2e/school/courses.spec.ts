import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Courses', () => {
  test('loads courses list', async ({ page }) => {
    await page.goto('/en/school/courses')
    await expect(page).toHaveURL(/\/school\/courses/)
  })

  test('opens new course page', async ({ page }) => {
    await page.goto('/en/school/courses/new')
    await expect(page).toHaveURL(/\/school\/courses\/new/)
    await expect(page.getByRole('heading', { name: /course|new/i })).toBeVisible()
  })

  test('blocks access to hq pages', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  })
})
