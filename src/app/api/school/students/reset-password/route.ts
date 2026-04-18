import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single()

    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { student_email, student_user_id } = await request.json()
    if (!student_email || !student_user_id) {
      return NextResponse.json({ error: 'student_email and student_user_id required' }, { status: 400 })
    }

    // Verify student belongs to this school
    const { data: schoolStudent } = await admin()
      .from('school_students')
      .select('id')
      .eq('school_id', profile.school_id)
      .eq('student_id', student_user_id)
      .maybeSingle()

    if (!schoolStudent) {
      return NextResponse.json({ error: 'Student not found in this school' }, { status: 404 })
    }

    const { error } = await admin().auth.admin.generateLink({
      type: 'recovery',
      email: student_email,
    })

    if (error) {
      console.error('[reset-password] generateLink error', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`[reset-password] sent recovery link to ${student_email}`)
    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('[reset-password] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
