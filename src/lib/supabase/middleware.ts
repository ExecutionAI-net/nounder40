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
            // NB: niente httpOnly — il client browser Supabase legge la sessione
            // da document.cookie; un cookie httpOnly non è né leggibile né
            // sovrascrivibile da JS e il login si rompe al refresh del token.
            supabaseResponse.cookies.set(name, value, {
              ...options,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            })
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Prefetch del router Next: mai azioni distruttive o redirect di auth
  // (un prefetch durante il refresh del token vede transitoriamente !user)
  const isPrefetch = request.headers.get('next-router-prefetch') === '1'
    || request.headers.get('purpose') === 'prefetch'
    || request.headers.get('x-middleware-prefetch') === '1'

  // Sessione invalida ma cookie sb-* presenti (es. residui httpOnly o con path
  // diversi scritti da versioni precedenti): rimuovili. La cancellazione per
  // nome copre il caso standard; Clear-Site-Data fa ripulire al browser TUTTI
  // i cookie dell'origine (qualsiasi path/attributo, anche httpOnly) così un
  // cookie stale non può "ombreggiare" la sessione fresca del prossimo login.
  // I cookie del code-verifier PKCE vengono preservati (servono all'OAuth in corso).
  if (!user && !isPrefetch) {
    const staleSb = request.cookies.getAll()
      .filter(({ name }) => name.startsWith('sb-') && !name.includes('code-verifier'))
    if (staleSb.length > 0) {
      staleSb.forEach(({ name }) => {
        supabaseResponse.cookies.set(name, '', { maxAge: 0, path: '/' })
      })
      supabaseResponse.headers.set('Clear-Site-Data', '"cookies"')
    }
  } else {
    // Sessione valida: riemetti i cookie sb-* senza httpOnly. Un Set-Cookie con
    // stesso nome/path sostituisce anche gli attributi, così una sessione scritta
    // httpOnly da versioni precedenti torna leggibile dal client browser (che
    // altrimenti non vede la sessione e rimbalza al login). Salta i cookie appena
    // riscritti dal refresh del token per non sovrascriverli con valori vecchi.
    request.cookies.getAll().forEach(({ name, value }) => {
      if (name.startsWith('sb-') && !supabaseResponse.cookies.get(name)) {
        supabaseResponse.cookies.set(name, value, {
          path: '/',
          maxAge: 34560000, // ~400 giorni, default @supabase/ssr
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        })
      }
    })
  }

  const { pathname } = request.nextUrl
  const { stripped } = stripLocale(pathname)

  // Già loggato sulla pagina di login (es. autocomplete del browser verso
  // /login): vai dritto al selettore ruoli — da lì chi ha un solo ruolo viene
  // portato alla propria dashboard automaticamente.
  if (user && stripped.startsWith('/login')) {
    return NextResponse.redirect(new URL(`/${locale}/select-role`, request.url))
  }

  // Public routes and API routes — skip role enforcement
  const publicRoutes = ['/login', '/register', '/auth/callback', '/auth/reset-callback', '/select-role', '/reset-password', '/setup-account']
  // Pagine studente consultabili anche senza login (calendario, cataloghi):
  // prenotare/acquistare chiede login/registrazione lato client.
  // Match esatto per non aprire anche /student/bookings.
  const publicStudentPages = ['/student/book', '/student/buy', '/student/shop']
  const isPublicStudent = publicStudentPages.some((p) => stripped === p || stripped === `${p}/`)
  if (publicRoutes.some((r) => stripped.startsWith(r)) || isPublicStudent || stripped.startsWith('/api/') || pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
    return supabaseResponse
  }

  // Root path: sempre la landing pubblica, anche da loggati (come in incognito).
  // Da lì si entra nella propria area con Accedi / link dashboard.
  if (stripped === '/' || stripped === '') {
    return supabaseResponse
  }

  // Not logged in → redirect to login (preserve intended destination)
  if (!user) {
    // Mai redirect su un PREFETCH: se il prefetch capita durante un refresh del
    // token, il redirect a /login viene messo in cache dal router e il click
    // reale rimbalza su /login → /select-role pur essendo loggati.
    if (isPrefetch) return supabaseResponse
    const loginUrl = new URL(`/${locale}/login`, request.url)
    if (stripped !== '/') loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Get roles + language preference from profiles table
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, roles, language_preference')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[middleware] profile fetch error:', profileError.message, 'user:', user.id, 'path:', pathname)
  }

  // Sync language_preference from profile to cookie (so middleware can redirect on next request)
  if (profile?.language_preference && !request.cookies.get('user_locale')) {
    supabaseResponse.cookies.set('user_locale', profile.language_preference, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    })
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

  if (userRoles.length > 0) {
    const hasAccess = userRoles.some(r => roleRoutes[r] && stripped.startsWith(roleRoutes[r]))
    if (!hasAccess) {
      return NextResponse.redirect(new URL(`/${locale}/${userRoles[0]}/dashboard`, request.url))
    }
  }

  return supabaseResponse
}
