/**
 * Cross-cutting — mobile / responsive
 *
 * Runs selected public pages under a 375x812 (iPhone) viewport and asserts
 * the core UI still works: viewport meta present, no horizontal scroll, forms
 * remain usable, primary CTAs are tap-targets ≥ 44px.
 */

import { test, expect } from '@playwright/test'

// Chromium with a mobile viewport — avoids the WebKit binary download.
// 390×844 matches iPhone 13 dimensions; for CSS/layout assertions we don't
// need a true mobile UA.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
})

test.describe('Mobile — viewport and public pages', () => {
  test('viewport meta tag is set correctly on /login', async ({ page }) => {
    await page.goto('/en/login')
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport ?? '').toMatch(/width=device-width/)
  })

  test('login page has no horizontal overflow at 375px', async ({ page }) => {
    await page.goto('/en/login')
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    // Allow up to 1px rounding tolerance
    expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1)
  })

  test('Sign in button meets 44x44 tap target (WCAG 2.5.5)', async ({ page }) => {
    await page.goto('/en/login')
    const btn = page.getByRole('button', { name: 'Sign in' })
    const box = await btn.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    // Button width depends on layout; assert at least the minimum tap-target
    expect(box!.width).toBeGreaterThanOrEqual(44)
  })

  test('email and password inputs are visible and large enough on mobile', async ({ page }) => {
    await page.goto('/en/login')
    const email = page.getByLabel('Email')
    const password = page.getByLabel('Password')
    await expect(email).toBeVisible()
    await expect(password).toBeVisible()
    const emailBox = await email.boundingBox()
    expect(emailBox!.height).toBeGreaterThanOrEqual(32)
  })

  test('register page step indicator renders on mobile', async ({ page }) => {
    await page.goto('/en/register')
    await expect(page.getByText('Your profile')).toBeVisible({ timeout: 15000 })
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(scrollWidth - clientWidth).toBeLessThanOrEqual(1)
  })
})
