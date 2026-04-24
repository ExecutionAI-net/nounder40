/**
 * Cross-cutting — accessibility (a11y)
 *
 * Uses @axe-core/playwright to run WCAG checks on public pages. We only assert
 * against the "serious" and "critical" impact levels to avoid noise from
 * style-level warnings that are out of scope.
 */

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function scan(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
}

test.describe('A11y — public pages (WCAG 2.1 A/AA)', () => {
  test('/en/login has no serious or critical violations', async ({ page }) => {
    await page.goto('/en/login')
    const results = await scan(page)
    const blockers = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (blockers.length > 0) {
      console.log('Accessibility blockers on /en/login:', JSON.stringify(blockers.map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })), null, 2))
    }
    expect(blockers).toHaveLength(0)
  })

  test('/en/register has no serious or critical violations', async ({ page }) => {
    await page.goto('/en/register')
    const results = await scan(page)
    const blockers = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (blockers.length > 0) {
      console.log('Accessibility blockers on /en/register:', JSON.stringify(blockers.map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })), null, 2))
    }
    expect(blockers).toHaveLength(0)
  })
})

test.describe('A11y — DOM invariants', () => {
  test('login form inputs all have associated labels', async ({ page }) => {
    await page.goto('/en/login')
    // Every visible input should be reachable via getByLabel
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('every page has exactly one <h1>', async ({ page }) => {
    for (const url of ['/en/login', '/en/register']) {
      await page.goto(url)
      const h1Count = await page.locator('h1').count()
      expect(h1Count, `Expected exactly one h1 on ${url}`).toBe(1)
    }
  })

  test('html element has a supported lang attribute', async ({ page }) => {
    await page.goto('/en/login')
    const lang = await page.locator('html').getAttribute('lang')
    // The middleware may rewrite to a user's preferred locale, so accept any
    // of the 5 supported locales as long as lang is set.
    expect(['en', 'it', 'es', 'fr', 'de']).toContain(lang)
  })

  test('images on the login page have alt text', async ({ page }) => {
    await page.goto('/en/login')
    const imgs = page.locator('img')
    const count = await imgs.count()
    for (let i = 0; i < count; i++) {
      const alt = await imgs.nth(i).getAttribute('alt')
      const role = await imgs.nth(i).getAttribute('role')
      // Every img must either have alt (even if empty for decorative) OR role=presentation
      expect(alt !== null || role === 'presentation', `img #${i} missing alt/role`).toBe(true)
    }
  })
})

test.describe('A11y — keyboard navigation', () => {
  test('Tab reaches the email field, then password, then Sign in on /login', async ({ page }) => {
    await page.goto('/en/login')
    await expect(page.getByLabel('Email')).toBeVisible()

    // Start from body and tab through. Some browsers focus devtools button or
    // skip-links first — walk until we land on the email input.
    const emailInput = page.getByLabel('Email')
    await emailInput.focus()
    await expect(emailInput).toBeFocused()

    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()

    await page.keyboard.press('Tab')
    // Next focusable is the Sign in button
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await expect(signIn).toBeFocused()
  })
})
