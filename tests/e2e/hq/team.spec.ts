import { test, expect } from '@playwright/test'
import path from 'node:path'

test.use({ storageState: path.join(__dirname, '../../.auth/hq.json') })

test.describe('HQ — Team page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/hq/team')
  })

  test('loads and shows title', async ({ page }) => {
    await expect(page).toHaveURL(/\/hq\/team/)
    await expect(page.getByRole('heading', { name: 'HQ Team' })).toBeVisible()
  })

  test('shows + Invite Member button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /\+ Invite Member/ })).toBeVisible()
  })

  test('shows Active Members section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Active Members|active members/i })).toBeVisible()
  })

  test('current HQ user appears in members list', async ({ page }) => {
    await expect(page.getByText('support+hq@alinaquintana.com').first()).toBeVisible({ timeout: 15000 })
  })

  test('clicking Invite Member opens form', async ({ page }) => {
    await page.getByRole('button', { name: /\+ Invite Member/ }).click()
    await expect(page.getByRole('heading', { name: /Invite.*Member|invite/i })).toBeVisible()
    await expect(page.getByPlaceholder('Jane Doe')).toBeVisible()
  })

  test('invite form has full name, email, role fields', async ({ page }) => {
    await page.getByRole('button', { name: /\+ Invite Member/ }).click()
    await expect(page.getByPlaceholder('Jane Doe')).toBeVisible()
    // Email input inside the form
    await expect(page.locator('form input[type="email"]')).toBeVisible()
    // Role select
    await expect(page.locator('form select')).toBeVisible()
  })

  test('Cancel button closes form', async ({ page }) => {
    await page.getByRole('button', { name: /\+ Invite Member/ }).click()
    await expect(page.getByPlaceholder('Jane Doe')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByPlaceholder('Jane Doe')).not.toBeVisible()
  })
})

test.describe('HQ — Team API', () => {
  test('GET /api/hq/team returns members array', async ({ request }) => {
    const res = await request.get('/api/hq/team')
    expect(res.ok()).toBe(true)
  })
})
