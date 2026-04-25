import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/dashboard')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/hq\/dashboard/)
    await expect(page.getByRole('heading', { name: 'HQ Dashboard' })).toBeVisible()
  })

  test('shows welcome text with admin name', async ({ page }) => {
    await expect(page.getByText(/Welcome back, Test HQ/)).toBeVisible()
  })

  test('shows SUPER ADMIN badge', async ({ page }) => {
    await expect(page.getByText(/super admin/i)).toBeVisible()
  })

  test('shows 4 KPI cards', async ({ page }) => {
    await expect(page.getByText('Active Schools')).toBeVisible()
    await expect(page.getByText('Total Students')).toBeVisible()
    await expect(page.getByText('Weekly Lessons')).toBeVisible()
    await expect(page.getByText('Active Subscriptions')).toBeVisible()
  })

  test('shows + New School quick action button', async ({ page }) => {
    await expect(page.getByRole('link', { name: /\+ New School/ })).toBeVisible()
  })

  test('shows Recent Schools section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Recent Schools' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'View all' })).toBeVisible()
  })

  test('Recent Schools links open school detail', async ({ page }) => {
    const firstSchoolLink = page.locator('a[href^="/hq/schools/"]').first()
    await expect(firstSchoolLink).toBeVisible()
  })
})

test.describe('HQ — Sidebar navigation', () => {
  test('navigates to Schools', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Schools', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/schools/)
  })

  test('navigates to Team', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Team', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/team/)
  })

  test('navigates to Lesson Types', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Lesson Types', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/lesson-types/)
  })

  test('navigates to Payments', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Payments', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/payments/)
  })

  test('navigates to Reports', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Reports', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/reports/)
  })

  test('navigates to Inbox', async ({ page }) => {
    await page.goto('/en/hq/dashboard')
    await page.getByRole('link', { name: 'Inbox', exact: true }).click()
    await expect(page).toHaveURL(/\/hq\/inbox/)
  })
})
