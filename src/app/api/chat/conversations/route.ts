import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const type = searchParams.get('type')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('conversations')
    .select('id, type, status, priority, assigned_to, created_at, last_message_at, school_id, student_id, teacher_id, schools(id, name), students(id, name, email), teachers(id, name, email)')
    .order('last_message_at', { ascending: false })

  if (status) query = query.eq('status', status)

  if (profile.role === 'hq') {
    query = query.eq('type', type ?? 'hq_school')
  } else if (profile.role === 'school' && profile.school_id) {
    query = query.eq('school_id', profile.school_id)
    if (type) query = query.eq('type', type)
  } else if (profile.role === 'teacher') {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (teacher) {
      query = query.eq('teacher_id', teacher.id).eq('type', 'school_teacher')
    } else {
      return NextResponse.json([])
    }
  } else if (profile.role === 'student') {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (student) {
      query = query.eq('student_id', student.id).eq('type', 'school_student')
    } else {
      return NextResponse.json([])
    }
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data } = await query
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  if (profile.role === 'student') {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    const { data: schoolStudent } = await supabase
      .from('school_students')
      .select('school_id')
      .eq('student_id', student.id)
      .order('enrolled_at', { ascending: false })
      .limit(1)
      .single()

    if (!schoolStudent) return NextResponse.json({ error: 'No school enrollment found' }, { status: 400 })

    // Return existing open conversation if any
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('student_id', student.id)
      .eq('school_id', schoolStudent.school_id)
      .eq('type', 'school_student')
      .in('status', ['open', 'in_progress'])
      .maybeSingle()

    if (existing) return NextResponse.json(existing)

    const { data: conv } = await supabase
      .from('conversations')
      .insert({
        type: 'school_student',
        school_id: schoolStudent.school_id,
        student_id: student.id,
        status: 'open',
        priority: 'medium',
      })
      .select('id')
      .single()

    return NextResponse.json(conv)
  }

  if (profile.role === 'hq') {
    const { school_id } = body
    if (!school_id) return NextResponse.json({ error: 'school_id required' }, { status: 400 })

    const { data: conv } = await supabase
      .from('conversations')
      .insert({
        type: 'hq_school',
        school_id,
        hq_id: user.id,
        status: 'open',
        priority: body.priority ?? 'medium',
      })
      .select('id')
      .single()

    return NextResponse.json(conv)
  }

  if (profile.role === 'school' && profile.school_id) {
    const { student_id, conv_type } = body

    if (conv_type === 'school_teacher' && body.teacher_id) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('teacher_id', body.teacher_id)
        .eq('school_id', profile.school_id)
        .eq('type', 'school_teacher')
        .in('status', ['open', 'in_progress'])
        .maybeSingle()

      if (existing) return NextResponse.json(existing)

      const { data: conv } = await supabase
        .from('conversations')
        .insert({
          type: 'school_teacher',
          school_id: profile.school_id,
          teacher_id: body.teacher_id,
          status: 'open',
          priority: 'medium',
        })
        .select('id')
        .single()

      return NextResponse.json(conv)
    }

    if (conv_type === 'school_student' && student_id) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('student_id', student_id)
        .eq('school_id', profile.school_id)
        .eq('type', 'school_student')
        .in('status', ['open', 'in_progress'])
        .maybeSingle()

      if (existing) return NextResponse.json(existing)

      const { data: conv } = await supabase
        .from('conversations')
        .insert({
          type: 'school_student',
          school_id: profile.school_id,
          student_id,
          status: 'open',
          priority: 'medium',
        })
        .select('id')
        .single()

      return NextResponse.json(conv)
    }

    if (conv_type === 'hq_school') {
      const { data: conv } = await supabase
        .from('conversations')
        .insert({
          type: 'hq_school',
          school_id: profile.school_id,
          status: 'open',
          priority: body.priority ?? 'medium',
        })
        .select('id')
        .single()

      return NextResponse.json(conv)
    }
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
}
