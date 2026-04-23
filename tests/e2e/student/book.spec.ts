import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })

test.describe('Student — Book a Class', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/student/book')
  })

  test('loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/student\/book/)
  })

  test('shows title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Book a Class' })).toBeVisible()
  })

  test('shows filter dropdowns', async ({ page }) => {
    // At least one select filter (country, city, school, or lesson type)
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Student — Bookings page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/student/bookings')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/student\/bookings/)
    await expect(page.getByRole('heading', { name: 'My Lessons' })).toBeVisible()
  })
})

test.describe('Student — Packages (My Access) page', () => {
  test('loads and shows title', async ({ page }) => {
    await page.goto('/en/student/packages')
    await expect(page).toHaveURL(/\/student\/packages/)
    await expect(page.getByRole('heading', { name: 'My Access' })).toBeVisible()
  })
})

test.describe('Student — Buy Credits page', () => {
  test('loads and shows title', async ({ page }) => {
    await page.goto('/en/student/buy')
    await expect(page).toHaveURL(/\/student\/buy/)
    await expect(page.getByRole('heading', { name: 'Buy Credits' })).toBeVisible()
  })
})
