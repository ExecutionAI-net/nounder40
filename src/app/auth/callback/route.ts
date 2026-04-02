import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/zepto'
import { welcomeEmailHtml } from '@/lib/email-templates'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Password reset flow — redirect to reset-password page
      if (next === '/reset-password') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }

      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, name')
          .eq('id', user.id)
          .single()

        // Send welcome email if email was just confirmed (within last 2 minutes)
        const confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null
        const justVerified = confirmedAt && (Date.now() - confirmedAt.getTime()) < 120_000

        if (justVerified && user.email) {
          const name = profile?.name ?? user.email.split('@')[0]
          sendEmail({
            to: { email: user.email, name },
            subject: 'Welcome to No Under 40!',
            htmlBody: welcomeEmailHtml(name),
          }).catch(() => {}) // fire-and-forget, don't block redirect
        }

        const role = profile?.role ?? 'student'
        return NextResponse.redirect(`${origin}/${role}/dashboard`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
