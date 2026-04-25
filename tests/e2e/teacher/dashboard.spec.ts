import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/teacher.json') })

test.describe('Teacher — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/teacher/dashboard')
  })

  test('loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/teacher\/dashboard/)
  })

  test('shows personalized greeting', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^Hi,/ })).toBeVisible()
  })

  test('shows schedule subtitle', async ({ page }) => {
    await expect(page.getByText(/Here's your schedule/i)).toBeVisible()
  })

  test('shows Today section', async ({ page }) => {
    await expect(page.getByText(/^Today$/)).toBeVisible()
  })

  test('shows Next 7 Days section', async ({ page }) => {
    await expect(page.getByText('Next 7 Days')).toBeVisible()
  })
})

test.describe('Teacher — Sidebar navigation', () => {
  const links: Array<[string, RegExp]> = [
    ['Calendar', /\/teacher\/calendar/],
    ['Attendance', /\/teacher\/attendance/],
    ['Performance', /\/teacher\/performance/],
    ['Compensation', /\/teacher\/compensation/],
    ['Inbox', /\/teacher\/inbox/],
    ['Library', /\/teacher\/library/],
    ['Profile', /\/teacher\/profile/],
  ]

  for (const [label, urlPattern] of links) {
    test(`navigates to ${label}`, async ({ page }) => {
      await page.goto('/en/teacher/dashboard')
      await page.getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(urlPattern)
    })
  }
})

test.describe('Teacher — Sub-pages load with correct heading', () => {
  const pages: Array<[string, string, RegExp]> = [
    ['/en/teacher/calendar', 'Calendar', /\/teacher\/calendar/],
    ['/en/teacher/attendance', 'Attendance', /\/teacher\/attendance/],
    ['/en/teacher/performance', 'Performance', /\/teacher\/performance/],
    ['/en/teacher/compensation', 'Compensation', /\/teacher\/compensation/],
    ['/en/teacher/inbox', 'Inbox', /\/teacher\/inbox/],
    ['/en/teacher/library', 'Metodo Library', /\/teacher\/library/],
    ['/en/teacher/profile', 'Profile', /\/teacher\/profile/],
  ]

  for (const [url, heading, urlPattern] of pages) {
    test(`${url} loads`, async ({ page }) => {
      await page.goto(url)
      await expect(page).toHaveURL(urlPattern)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15000 })
    })
  }
})

test.describe('Teacher — Access control', () => {
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

test.describe('Teacher — API contracts', () => {
  test('GET /api/teacher/lessons', async ({ request }) => {
    const res = await request.get('/api/teacher/lessons')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/teacher/calendar', async ({ request }) => {
    const res = await request.get('/api/teacher/calendar')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/teacher/stats', async ({ request }) => {
    const res = await request.get('/api/teacher/stats')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/teacher/compensation', async ({ request }) => {
    const res = await request.get('/api/teacher/compensation')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/teacher/library', async ({ request }) => {
    const res = await request.get('/api/teacher/library')
    expect(res.ok()).toBe(true)
  })
})
