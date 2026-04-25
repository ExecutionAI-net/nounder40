import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/zepto'
import { schoolMemberInviteEmailHtml } from '@/lib/email-templates'
import { revalidateAll } from '@/lib/revalidate'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const SUB_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff',
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, roles, school_id, school_sub_role')
    .eq('id', user.id)
    .single()

  const isSchool = callerProfile?.role === 'school' || callerProfile?.roles?.includes('school')
  if (!isSchool || !callerProfile?.school_id || callerProfile.school_sub_role !== 'owner') {
    revalidateAll()
    return NextResponse.json({ error: 'Forbidden: Only school owners can resend invitations' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()

  // Get pending invitation
  const { data: pendingInvite } = await db
    .from('pending_invitations')
    .select('id, email, name, role_detail, school_id')
    .eq('id', id)
    .eq('type', 'school_member')
    .single()

  if (!pendingInvite) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  if (pendingInvite.school_id !== callerProfile.school_id) {
    revalidateAll()
    return NextResponse.json({ error: 'Invitation is not for your school' }, { status: 403 })
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { data: schoolData } = await db.from('schools').select('name').eq('id', callerProfile.school_id).single()

    // Generate magic link
    const { data: linkData, error: inviteError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: pendingInvite.email,
      options: {
        redirectTo: `${appUrl}/setup-account`,
        data: {
          name: pendingInvite.name,
          school_member_invite: true,
          school_id: callerProfile.school_id,
          school_name: schoolData?.name,
          sub_role: pendingInvite.role_detail,
        },
      },
    })

    if (inviteError || !linkData?.properties?.action_link) {
      revalidateAll()
      return NextResponse.json({ error: inviteError?.message ?? 'Failed to generate invite link' }, { status: 500 })
    }

    const roleLabel = SUB_ROLE_LABELS[pendingInvite.role_detail ?? 'staff'] ?? pendingInvite.role_detail
    sendEmail({
      to: { email: pendingInvite.email, name: pendingInvite.name },
      subject: `You have been invited to ${schoolData?.name} on No Under 40`,
      htmlBody: schoolMemberInviteEmailHtml(pendingInvite.name, schoolData?.name ?? 'School', linkData.properties.action_link, roleLabel),
    }).catch(() => {})

    revalidateAll()
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/school/team/resend error:', msg)
    revalidateAll()
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
