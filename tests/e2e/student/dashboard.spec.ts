import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })

test.describe('Student — Dashboard (Home)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/student/dashboard')
  })

  test('loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/student\/dashboard/)
  })

  test('shows personalized greeting', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^Hi,/ })).toBeVisible()
  })

  test('shows subtitle', async ({ page }) => {
    await expect(page.getByText(/Ready for your next class/i)).toBeVisible()
  })

  test('shows Credits KPI card', async ({ page }) => {
    await expect(page.getByText(/^Credits$/).first()).toBeVisible()
  })

  test('shows Upcoming Lessons KPI card', async ({ page }) => {
    await expect(page.getByText('Upcoming Lessons').first()).toBeVisible()
  })

  test('shows Book a Class quick action', async ({ page }) => {
    // The quick action is a large card link with both title and description
    await expect(page.getByRole('link', { name: 'Book a Class Browse upcoming lessons' })).toBeVisible()
  })

  test('shows My Lessons quick action', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'My Lessons View your bookings' })).toBeVisible()
  })

  test('shows My Access quick action', async ({ page }) => {
    await expect(page.getByRole('link', { name: /My Access/ }).first()).toBeVisible()
  })

  test('shows Profile quick action', async ({ page }) => {
    const profileLinks = page.getByRole('link', { name: 'Profile' })
    await expect(profileLinks.first()).toBeVisible()
  })

  test('clicking Book a Class navigates to /book', async ({ page }) => {
    await page.getByRole('link', { name: /Book a Class/ }).first().click()
    await expect(page).toHaveURL(/\/student\/book/)
  })
})
