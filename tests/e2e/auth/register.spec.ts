import { test, expect } from '@playwright/test'
import { adminDb } from '../../helpers/db'

test.use({ storageState: { cookies: [], origins: [] } })

async function cleanupTestRegistration(email: string) {
  const { data: user } = await adminDb
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (user?.id) {
    await adminDb.from('students').delete().eq('user_id', user.id)
    await adminDb.from('profiles').delete().eq('id', user.id)
    await adminDb.auth.admin.deleteUser(user.id)
  }
}

test.describe('Auth — Register page UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/register')
  })

  test('shows brand heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })

  test('shows subtitle "Create your student account"', async ({ page }) => {
    await expect(page.getByText('Create your student account')).toBeVisible()
  })

  test('shows step 1 — Your profile', async ({ page }) => {
    await expect(page.getByText('Your profile')).toBeVisible()
    await expect(page.getByPlaceholder('First and last name')).toBeVisible()
  })

  test('shows Continue button on step 1', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  })

  test('shows link back to login', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  })
})

test.describe('Auth — Register step navigation', () => {
  test('requires full name before continuing', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Full name is required.')).toBeVisible()
  })

  test('advances to step 2 after filling name', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByPlaceholder('First and last name').fill('Test User')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Account details')).toBeVisible()
    await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
  })

  test('Back button on step 2 returns to step 1', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByPlaceholder('First and last name').fill('Test User')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('Your profile')).toBeVisible()
  })

  test('step 2 requires email', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByPlaceholder('First and last name').fill('Test User')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByText('Email is required.')).toBeVisible()
  })

  test('step 2 requires password', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByPlaceholder('First and last name').fill('Test User')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByPlaceholder('you@example.com').fill('sometest@example.com')
    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByText('Password is required.')).toBeVisible()
  })
})

test.describe('Auth — Register flow', () => {
  const testEmail = `e2e-register-${Date.now()}@test.local`

  test.afterEach(async () => {
    await cleanupTestRegistration(testEmail)
  })

  test('successful registration shows verify email screen', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByPlaceholder('First and last name').fill('E2E Test Student')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByPlaceholder('you@example.com').fill(testEmail)
    await page.getByPlaceholder('Create a password').fill('Aa123456+')
    await page.getByRole('button', { name: 'Create Account' }).click()
    // Supabase project has email confirmation enabled, so registration shows
    // a "Verify your email" screen rather than redirecting to the dashboard.
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(testEmail)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to login' })).toBeVisible()
  })
})
