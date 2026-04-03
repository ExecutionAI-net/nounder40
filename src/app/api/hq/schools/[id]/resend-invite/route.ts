import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function inviteEmailHtml(schoolName: string, inviteLink: string) {
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
          <h2 style="margin:0 0 12px;color:#111827;font-size:18px">Welcome!</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.6">
            Your school <strong style="color:#6B1F3A">${schoolName}</strong> has been registered on No Under 40.
            Click below to set your password and access your dashboard.
          </p>
          <a href="${inviteLink}" style="display:inline-block;padding:13px 28px;background:#6B1F3A;color:#fff;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none">
            Set Password &amp; Login →
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
      db.from('profiles').select('role').eq('id', session.user.id).single(),
      db.from('schools').select('id, name, email').eq('id', id).single(),
    ])

    if (callerProfile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!school) return NextResponse.json({ error: 'School not found' }, { status: 404 })

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app').replace(/\/$/, '')

    // Check if user already exists in profiles
    const { data: existingProfile } = await db
      .from('profiles')
      .select('id')
      .eq('email', school.email)
      .maybeSingle()

    let inviteLink: string | null = null

    if (existingProfile) {
      // Existing user → magic link to setup-account
      const { data, error } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: school.email,
        options: { redirectTo: `${appUrl}/setup-account` },
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
      if (error) {
        console.error('generateLink invite error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (data?.user) {
        inviteLink = data.properties?.action_link ?? null
        // Set up profile for new user
        await db.from('profiles').upsert({
          id: data.user.id,
          email: school.email,
          name: `${school.name} Admin`,
          role: 'school',
          roles: ['school'],
          school_id: school.id,
          school_sub_role: 'admin',
        })
        await db.from('schools').update({ user_id: data.user.id }).eq('id', school.id)
      } else {
        // User exists in auth but not profiles — fall back to magic link
        const { data: ml, error: mlError } = await db.auth.admin.generateLink({
          type: 'magiclink',
          email: school.email,
          options: { redirectTo: `${appUrl}/setup-account` },
        })
        if (mlError) {
          console.error('generateLink magiclink fallback error:', mlError)
          return NextResponse.json({ error: mlError.message }, { status: 500 })
        }
        inviteLink = ml?.properties?.action_link ?? null
      }
    }

    if (!inviteLink) {
      return NextResponse.json({ error: 'Could not generate invite link' }, { status: 500 })
    }

    await sendEmail({
      to: { email: school.email, name: school.name },
      subject: `You've been invited to No Under 40 — ${school.name}`,
      htmlBody: inviteEmailHtml(school.name, inviteLink),
    })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/hq/schools/[id]/resend-invite error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
