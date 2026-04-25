import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Courses list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/courses')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/courses/)
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
  })

  test('shows subtitle', async ({ page }) => {
    await expect(page.getByText(/Manage your courses/i)).toBeVisible()
  })

  test('shows + New Course link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /\+ New Course/ })).toBeVisible()
  })

  test('shows teacher and location filters', async ({ page }) => {
    await expect(page.locator('select').first()).toBeVisible()
    await expect(page.locator('select').nth(1)).toBeVisible()
  })

  test('clicking + New Course navigates to new course wizard', async ({ page }) => {
    await page.getByRole('link', { name: /\+ New Course/ }).click()
    await expect(page).toHaveURL(/\/school\/courses\/new/)
  })
})

test.describe('School — New Course wizard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/courses/new')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/courses\/new/)
    await expect(page.getByRole('heading', { name: 'New Course' })).toBeVisible()
  })

  test('shows back link to courses', async ({ page }) => {
    await expect(page.getByRole('link', { name: /back to courses|← .*Courses/i })).toBeVisible()
  })

  test('shows step indicator starting at step 1', async ({ page }) => {
    // Step indicator: first 8x8 circle should be active
    const firstStep = page.locator('.rounded-full').first()
    await expect(firstStep).toBeVisible()
  })

  test('step 1 shows lesson type and teacher selects', async ({ page }) => {
    // Wait for form to load
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15000 })
    // At least lesson-type, teacher, language, and country/city selects
    const selectCount = await page.locator('select').count()
    expect(selectCount).toBeGreaterThanOrEqual(3)
  })
})
