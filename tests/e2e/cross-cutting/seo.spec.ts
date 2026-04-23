import { test, expect } from '@playwright/test'

test.describe('SEO & public routes', () => {
  test('robots.txt is accessible', async ({ page }) => {
    const res = await page.request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toMatch(/User-[Aa]gent/)
    expect(body).toContain('Sitemap:')
  })

  test('sitemap.xml is accessible', async ({ page }) => {
    const res = await page.request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('<urlset')
  })

  test('login page is indexable (no noindex)', async ({ page }) => {
    await page.goto('/en/login')
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    // Should not have noindex on public pages
    expect(robots ?? '').not.toContain('noindex')
  })
})
