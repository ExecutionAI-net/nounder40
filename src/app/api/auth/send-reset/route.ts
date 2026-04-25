import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { email, origin } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

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

    // Point the reset link straight at the client page. Exchanging the code
    // server-side (via /api/auth/reset-exchange) set httpOnly cookies that the
    // browser Supabase client can't read — getSession() came back null and the
    // page redirected to /login. The client-side page reads the code from the
    // URL and runs exchangeCodeForSession itself, which stores the session via
    // the browser cookie handler (non-httpOnly, readable by JS).
    const redirectTo = `${origin}/reset-password`

    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })

    if (error) {
      console.error('[send-reset] error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    console.log('[send-reset] reset email sent to:', email)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-reset] unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
