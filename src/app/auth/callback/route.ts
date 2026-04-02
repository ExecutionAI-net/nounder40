import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
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
        const admin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Check if this is a new invite (user_metadata has hq_sub_role set by inviteUserByEmail)
        const meta = user.user_metadata ?? {}
        const isHQInvite = !!meta.hq_sub_role

        if (isHQInvite) {
          // First-time invite activation: create/update profile with HQ role
          const { data: existingProfile } = await admin
            .from('profiles')
            .select('id, roles, role')
            .eq('id', user.id)
            .single()

          const currentRoles: string[] = existingProfile?.roles?.length
            ? existingProfile.roles
            : existingProfile?.role ? [existingProfile.role] : []

          const updatedRoles = Array.from(new Set([...currentRoles, 'hq']))

          await admin.from('profiles').upsert({
            id: user.id,
            email: user.email!,
            name: meta.name ?? meta.full_name ?? user.email!.split('@')[0],
            role: 'hq',
            roles: updatedRoles,
            hq_sub_role: meta.hq_sub_role,
          })

          // Remove from pending_invitations
          await admin.from('pending_invitations').delete().eq('email', user.email!)

          return NextResponse.redirect(`${origin}/setup-account`)
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role, roles, name')
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
          }).catch(() => {})
        }

        // Multi-role: redirect to role selector
        const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
        if (roles.length > 1) {
          return NextResponse.redirect(`${origin}/select-role`)
        }

        const role = profile?.role ?? 'student'
        return NextResponse.redirect(`${origin}/${role}/dashboard`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
