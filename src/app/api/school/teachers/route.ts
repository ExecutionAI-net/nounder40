import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return 'Nu40_' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('teacher_schools')
    .select(`
      teacher_id, active,
      teachers(id, name, email, phone, active, created_at),
      compensation_plans(id, name)
    `)
    .eq('school_id', profile.school_id)
    .order('teacher_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, email, phone } = await request.json()
  if (!name || !email) return NextResponse.json({ error: 'name and email are required' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const tempPassword = generateTempPassword()

  const { data: userData, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  })

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })

  const teacherUserId = userData.user.id

  // Create teacher record (no school_id — linked via teacher_schools)
  const { data: teacher, error: teacherError } = await admin.from('teachers').insert({
    user_id: teacherUserId,
    name,
    email,
    phone: phone || null,
    active: true,
  }).select().single()

  if (teacherError) {
    await admin.auth.admin.deleteUser(teacherUserId)
    return NextResponse.json({ error: teacherError.message }, { status: 500 })
  }

  // Link teacher to school
  await admin.from('teacher_schools').insert({
    teacher_id: teacher.id,
    school_id: profile.school_id,
    active: true,
  })

  // Create profile
  await admin.from('profiles').upsert({
    id: teacherUserId,
    email,
    name,
    role: 'teacher',
    school_id: profile.school_id,
  })

  return NextResponse.json({ id: teacher.id, tempPassword })
}
