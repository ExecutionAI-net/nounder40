import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/dashboard')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('shows welcome text', async ({ page }) => {
    await expect(page.getByText(/Welcome back/)).toBeVisible()
  })

  test('shows 4 KPI cards', async ({ page }) => {
    await expect(page.getByText('Active Students')).toBeVisible()
    await expect(page.getByText('Weekly Lessons')).toBeVisible()
    await expect(page.getByText('Monthly Revenue')).toBeVisible()
    await expect(page.getByText('Active Subscriptions')).toBeVisible()
  })

  test('shows owner sub-role badge', async ({ page }) => {
    await expect(page.getByText(/owner/i)).toBeVisible()
  })
})

test.describe('School — Sidebar navigation', () => {
  const links: Array<[string, RegExp]> = [
    ['Courses', /\/school\/courses/],
    ['Calendar', /\/school\/calendar/],
    ['Teachers', /\/school\/teachers/],
    ['Students', /\/school\/students/],
    ['Packages', /\/school\/packages/],
    ['Subscriptions', /\/school\/subscriptions/],
    ['Payments', /\/school\/payments/],
    ['Reports', /\/school\/reports/],
    ['Inbox', /\/school\/inbox/],
    ['Settings', /\/school\/settings/],
  ]

  for (const [label, urlPattern] of links) {
    test(`navigates to ${label}`, async ({ page }) => {
      await page.goto('/en/school/dashboard')
      await page.getByRole('link', { name: label, exact: true }).click()
      await expect(page).toHaveURL(urlPattern)
    })
  }
})
