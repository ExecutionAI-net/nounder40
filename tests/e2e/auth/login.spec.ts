import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Auth — Login page UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/login')
  })

  test('shows brand heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })

  test('shows email and password fields', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('shows Sign in button', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('shows Google OAuth button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  })

  test('shows Forgot password link', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible()
  })

  test('shows link to register page', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Register' })).toBeVisible()
  })
})

test.describe('Auth — Login flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('shows inline error on wrong credentials', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrongpassword123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('.bg-red-50')).toBeVisible({ timeout: 10000 })
  })

  test('shows error on empty email submit', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Password').fill('somepassword')
    await page.getByRole('button', { name: 'Sign in' }).click()
    // HTML5 validation prevents submit — email field should be focused
    const emailInput = page.getByLabel('Email')
    await expect(emailInput).toBeFocused()
  })

  test('redirects unauthenticated user to login from /hq/dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })

  test('redirects unauthenticated user to login from /school/dashboard', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })

  test('redirects unauthenticated user to login from /teacher/dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })

  test('redirects unauthenticated user to login from /student/dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
  })

  test('HQ user lands on /hq/dashboard after login', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Email').fill(process.env.TEST_HQ_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_HQ_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/hq\/dashboard/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/hq\/dashboard/)
  })

  test('school user lands on /school/dashboard after login', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Email').fill(process.env.TEST_SCHOOL_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_SCHOOL_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/school\/dashboard/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/school\/dashboard/)
  })

  test('teacher user lands on /teacher/dashboard after login', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Email').fill(process.env.TEST_TEACHER_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_TEACHER_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/teacher\/dashboard/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/teacher\/dashboard/)
  })

  test('student user lands on /student/dashboard after login', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByLabel('Email').fill(process.env.TEST_STUDENT_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_STUDENT_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/student\/dashboard/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/student\/dashboard/)
  })

  test('respects ?next= param after login', async ({ page }) => {
    await page.goto('/en/login?next=/student/book')
    await page.getByLabel('Email').fill(process.env.TEST_STUDENT_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_STUDENT_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/student\/book/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/student\/book/)
  })

  test('ignores unsafe ?next= redirect (external URL)', async ({ page }) => {
    await page.goto('/en/login?next=//evil.com')
    await page.getByLabel('Email').fill(process.env.TEST_STUDENT_EMAIL ?? '')
    await page.getByLabel('Password').fill(process.env.TEST_STUDENT_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Should land on student dashboard, not the external URL
    await page.waitForURL(/\/student\/dashboard/, { timeout: 15000 })
    await expect(page).toHaveURL(/\/student\/dashboard/)
  })
})

test.describe('Auth — Forgot password flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('clicking Forgot password shows reset form', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back to login' })).toBeVisible()
  })

  test('reset form shows email field', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByLabel('Email')).toBeVisible()
  })

  test('Back to login returns to login form', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page.getByRole('button', { name: 'Back to login' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('submitting reset shows check email state', async ({ page }) => {
    await page.goto('/en/login')
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page.getByLabel('Email').fill('support+hq@alinaquintana.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    // Should show "Check your email" heading or message
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Auth — i18n routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('Italian login page loads', async ({ page }) => {
    await page.goto('/it/login')
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })

  test('Spanish login page loads', async ({ page }) => {
    await page.goto('/es/login')
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })

  test('French login page loads', async ({ page }) => {
    await page.goto('/fr/login')
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })

  test('German login page loads', async ({ page }) => {
    await page.goto('/de/login')
    await expect(page.getByRole('heading', { name: 'No Under 40' })).toBeVisible()
  })
})
