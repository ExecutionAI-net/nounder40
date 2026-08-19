import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DocFile } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// Rimozione di un documento (allegati compresi).
// L'allieva può togliere solo ciò che non è ancora stato approvato: una volta
// validato dalla scuola resta agli atti e lo rimuove soltanto la scuola,
// altrimenti si perderebbe la traccia del documento buono.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('student_documents')
    .select('id, school_id, files, validated_at, students(user_id)')
    .eq('id', id)
    .maybeSingle<{
      id: string
      school_id: string
      files: DocFile[] | null
      validated_at: string | null
      students: { user_id: string } | null
    }>()

  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()

  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')
  const isSchool = !!profile?.school_id && profile.school_id === doc.school_id
  const isOwner = doc.students?.user_id === user.id

  if (!isHQ && !isSchool) {
    if (!isOwner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (doc.validated_at) return NextResponse.json({ error: 'approved_locked' }, { status: 403 })
  }

  const { error } = await admin.from('student_documents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const paths = (doc.files ?? []).map(f => f.path).filter(Boolean)
  if (paths.length) await admin.storage.from('documents').remove(paths)

  return NextResponse.json({ deleted: true })
}
