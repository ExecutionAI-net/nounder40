import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing, locales } from './i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'

const handleI18nRouting = createMiddleware(routing)
const LOCALE_LIST = locales as readonly string[]

function getPreferredLocale(request: NextRequest): string | null {
  // 1. Cookie (set when user explicitly changes language)
  const cookie = request.cookies.get('user_locale')?.value
  if (cookie && LOCALE_LIST.includes(cookie)) return cookie

  // 2. Browser Accept-Language header
  const acceptLang = request.headers.get('accept-language')
  if (acceptLang) {
    for (const part of acceptLang.split(',')) {
      const lang = part.trim().split(';')[0].toLowerCase().slice(0, 2)
      if (LOCALE_LIST.includes(lang)) return lang
    }
  }

  return null
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip i18n and auth for API routes, Supabase auth callbacks, static files and PWA assets
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    /\.(.*)$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  // Detect current locale from URL prefix
  const urlLocaleMatch = pathname.match(/^\/([a-z]{2})(\/|$)/)
  const urlLocale = urlLocaleMatch && LOCALE_LIST.includes(urlLocaleMatch[1]) ? urlLocaleMatch[1] : null

  // Check preferred locale (cookie > browser)
  const preferred = getPreferredLocale(request)

  // If URL has a locale and it differs from preferred, redirect to preferred
  if (urlLocale && preferred && urlLocale !== preferred) {
    const newPath = pathname.replace(`/${urlLocale}`, `/${preferred}`)
    const url = request.nextUrl.clone()
    url.pathname = newPath
    return NextResponse.redirect(url)
  }

  // Run next-intl locale routing first (detects/redirects locale prefix)
  const i18nResponse = handleI18nRouting(request)

  // If next-intl issued a redirect (e.g. /student → /en/student), return it
  if (i18nResponse.status !== 200) {
    return i18nResponse
  }

  // Otherwise proceed with Supabase session + role protection
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
