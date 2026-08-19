import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const origin = req.nextUrl.origin

    console.log('[reset-exchange] code present:', !!code)

    if (!code) {
      return NextResponse.redirect(new URL('/login?error=reset_expired', origin))
    }

    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[reset-exchange] error:', error.message)
      return NextResponse.redirect(new URL('/login?error=reset_expired', origin))
    }

    console.log('[reset-exchange] session exchanged, redirecting to /reset-password')
    return NextResponse.redirect(new URL('/reset-password', origin))
  } catch (err) {
    console.error('[reset-exchange] unexpected error:', err)
    return NextResponse.redirect(new URL('/login?error=reset_expired', req.nextUrl.origin))
  }
}
