import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing, locales } from './i18n/routing'

// Auth/role routing moved to the client (see lib/api/guards.tsx) — JWT Bearer
// tokens live in localStorage, which middleware (server-side) can't read.
// This file is i18n-only now.

const handleI18nRouting = createMiddleware(routing)
const LOCALE_LIST = locales as readonly string[]

// Svuotamento una tantum della cache HTTP del browser. Serve a liberare chi ha
// ancora in pancia HTML e chunk salvati quando la regola di cache era troppo
// lunga: senza questo l'unico rimedio era il refresh forzato o "Disable cache".
// Alzare la data qui forza una nuova pulizia su tutti i browser.
const CACHE_EPOCH = '2026-08-16'
const CACHE_EPOCH_COOKIE = 'cache_epoch'

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
  const response = route(request)

  // Un reindirizzamento non va mai messo in cache
  if (response.status >= 300 && response.status < 400) {
    response.headers.set('Cache-Control', 'no-store, must-revalidate')
  }

  // Pulizia una tantum, solo su una risposta normale (così il cookie che la
  // disattiva viene sicuramente memorizzato). Tocca solo la cache: cookie,
  // sessione e localStorage restano al loro posto.
  if (response.status === 200 && request.cookies.get(CACHE_EPOCH_COOKIE)?.value !== CACHE_EPOCH) {
    const already = response.headers.get('Clear-Site-Data')
    response.headers.set('Clear-Site-Data', already ? `${already}, "cache"` : '"cache"')
    response.cookies.set(CACHE_EPOCH_COOKIE, CACHE_EPOCH, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
  }

  return response
}

function route(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // Skip i18n for API routes, static files and PWA assets
  if (
    pathname.startsWith('/api/') ||
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

  // next-intl locale routing (detects/redirects locale prefix)
  return handleI18nRouting(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
