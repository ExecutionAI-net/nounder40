import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40.com'

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/en/', '/it/', '/es/', '/fr/', '/de/'],
        disallow: [
          '/*/hq/',
          '/*/school/',
          '/*/teacher/',
          '/*/student/',
          '/api/',
          '/auth/',
          '/*/select-role',
          '/*/setup-account',
          '/*/reset-password',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
