// Security model:
// - All data access controlled by Supabase RLS policies
// - API routes validate user session via createClient() server client
// - Role checks performed in both middleware (routing) and API routes (data access)
// - Admin operations use service role key server-side only
// - Public routes: /login, /register, /auth/callback, /api/*

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const LOCALES = ['en', 'it', 'es', 'fr', 'de']
const DEFAULT_LOCALE = 'en'

// Strip locale prefix from pathname, e.g. /en/student/dashboard → /student/dashboard
function stripLocale(pathname: string): { locale: string; stripped: string } {
  const parts = pathname.split('/')
  const first = parts[1]
  if (LOCALES.includes(first)) {
    return { locale: first, stripped: '/' + parts.slice(2).join('/') }
  }
  return { locale: DEFAULT_LOCALE, stripped: pathname }
}

export async function updateSession(request: NextRequest) {
  // Propagate locale to request headers so next-intl's requestLocale can read it
  const { locale } = stripLocale(request.nextUrl.pathname)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-next-intl-locale', locale)

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const { locale, stripped } = stripLocale(pathname)

  // Public routes and API routes — skip role enforcement
  const publicRoutes = ['/login', '/register', '/auth/callback', '/auth/reset-callback', '/select-role', '/reset-password', '/setup-account']
  if (publicRoutes.some((r) => stripped.startsWith(r)) || stripped.startsWith('/api/') || pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return supabaseResponse
  }

  // Root path: redirect logged-in users to their dashboard
  if (stripped === '/' || stripped === '') {
    if (!user) return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
    const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
    if (roles.length > 1) return NextResponse.redirect(new URL(`/${locale}/select-role`, request.url))
    const role = roles[0]
    return NextResponse.redirect(new URL(`/${locale}/${role}/dashboard`, request.url))
  }

  // Not logged in → redirect to login (preserve intended destination)
  if (!user) {
    const loginUrl = new URL(`/${locale}/login`, request.url)
    if (stripped !== '/') loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Get roles from profiles table
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, roles')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[middleware] profile fetch error:', profileError.message, 'user:', user.id, 'path:', pathname)
  }

  const userRoles: string[] = profile?.roles?.length
    ? profile.roles
    : profile?.role ? [profile.role] : []

  // Role-based route protection
  const roleRoutes: Record<string, string> = {
    hq: '/hq',
    school: '/school',
    teacher: '/teacher',
    student: '/student',
  }

  if (userRoles.length > 0 && (stripped === '/' || stripped === '')) {
    return NextResponse.redirect(new URL(`/${locale}/${userRoles[0]}/dashboard`, request.url))
  }

  if (userRoles.length > 0) {
    const hasAccess = userRoles.some(r => roleRoutes[r] && stripped.startsWith(roleRoutes[r]))
    if (!hasAccess) {
      return NextResponse.redirect(new URL(`/${locale}/${userRoles[0]}/dashboard`, request.url))
    }
  }

  return supabaseResponse
}
