import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/student.json') })

test.describe('Student — Other pages load', () => {
  const pages: Array<[string, string, RegExp]> = [
    ['/en/student/shop', 'Shop', /\/student\/shop/],
    ['/en/student/support', 'Support', /\/student\/support/],
    ['/en/student/profile', 'Profile', /\/student\/profile/],
  ]

  for (const [url, heading, urlPattern] of pages) {
    test(`${url} loads`, async ({ page }) => {
      await page.goto(url)
      await expect(page).toHaveURL(urlPattern)
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15000 })
    })
  }
})

test.describe('Student — Profile tabs', () => {
  test('shows Profile and Documents tabs', async ({ page }) => {
    await page.goto('/en/student/profile')
    await expect(page.getByRole('button', { name: /^Profile$/ })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /^Documents$/ })).toBeVisible()
  })

  test('can switch to Documents tab', async ({ page }) => {
    await page.goto('/en/student/profile')
    await page.getByRole('button', { name: /^Documents$/ }).click()
    // Documents tab should show upload controls or existing documents
    await expect(page.getByRole('button', { name: /^Documents$/ })).toHaveClass(/border-\[#6B1F3A\]|text-\[#6B1F3A\]/)
  })
})

test.describe('Student — Access control', () => {
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

test.describe('Student — API contracts', () => {
  test('GET /api/student/credits', async ({ request }) => {
    const res = await request.get('/api/student/credits')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/lessons', async ({ request }) => {
    const res = await request.get('/api/student/lessons')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/packages', async ({ request }) => {
    const res = await request.get('/api/student/packages')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/subscriptions', async ({ request }) => {
    const res = await request.get('/api/student/subscriptions')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/documents', async ({ request }) => {
    const res = await request.get('/api/student/documents')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/shop', async ({ request }) => {
    const res = await request.get('/api/student/shop')
    expect(res.ok()).toBe(true)
  })

  test('GET /api/student/school-packages', async ({ request }) => {
    const res = await request.get('/api/student/school-packages')
    expect(res.ok()).toBe(true)
  })
})
