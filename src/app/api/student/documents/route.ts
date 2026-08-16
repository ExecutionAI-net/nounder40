import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { docStatus } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// Documenti dell'allieva più l'elenco di cosa le viene chiesto: le scuole in
// cui è iscritta e, per ciascuna, i tipi attivi (con varianti e obbligatorietà).
// Il caricamento passa da /api/documents/upload, l'apertura da
// /api/documents/<id>/file (link firmati: il bucket è privato).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: student } = await admin
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!student) return NextResponse.json({ documents: [], schools: [] })

  const [{ data: docs }, { data: enrollments }] = await Promise.all([
    admin
      .from('student_documents')
      .select('id, type, type_id, variant, files, file_url, uploaded_at, expires_at, status, validated_at, note, school_id, schools(name)')
      .eq('student_id', student.id)
      .order('uploaded_at', { ascending: false }),
    admin
      .from('school_students')
      .select('school_id, schools(id, name)')
      .eq('student_id', student.id),
  ])

  const schoolIds = [...new Set((enrollments ?? []).map(e => e.school_id))]
  const { data: types } = schoolIds.length
    ? await admin
        .from('school_document_types')
        .select('id, school_id, code, name, variants, has_expiry, required, sort_order')
        .in('school_id', schoolIds)
        .eq('active', true)
        .order('sort_order')
    : { data: [] }

  const schools = schoolIds.map(id => {
    const enrollment = (enrollments ?? []).find(e => e.school_id === id)
    const school = enrollment?.schools as unknown as { id: string; name: string } | null
    return {
      id,
      name: school?.name ?? '',
      types: (types ?? []).filter(t => t.school_id === id),
    }
  })

  return NextResponse.json({
    documents: (docs ?? []).map(doc => ({ ...doc, status: docStatus(doc) })),
    schools,
  })
}
