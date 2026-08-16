import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DocFile } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// Azioni della scuola su un documento:
//   validate → approva (con scadenza facoltativa)
//   expiry   → cambia solo la data di scadenza
//   reject   → rimanda indietro il documento
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, expires_at, note } = await request.json()
  const admin = createAdminClient()

  const patch: Record<string, unknown> = {}

  if (action === 'validate') {
    patch.status = 'valid'
    patch.validated_by = auth.user.id
    patch.validated_at = new Date().toISOString()
    if (expires_at !== undefined) patch.expires_at = expires_at || null
  } else if (action === 'expiry') {
    patch.expires_at = expires_at || null
  } else if (action === 'reject') {
    patch.status = 'expired'
    patch.validated_by = null
    patch.validated_at = null
    if (note !== undefined) patch.note = note || null
  } else if (action === 'flag') {
    // Segnalazione: lascia il documento com'è e aggiunge una nota che
    // l'allieva legge sotto al documento (es. "foto illeggibile")
    patch.note = note || null
  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { error } = await admin
    .from('student_documents')
    .update(patch)
    .eq('id', id)
    .eq('school_id', auth.profile.school_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: true })
}

// Rimozione del documento e dei suoi allegati dal bucket
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('school')
  if (!auth?.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('student_documents')
    .select('id, files')
    .eq('id', id)
    .eq('school_id', auth.profile.school_id)
    .maybeSingle<{ id: string; files: DocFile[] | null }>()

  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error } = await admin.from('student_documents').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const paths = (doc.files ?? []).map(f => f.path).filter(Boolean)
  if (paths.length) await admin.storage.from('documents').remove(paths)

  return NextResponse.json({ deleted: true })
}
