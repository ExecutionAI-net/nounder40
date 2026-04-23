/**
 * Logout — each role's logout clears session and redirects to login.
 * We intentionally do NOT rely on storageState here — each test logs in fresh
 * and then logs out, to verify the full cycle.
 */

import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

async function loginAs(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  email: string,
  password: string,
  expectedDashboard: string
) {
  await page.goto('/en/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(new RegExp(expectedDashboard), { timeout: 15000 })
}

async function clickLogout(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  // Try common logout button patterns used across role panels
  const logoutBtn = page.getByRole('button', { name: /sign out|log out|logout/i })
  const logoutLink = page.getByRole('link', { name: /sign out|log out|logout/i })

  if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutBtn.click()
  } else if (await logoutLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutLink.click()
  } else {
    // Try opening a user menu first
    const avatarMenu = page.getByRole('button', { name: /menu|user|account|profile/i })
    if (await avatarMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
      await avatarMenu.click()
      await page.getByRole('button', { name: /sign out|log out|logout/i }).click()
    }
  }
}

test('HQ logout redirects to login', async ({ page }) => {
  await loginAs(
    page,
    process.env.TEST_HQ_EMAIL ?? '',
    process.env.TEST_HQ_PASSWORD ?? '',
    '/hq/dashboard'
  )
  await clickLogout(page)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})

test('School logout redirects to login', async ({ page }) => {
  await loginAs(
    page,
    process.env.TEST_SCHOOL_EMAIL ?? '',
    process.env.TEST_SCHOOL_PASSWORD ?? '',
    '/school/dashboard'
  )
  await clickLogout(page)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})

test('Teacher logout redirects to login', async ({ page }) => {
  await loginAs(
    page,
    process.env.TEST_TEACHER_EMAIL ?? '',
    process.env.TEST_TEACHER_PASSWORD ?? '',
    '/teacher/dashboard'
  )
  await clickLogout(page)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})

test('Student logout redirects to login', async ({ page }) => {
  await loginAs(
    page,
    process.env.TEST_STUDENT_EMAIL ?? '',
    process.env.TEST_STUDENT_PASSWORD ?? '',
    '/student/dashboard'
  )
  await clickLogout(page)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})

test('after logout, protected route redirects to login', async ({ page }) => {
  await loginAs(
    page,
    process.env.TEST_STUDENT_EMAIL ?? '',
    process.env.TEST_STUDENT_PASSWORD ?? '',
    '/student/dashboard'
  )
  await clickLogout(page)
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })

  // Now try to navigate back to protected page
  await page.goto('/en/student/dashboard')
  await expect(page).toHaveURL(/\/login/, { timeout: 10000 })
})
