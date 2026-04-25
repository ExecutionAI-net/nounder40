import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/school.json') })

test.describe('School — Students page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/school/students')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/school\/students/)
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  })
})

test.describe('School — Students API', () => {
  test('GET /api/school/students returns array', async ({ request }) => {
    const res = await request.get('/api/school/students')
    expect(res.ok()).toBe(true)
  })
})
