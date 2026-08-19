import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { docStatus } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// GET /api/school/students/detail?student_id=<students.id>
// Uso di pacchetti e abbonamenti della studentessa presso QUESTA scuola:
// pacchetti (tutti gli stati) con crediti usati/rimasti, abbonamenti, ultime prenotazioni.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const schoolId = profile.school_id

  const studentId = new URL(request.url).searchParams.get('student_id')
  if (!studentId) return NextResponse.json({ error: 'student_id required' }, { status: 400 })

  const db = createAdminClient()

  // La studentessa deve appartenere alla scuola
  const { data: link } = await db
    .from('school_students')
    .select('id')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .maybeSingle()
  if (!link) return NextResponse.json({ error: 'Student not in your school' }, { status: 403 })

  const [{ data: packages }, { data: subscriptions }, { data: bookings }] = await Promise.all([
    db.from('student_packages')
      .select('id, credits_total, credits_remaining, purchased_at, expires_at, status, payment_method, packages(name_en, name_it, name_es)')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .order('purchased_at', { ascending: false }),
    db.from('student_subscriptions')
      .select('id, access_total, access_remaining, started_at, current_period_end, status, subscriptions_catalog(name_en, name_it, name_es)')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .order('started_at', { ascending: false }),
    db.from('bookings')
      .select(`
        id, status, credits_deducted, access_source, booked_at, cancelled_at, credit_refunded,
        lessons!lesson_id(date, start_time, courses!course_id(name), lesson_types!lesson_type_id(name_en, name_it, name_es))
      `)
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .order('booked_at', { ascending: false })
      .limit(30),
  ])

  // Scheda allieva: anagrafica, documenti raccolti e tipi richiesti dalla scuola
  const [{ data: student }, { data: documents }, { data: documentTypes }] = await Promise.all([
    db.from('students')
      .select('id, user_id, name, email, phone, date_of_birth, address, city, country, language_preference, created_at')
      .eq('id', studentId)
      .maybeSingle(),
    db.from('student_documents')
      .select('id, type, type_id, variant, files, file_url, uploaded_at, expires_at, status, validated_at, note')
      .eq('school_id', schoolId)
      .eq('student_id', studentId),
    db.from('school_document_types')
      .select('id, name, variants, has_expiry, required, active')
      .eq('school_id', schoolId)
      .eq('active', true)
      .order('sort_order'),
  ])

  return NextResponse.json({
    student: student ?? null,
    documents: (documents ?? []).map(doc => ({ ...doc, status: docStatus(doc) })),
    documentTypes: documentTypes ?? [],
    packages: packages ?? [],
    subscriptions: subscriptions ?? [],
    bookings: bookings ?? [],
  })
}
