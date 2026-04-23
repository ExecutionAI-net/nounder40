import { test, expect } from '@playwright/test'
import path from 'path'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ Dashboard', () => {
  test('loads dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).toHaveURL(/\/hq\/dashboard/)
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible()
  })

  test('shows school list page', async ({ page }) => {
    await page.goto('/en/hq/schools')
    await expect(page).toHaveURL(/\/hq\/schools/)
  })

  test('blocks access to other role pages', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).not.toHaveURL(/\/student\/dashboard/)
  })
})
