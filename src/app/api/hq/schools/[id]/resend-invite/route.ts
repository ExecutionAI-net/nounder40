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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
        <tr>
          <td style="background:#6B1F3A;padding:32px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700">No Under 40</h1>
            <p style="margin:8px 0 0;color:#f3d4de;font-size:13px">Classical Dance Network</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600">Welcome to No Under 40!</h2>
            <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
              Your school <strong style="color:#6B1F3A">${schoolName}</strong> has been registered on the platform.
            </p>
            <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6">
              Click the button below to set up your password and access your school dashboard.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#6B1F3A;border-radius:10px">
                  <a href="${inviteLink}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                    Set Password &amp; Login →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.6">
              This link expires in 24 hours. If you did not expect this email, you can safely ignore it.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">No Under 40 · Classical Dance Network</p>
          </td>
        </tr>
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
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const db = admin()

    const [{ data: profile }, { data: school }] = await Promise.all([
      db.from('profiles').select('role').eq('id', session.user.id).single(),
      db.from('schools').select('id, name, email').eq('id', id).single(),
    ])

    if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!school) return NextResponse.json({ error: 'School not found' }, { status: 404 })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nounder40-n48u-five.vercel.app'
    let inviteLink: string | null = null

    // Try invite link first (new users)
    const { data: linkData } = await db.auth.admin.generateLink({
      type: 'invite',
      email: school.email,
      options: {
        redirectTo: `${appUrl}/auth/callback`,
        data: { school_invite: true, school_id: school.id, school_name: school.name },
      },
    })

    if (linkData?.user) {
      // New auth user created — set up profile
      const userId = linkData.user.id
      inviteLink = linkData.properties.action_link
      await db.from('profiles').upsert({
        id: userId,
        email: school.email,
        name: `${school.name} Admin`,
        role: 'school',
        roles: ['school'],
        school_id: school.id,
        school_sub_role: 'admin',
      })
      await db.from('schools').update({ user_id: userId }).eq('id', school.id)
    } else {
      // Existing auth user (Google OAuth or already invited) — send magic link
      const { data: magicData } = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: school.email,
        options: { redirectTo: `${appUrl}/setup-account` },
      })
      inviteLink = magicData?.properties.action_link ?? null
    }

    if (!inviteLink) return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 })

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
