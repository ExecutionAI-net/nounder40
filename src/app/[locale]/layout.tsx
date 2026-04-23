import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import '../globals.css'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40.com'

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'No Under 40 — Classical Dance School Platform',
    template: '%s | No Under 40',
  },
  description: 'No Under 40 is a management platform for classical dance schools — lesson scheduling, student bookings, packages, subscriptions, and more.',
  keywords: ['classical dance', 'dance school', 'lesson booking', 'dance management', 'ballet school'],
  authors: [{ name: 'No Under 40' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'No Under 40',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'No Under 40',
    title: 'No Under 40 — Classical Dance School Platform',
    description: 'Manage your dance school network with No Under 40. Lesson scheduling, bookings, credits, and more.',
    images: [
      {
        url: '/dancer.jpg',
        width: 1200,
        height: 630,
        alt: 'No Under 40 — Classical Dance School Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'No Under 40 — Classical Dance School Platform',
    description: 'Manage your dance school network with No Under 40.',
    images: ['/dancer.jpg'],
  },
  icons: {
    icon: '/Logo.png',
    apple: '/Logo.png',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
}

export const viewport: Viewport = {
  themeColor: '#6B1F3A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const locales = routing.locales as readonly string[]
  const languages: Record<string, string> = {}
  for (const l of locales) {
    languages[l] = `${APP_URL}/${l}`
  }
  return {
    alternates: {
      canonical: `${APP_URL}/${locale}`,
      languages,
    },
    openGraph: {
      locale,
      alternateLocale: (locales as string[]).filter((l) => l !== locale),
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <html lang={locale}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className={`${geist.variable} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
