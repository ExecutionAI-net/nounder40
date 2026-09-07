import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'

// Auth/role routing moved to the client (see lib/api/guards.tsx) — JWT Bearer
// tokens live in localStorage, which middleware (server-side) can't read.
// This file is i18n-only now.

const handleI18nRouting = createMiddleware(routing)

// Svuotamento una tantum della cache HTTP del browser. Serve a liberare chi ha
// ancora in pancia HTML e chunk salvati quando la regola di cache era troppo
// lunga: senza questo l'unico rimedio era il refresh forzato o "Disable cache".
// Alzare la data qui forza una nuova pulizia su tutti i browser.
const CACHE_EPOCH = '2026-08-16'
const CACHE_EPOCH_COOKIE = 'cache_epoch'

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

  // next-intl locale routing (detects/redirects locale prefix). An explicit
  // locale segment already in the URL is authoritative — next-intl only
  // adds/normalizes a prefix for a locale-less path (via its own
  // Accept-Language/cookie detection), it never rewrites one that's already
  // valid. QA finding M-7: this used to also compare the URL locale against
  // the `user_locale` cookie (lib/locale.ts) and redirect to the cookie's
  // locale on any mismatch — silently bouncing an explicit URL locale (e.g.
  // a shared /it/... link) back to whatever the visitor's cookie said.
  return handleI18nRouting(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
