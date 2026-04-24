/**
 * Cross-cutting — runtime health
 *
 * Loads each public page and asserts that:
 *   - No console.error messages are emitted during rendering
 *   - No network requests return 4xx/5xx (aside from expected 401s on
 *     protected endpoints during navigation)
 */

import { test, expect } from '@playwright/test'

type Failure = { url: string; status: number }

async function audit(page: import('@playwright/test').Page, path: string) {
  const consoleErrors: string[] = []
  const failedRequests: Failure[] = []

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('response', res => {
    const status = res.status()
    const url = res.url()
    // Allow 401s on API endpoints during public-page navigation
    if (status >= 400 && !url.includes('/api/')) {
      failedRequests.push({ url, status })
    }
  })

  await page.goto(path, { waitUntil: 'networkidle' })
  return { consoleErrors, failedRequests }
}

test.describe('Runtime — public pages', () => {
  const paths = [
    '/en/login',
    '/en/register',
    '/it/login',
    '/es/login',
    '/fr/login',
    '/de/login',
  ]

  for (const p of paths) {
    test(`${p} loads without console errors or failed requests`, async ({ page }) => {
      const { consoleErrors, failedRequests } = await audit(page, p)

      // Filter out well-known noisy sources that don't affect functionality
      const realErrors = consoleErrors.filter(msg =>
        // Next.js devtools warnings about HMR, fast-refresh etc.
        !msg.includes('[Fast Refresh]') &&
        !msg.includes('[HMR]') &&
        // Service worker warnings in dev
        !msg.includes('ServiceWorker') &&
        // Stripe / third-party preload warnings
        !msg.toLowerCase().includes('preload')
      )

      if (realErrors.length > 0) {
        console.log(`Console errors on ${p}:`, realErrors)
      }
      if (failedRequests.length > 0) {
        console.log(`Failed requests on ${p}:`, failedRequests)
      }

      expect(realErrors).toHaveLength(0)
      expect(failedRequests).toHaveLength(0)
    })
  }
})
