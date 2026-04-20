import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { routing, locales } from './i18n/routing'
import { updateSession } from '@/lib/supabase/middleware'

const handleI18nRouting = createMiddleware(routing)

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip i18n and auth for API routes, Supabase auth callbacks, and static files
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    /\.(.*)$/.test(pathname)
  ) {
    return updateSession(request)
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
