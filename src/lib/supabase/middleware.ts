// Security model:
// - All data access controlled by Supabase RLS policies
// - API routes validate user session via createClient() server client
// - Role checks performed in both middleware (routing) and API routes (data access)
// - Admin operations use service role key server-side only
// - Public routes: /login, /register, /auth/callback, /api/*

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
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

  // Public routes and API routes — skip role enforcement
  const publicRoutes = ['/login', '/register', '/auth/callback', '/select-role', '/reset-password']
  if (publicRoutes.some((r) => pathname.startsWith(r)) || pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  // Root path: redirect logged-in users to their dashboard
  if (pathname === '/') {
    if (!user) return NextResponse.redirect(new URL('/login', request.url))
    const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
    const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
    if (roles.length > 1) return NextResponse.redirect(new URL('/select-role', request.url))
    const role = roles[0]
    return NextResponse.redirect(new URL(`/${role}/dashboard`, request.url))
  }

  // Not logged in → redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Get role from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role

  // Role-based route protection
  const roleRoutes: Record<string, string> = {
    hq: '/hq',
    school: '/school',
    teacher: '/teacher',
    student: '/student',
  }

  if (role && pathname === '/') {
    return NextResponse.redirect(new URL(`/${role}/dashboard`, request.url))
  }

  if (role) {
    const allowedPrefix = roleRoutes[role]
    if (allowedPrefix && !pathname.startsWith(allowedPrefix)) {
      return NextResponse.redirect(new URL(`/${role}/dashboard`, request.url))
    }
  }

  return supabaseResponse
}
