import { NextResponse } from 'next/server'
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

// GET: list student's own documents (grouped by school)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('student_documents')
    .select('id, type, file_url, uploaded_at, expires_at, status, validated_at, school_id, schools(name)')
    .eq('student_id', student.id)
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.error('[student/documents GET] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = new Date()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const computed = (data ?? []).map(doc => {
    if (!doc.expires_at) return doc
    const exp = new Date(doc.expires_at)
    let status = doc.status
    if (exp < now) status = 'expired'
    else if (exp.getTime() - now.getTime() < thirtyDays) status = 'expiring'
    else status = 'valid'
    return { ...doc, status }
  })

  return NextResponse.json(computed)
}

// POST: upload a document (file already uploaded to Storage, send URL)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const body = await request.json()
  const { school_id, type, file_url } = body

  if (!school_id || !type || !file_url) {
    return NextResponse.json({ error: 'school_id, type, and file_url are required' }, { status: 400 })
  }

  const validTypes = ['medical_cert', 'privacy', 'image_release']
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
  }

  // Verify student is enrolled in this school (school_students.student_id = auth.users.id)
  const { data: enrollment } = await supabase
    .from('school_students')
    .select('id')
    .eq('student_id', user.id)
    .eq('school_id', school_id)
    .single()

  if (!enrollment) {
    return NextResponse.json({ error: 'Not enrolled in this school' }, { status: 403 })
  }

  // Upsert: replace existing document of same type for this school
  const { data: existing } = await supabase
    .from('student_documents')
    .select('id')
    .eq('student_id', student.id)
    .eq('school_id', school_id)
    .eq('type', type)
    .maybeSingle()

  const db = admin()

  if (existing) {
    const { error } = await db
      .from('student_documents')
      .update({
        file_url,
        uploaded_at: new Date().toISOString(),
        status: 'valid',
        validated_by: null,
        validated_at: null,
        expires_at: null,
      })
      .eq('id', existing.id)

    if (error) {
      console.error('[student/documents POST] update error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    const { error } = await db
      .from('student_documents')
      .insert({
        student_id: student.id,
        school_id,
        type,
        file_url,
        uploaded_at: new Date().toISOString(),
        status: 'valid',
      })

    if (error) {
      console.error('[student/documents POST] insert error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
