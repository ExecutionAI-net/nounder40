/**
 * Access control — each authenticated role is blocked from other roles' routes.
 * Uses pre-saved storageState sessions from auth.setup.ts.
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const AUTH = (role: string) => path.join(__dirname, `../../.auth/${role}.json`)

// ── HQ ────────────────────────────────────────────────────────────────────────

test.describe('Access control — HQ', () => {
  test.use({ storageState: AUTH('hq') })

  test('can access /hq/dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).toHaveURL(/\/hq\/dashboard/)
  })

  test('blocked from /school/dashboard', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).not.toHaveURL(/\/school\/dashboard/)
  })

  test('blocked from /teacher/dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).not.toHaveURL(/\/teacher\/dashboard/)
  })

  test('blocked from /student/dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).not.toHaveURL(/\/student\/dashboard/)
  })
})

// ── School ────────────────────────────────────────────────────────────────────

test.describe('Access control — School', () => {
  test.use({ storageState: AUTH('school') })

  test('can access /school/dashboard', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).toHaveURL(/\/school\/dashboard/)
  })

  test('blocked from /hq/dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  })

  test('blocked from /teacher/dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).not.toHaveURL(/\/teacher\/dashboard/)
  })

  test('blocked from /student/dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).not.toHaveURL(/\/student\/dashboard/)
  })
})

// ── Teacher ───────────────────────────────────────────────────────────────────

test.describe('Access control — Teacher', () => {
  test.use({ storageState: AUTH('teacher') })

  test('can access /teacher/dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).toHaveURL(/\/teacher\/dashboard/)
  })

  test('blocked from /hq/dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  })

  test('blocked from /school/dashboard', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).not.toHaveURL(/\/school\/dashboard/)
  })

  test('blocked from /student/dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).not.toHaveURL(/\/student\/dashboard/)
  })
})

// ── Student ───────────────────────────────────────────────────────────────────

test.describe('Access control — Student', () => {
  test.use({ storageState: AUTH('student') })

  test('can access /student/dashboard', async ({ page }) => {
    await page.goto('/en/student/dashboard')
    await expect(page).toHaveURL(/\/student\/dashboard/)
  })

  test('blocked from /hq/dashboard', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await expect(page).not.toHaveURL(/\/hq\/dashboard/)
  })

  test('blocked from /school/dashboard', async ({ page }) => {
    await page.goto('/en/school/dashboard')
    await expect(page).not.toHaveURL(/\/school\/dashboard/)
  })

  test('blocked from /teacher/dashboard', async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
    await expect(page).not.toHaveURL(/\/teacher\/dashboard/)
  })
})

// ── API routes ────────────────────────────────────────────────────────────────

test.describe('Access control — API routes (unauthenticated)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('GET /api/school/courses returns 401 without session', async ({ request }) => {
    const res = await request.get('/api/school/courses')
    expect(res.status()).toBe(401)
  })

  test('GET /api/hq/schools returns 401 without session', async ({ request }) => {
    const res = await request.get('/api/hq/schools')
    expect(res.status()).toBe(401)
  })
})
