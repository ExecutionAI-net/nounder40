import { test, expect } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ — Lesson Types page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/lesson-types')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/hq\/lesson-types/)
    await expect(page.getByRole('heading', { name: 'Lesson Types' })).toBeVisible()
  })

  test('shows + New button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /\+ New/i })).toBeVisible({ timeout: 15000 })
  })

  test('clicking New opens creation form', async ({ page }) => {
    await page.getByRole('button', { name: /\+ New/i }).click()
    await expect(page.getByRole('heading', { name: /New Lesson Type/i })).toBeVisible()
  })

  test('creation form has code, level, nameIT, nameEN fields', async ({ page }) => {
    await page.getByRole('button', { name: /\+ New/i }).click()
    await expect(page.getByPlaceholder(/FLEX|SBARRA/i).first()).toBeVisible()
    // Multilingual inputs
    const formInputs = page.locator('form input')
    await expect(formInputs.nth(0)).toBeVisible()  // code
    await expect(formInputs.nth(1)).toBeVisible()  // name IT
  })
})

test.describe('HQ — Lesson Types API', () => {
  test('GET /api/hq/lesson-types returns array', async ({ request }) => {
    const res = await request.get('/api/hq/lesson-types')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('POST /api/hq/lesson-types creates a type', async ({ request }) => {
    const code = `E2E_${Date.now().toString(36).toUpperCase()}`
    const res = await request.post('/api/hq/lesson-types', {
      data: {
        code,
        level: 'all',
        name_it: `e2e-${code}`,
        name_en: `e2e-${code}`,
        name_fr: '',
        name_es: '',
        description_it: '',
        description_en: '',
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.id).toBeTruthy()

    // Cleanup
    await adminDb.from('lesson_types').delete().eq('id', body.id)
  })
})
