import { test, expect } from '@playwright/test'
import path from 'node:path'

test.describe('SEO — robots.txt', () => {
  test('robots.txt is accessible and sane', async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toMatch(/User-[Aa]gent/)
    expect(body).toContain('Sitemap:')
  })

  test('robots disallows dashboard and API paths', async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    const body = await res.text()
    // Dashboards and APIs must be Disallow'd to avoid indexing
    expect(body).toMatch(/Disallow:\s*\/\*?\/?hq\//)
    expect(body).toMatch(/Disallow:\s*\/\*?\/?school\//)
    expect(body).toMatch(/Disallow:\s*\/\*?\/?teacher\//)
    expect(body).toMatch(/Disallow:\s*\/\*?\/?student\//)
    expect(body).toMatch(/Disallow:\s*\/api\//)
  })
})

test.describe('SEO — sitemap.xml', () => {
  test('sitemap.xml has well-formed urlset', async ({ page }) => {
    const res = await page.request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('<?xml')
    expect(body).toContain('<urlset')
    expect(body).toContain('</urlset>')
  })

  test('sitemap has entries for each locale', async ({ page }) => {
    const body = await (await page.request.get('/sitemap.xml')).text()
    // Each of the 5 locales should show up at least once
    for (const locale of ['en', 'it', 'es', 'fr', 'de']) {
      expect(body).toContain(`/${locale}`)
    }
  })
})

test.describe('SEO — public page metadata', () => {
  test('login page has proper title, description, OG tags', async ({ page }) => {
    await page.goto('/en/login')

    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)

    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description ?? '').not.toBe('')

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content')
    expect(ogTitle ?? '').not.toBe('')

    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content')
    expect(ogImage ?? '').not.toBe('')

    const ogLocale = await page.locator('meta[property="og:locale"]').getAttribute('content')
    expect(ogLocale).toBe('en')

    // Twitter card
    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content')
    expect(twitterCard).toBe('summary_large_image')
  })

  test('login page is indexable (no noindex)', async ({ page }) => {
    await page.goto('/en/login')
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    expect(robots ?? '').not.toContain('noindex')
  })

  test('canonical link resolves to this locale', async ({ page }) => {
    await page.goto('/en/login')
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toBeTruthy()
    expect(canonical!).toMatch(/\/en(\/|$)/)
  })

  test('hreflang alternates exist for all 5 locales', async ({ page }) => {
    await page.goto('/en/login')
    const alternates = page.locator('link[rel="alternate"][hreflang]')
    const count = await alternates.count()
    // At least one per locale (en, it, es, fr, de) — may include x-default
    expect(count).toBeGreaterThanOrEqual(5)
  })
})

test.describe('SEO — dashboards are not indexable', () => {
  // Each role's dashboard redirects unauthenticated requests to /login, so we
  // need a valid session to reach the actual page and inspect its meta tag.
  const cases: Array<{ role: string; path: string }> = [
    { role: 'hq', path: '/en/hq/dashboard' },
    { role: 'school', path: '/en/school/dashboard' },
    { role: 'teacher', path: '/en/teacher/dashboard' },
    { role: 'student', path: '/en/student/dashboard' },
  ]
  for (const { role, path: p } of cases) {
    test(`${p} has robots=noindex`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: path.join(__dirname, `../../.auth/${role}.json`),
      })
      const page = await context.newPage()
      await page.goto(p)
      await expect(page).toHaveURL(new RegExp(p), { timeout: 30000 })
      const robots = await page.locator('meta[name="robots"]').getAttribute('content')
      expect(robots ?? '').toContain('noindex')
      await context.close()
    })
  }
})
