import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Called from /setup-account after a user completes onboarding.
// Processes any pending invitations for their email (teacher invites).
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = admin()

    const { data: pendingInvites } = await db
      .from('pending_invitations')
      .select('id, type, school_id, name, role_detail')
      .eq('email', user.email!)

    if (!pendingInvites?.length) {
      return NextResponse.json({ processed: 0 })
    }

    for (const invite of pendingInvites) {
      if (invite.type === 'school_member' && invite.school_id) {
        // School team member invite
        const { data: existingProfile } = await db
          .from('profiles')
          .select('id, roles, role, name')
          .eq('id', user.id)
          .single()

        const currentRoles: string[] = existingProfile?.roles?.length
          ? existingProfile.roles
          : existingProfile?.role ? [existingProfile.role] : []

        await db.from('profiles').upsert({
          id: user.id,
          email: user.email!,
          name: existingProfile?.name ?? invite.name,
          role: 'school',
          roles: Array.from(new Set([...currentRoles, 'school'])),
          school_id: invite.school_id,
          school_sub_role: invite.role_detail ?? 'staff',
        })
      } else if (invite.type === 'school_teacher' && invite.school_id) {
        const teacherName = invite.name ?? user.email!.split('@')[0]

        // Upsert teacher record
        let teacherId: string | null = null
        const { data: existingTeacher } = await db
          .from('teachers')
          .select('id')
          .eq('email', user.email!)
          .single()

        if (existingTeacher) {
          teacherId = existingTeacher.id
          await db.from('teachers').update({ user_id: user.id, active: true }).eq('id', teacherId)
        } else {
          const newTeacherId = randomUUID()
          const { error: insertErr } = await db
            .from('teachers')
            .insert({ id: newTeacherId, user_id: user.id, school_id: invite.school_id, name: teacherName, email: user.email!, active: true })
          if (!insertErr) teacherId = newTeacherId
          else console.error('process-invite: teachers insert error:', insertErr.message)
        }

        if (teacherId) {
          await db.from('teacher_schools').upsert(
            { teacher_id: teacherId, school_id: invite.school_id, active: true },
            { onConflict: 'teacher_id,school_id' }
          )
        }

        // Update profile roles
        const { data: existingProfile } = await db
          .from('profiles')
          .select('id, roles, role')
          .eq('id', user.id)
          .single()

        const currentRoles: string[] = existingProfile?.roles?.length
          ? existingProfile.roles
          : existingProfile?.role ? [existingProfile.role] : []

        await db.from('profiles').upsert({
          id: user.id,
          email: user.email!,
          name: existingProfile?.name ?? teacherName,
          role: 'teacher',
          roles: Array.from(new Set([...currentRoles, 'teacher'])),
        })
      }

      await db.from('pending_invitations').delete().eq('id', invite.id)
    }

    return NextResponse.json({ processed: pendingInvites.length })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/account/process-invite error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
