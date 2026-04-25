import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Settings & ancillary pages', () => {
  const pages: Array<[string, string, RegExp]> = [
    ['/en/school/calendar', 'Calendar', /\/school\/calendar/],
    ['/en/school/payments', 'Payments', /\/school\/payments/],
    ['/en/school/reports', 'Reports', /\/school\/reports/],
    ['/en/school/inbox', 'Inbox', /\/school\/inbox/],
    ['/en/school/settings', 'Settings', /\/school\/settings/],
    ['/en/school/profile', 'School Profile', /\/school\/profile/],
    ['/en/school/locations', 'Locations', /\/school\/locations/],
    ['/en/school/documents', 'Documents', /\/school\/documents/],
    ['/en/school/credits', 'Manual Credits', /\/school\/credits/],
    ['/en/school/compensation', 'Teacher Compensation', /\/school\/compensation/],
    ['/en/school/team', 'Team', /\/school\/team/],
    ['/en/school/settings/statuses', 'Attendance Statuses', /\/school\/settings\/statuses/],
  ]

  for (const [url, heading, urlPattern] of pages) {
    test(`${url} loads with heading "${heading}"`, async ({ page }) => {
      await page.goto(url)
      await expect(page).toHaveURL(urlPattern)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15000 })
    })
  }
})

test.describe('School — API contracts', () => {
  const endpoints = [
    '/api/school/courses',
    '/api/school/teachers',
    '/api/school/students',
    '/api/school/packages',
    '/api/school/subscriptions',
    '/api/school/documents',
    '/api/school/transactions',
  ]

  for (const ep of endpoints) {
    test(`GET ${ep}`, async ({ request }) => {
      const res = await request.get(ep)
      expect(res.ok()).toBe(true)
    })
  }
})
