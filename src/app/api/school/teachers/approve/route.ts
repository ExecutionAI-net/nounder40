import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles, school_id').eq('id', user.id).single()
  const isSchool = profile?.role === 'school' || profile?.roles?.includes('school')
  if (!isSchool || !profile?.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, password } = await request.json()
  if (!id || !password) return NextResponse.json({ error: 'id and password are required' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: invite } = await db.from('pending_invitations')
    .select('*').eq('id', id).eq('type', 'school_teacher').eq('school_id', profile.school_id).single()
  if (!invite) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const { data: userData, error: createError } = await db.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: invite.name },
  })

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })

  const teacherUserId = userData.user.id

  const { data: teacher, error: teacherError } = await db.from('teachers').insert({
    user_id: teacherUserId,
    name: invite.name,
    email: invite.email,
    phone: invite.phone || null,
    active: true,
  }).select().single()

  if (teacherError) {
    await db.auth.admin.deleteUser(teacherUserId)
    return NextResponse.json({ error: teacherError.message }, { status: 500 })
  }

  await db.from('teacher_schools').insert({
    teacher_id: teacher.id,
    school_id: invite.school_id,
    active: true,
  })

  await db.from('profiles').upsert({
    id: teacherUserId,
    email: invite.email,
    name: invite.name,
    role: 'teacher',
    school_id: invite.school_id,
  })

  await db.from('pending_invitations').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
