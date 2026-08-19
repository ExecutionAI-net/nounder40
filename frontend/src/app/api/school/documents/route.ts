import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { docStatus } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// Situazione documenti della scuola, vista per allieva: ci sono tutte le
// iscritte, anche quelle che non hanno ancora consegnato niente.
// Gli allegati si aprono con link firmati da /api/documents/<id>/file.
export async function GET() {
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const schoolId = auth.profile.school_id
  const admin = createAdminClient()

  const [{ data: enrollments }, { data: types }] = await Promise.all([
    admin.from('school_students').select('student_id, enrolled_at').eq('school_id', schoolId),
    admin.from('school_document_types')
      .select('id, name, variants, has_expiry, required')
      .eq('school_id', schoolId)
      .eq('active', true)
      .order('sort_order'),
  ])

  const studentIds = (enrollments ?? []).map(e => e.student_id)
  if (studentIds.length === 0) return NextResponse.json({ types: types ?? [], students: [] })

  const [{ data: students }, { data: docs }] = await Promise.all([
    admin.from('students').select('id, name, email, phone').in('id', studentIds),
    admin.from('student_documents')
      .select('id, student_id, type, type_id, variant, files, file_url, uploaded_at, expires_at, status, validated_at, note')
      .eq('school_id', schoolId)
      .in('student_id', studentIds),
  ])

  const byStudent = new Map<string, typeof docs>()
  for (const doc of docs ?? []) {
    const list = byStudent.get(doc.student_id) ?? []
    list.push({ ...doc, status: docStatus(doc) })
    byStudent.set(doc.student_id, list)
  }

  const rows = (students ?? [])
    .map(s => ({ ...s, documents: byStudent.get(s.id) ?? [] }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  return NextResponse.json({ types: types ?? [], students: rows })
}
