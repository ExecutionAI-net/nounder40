import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function inviteEmailHtml(schoolName: string, inviteLink: string, isExistingUser: boolean) {
  const headline = isExistingUser ? 'You now have school access!' : 'Welcome!'
  const body = isExistingUser
    ? `Your existing account has been granted school admin access for <strong style="color:#6B1F3A">${schoolName}</strong> on No Under 40. Click below to sign in and select your dashboard.`
    : `Your school <strong style="color:#6B1F3A">${schoolName}</strong> has been registered on No Under 40. Click below to set your password and access your dashboard.`
  const cta = isExistingUser ? 'Go to Dashboard →' : 'Set Password &amp; Login →'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e5e7eb">
        <tr><td style="background:#6B1F3A;padding:28px;text-align:center;border-radius:16px 16px 0 0">
          <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">No Under 40</h1>
        </td></tr>
        <tr><td style="padding:36px">
          <h2 style="margin:0 0 12px;color:#111827;font-size:18px">${headline}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">${body}</p>
          <a href="${inviteLink}" style="display:inline-block;padding:13px 28px;background:#6B1F3A;color:#fff;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none">
            ${cta}
          </a>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">Link expires in 24 hours.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = admin()

  try {
    // Auth check
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [{ data: callerProfile }, { data: school }] = await Promise.all([
      db.from('profiles').select('role, roles').eq('id', session.user.id).single(),
      db.from('schools').select('id, name, email').eq('id', id).single(),
    ])

    if (!(callerProfile?.role === 'hq' || callerProfile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!school) return NextResponse.json({ error: 'School not found' }, { status: 404 })

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app').replace(/\/$/, '')

    // Check if user already exists in profiles
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id')
      .eq('email', school.email)
      .maybeSingle()

    let inviteLink: string | null = null
    let isExistingUser = !!existingProfile

    if (existingProfile) {
      // Existing user → magic link to select-role (they already have a password)
      const { data, error } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: school.email,
        options: { redirectTo: `${appUrl}/select-role` },
      })
      if (error) {
        console.error('generateLink magiclink error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      inviteLink = data?.properties?.action_link ?? null
    } else {
      // New user → invite link
      const { data, error } = await db.auth.admin.generateLink({
        type: 'invite',
        email: school.email,
        options: {
          redirectTo: `${appUrl}/auth/callback`,
          data: { school_invite: true, school_id: school.id, school_name: school.name },
        },
      })
      if (error || !data?.user) {
        // User exists in auth but not found in profiles (e.g. email case mismatch) — fall back to magic link
        console.log('generateLink invite error or no user returned, falling back to magic link:', error?.message)
        isExistingUser = true

        // Ensure school role is added via auth.admin lookup
        const { data: { users } } = await db.auth.admin.listUsers()
        const authUser = users.find(u => u.email?.toLowerCase() === school.email.toLowerCase())
        if (authUser) {
          const { data: authProfile } = await db.from('profiles').select('id, roles, role, name').eq('id', authUser.id).maybeSingle()
          const currentRoles: string[] = authProfile?.roles?.length ? authProfile.roles : (authProfile?.role ? [authProfile.role] : [])
          // Always upsert — handles both existing profile and missing profile cases
          await db.from('profiles').upsert({
            id: authUser.id,
            email: school.email,
            name: authProfile?.name ?? `${school.name} Admin`,
            role: authProfile?.role ?? 'school',
            roles: Array.from(new Set([...currentRoles, 'school'])),
            school_id: school.id,
            school_sub_role: 'owner',
          }, { onConflict: 'id' })
          await db.from('schools').update({ user_id: authUser.id }).eq('id', school.id)
        }

        const { data: ml, error: mlError } = await db.auth.admin.generateLink({
          type: 'magiclink',
          email: school.email,
          options: { redirectTo: `${appUrl}/select-role` },
        })
        if (mlError) {
          console.error('generateLink magiclink fallback error:', mlError)
          return NextResponse.json({ error: mlError.message }, { status: 500 })
        }
        inviteLink = ml?.properties?.action_link ?? null
      } else {
        inviteLink = data.properties?.action_link ?? null
        // Set up profile for new user
        await db.from('profiles').upsert({
          id: data.user.id,
          email: school.email,
          name: `${school.name} Admin`,
          role: 'school',
          roles: ['school'],
          school_id: school.id,
          school_sub_role: 'owner',
        })
        await db.from('schools').update({ user_id: data.user.id }).eq('id', school.id)
      }
    }

    if (!inviteLink) {
      return NextResponse.json({ error: 'Could not generate invite link' }, { status: 500 })
    }

    await sendEmail({
      to: { email: school.email, name: school.name },
      subject: `You've been invited to No Under 40 — ${school.name}`,
      htmlBody: inviteEmailHtml(school.name, inviteLink, isExistingUser),
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/hq/schools/[id]/resend-invite error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
