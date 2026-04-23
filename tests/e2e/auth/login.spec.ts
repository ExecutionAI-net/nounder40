import { test, expect } from '@playwright/test'

test.describe('Auth — Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('shows login form', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows error on wrong credentials', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel(/email/i).fill('wrong@example.com')
    await page.getByLabel(/password/i).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible({ timeout: 8000 })
  })

  test('redirects unauthenticated user from dashboard to login', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('shows forgot password form', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByRole('button', { name: /forgot/i }).click()
    await expect(page.getByRole('button', { name: /send reset/i })).toBeVisible()
  })
})
