import type { MetadataRoute } from 'next'

const locales = ['en', 'it', 'es', 'fr', 'de'] as const
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40.com'

const publicPaths = ['', '/login', '/register']

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []

  for (const path of publicPaths) {
    const languages: Record<string, string> = {}
    for (const locale of locales) {
      languages[locale] = `${baseUrl}/${locale}${path}`
    }

    entries.push({
      url: `${baseUrl}/en${path}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: path === '' ? 1 : 0.8,
      alternates: { languages },
    })
  }

  return entries
}
