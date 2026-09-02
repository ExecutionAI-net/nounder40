import type { Metadata, Viewport } from 'next'
import { Geist, Montserrat, Playfair_Display } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import CacheReset from '@/components/CacheReset'
import { AuthProvider } from '@/lib/api/auth-context'
import '../globals.css'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

// Coppia tipografica del brand (pannello studente e negozio):
// titoli Playfair Display, testi Montserrat.
const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  display: 'swap',
})

const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'No Under 40',
  description: 'Platform for classical dance schools',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'No Under 40',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#6B1F3A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      {/* suppressHydrationWarning: le estensioni browser (es. ColorZilla) iniettano
          attributi sul body prima dell'idratazione, generando falsi mismatch */}
      <body className={`${geist.variable} ${playfair.variable} ${montserrat.variable} font-sans antialiased`} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <CacheReset />
            {children}
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
