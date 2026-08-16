import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateUploadSet, type DocFile } from '@/lib/documents'

export const dynamic = 'force-dynamic'

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Caricamento documento, usato da entrambi i lati:
// - l'allieva carica per sé
// - la scuola carica per una sua allieva (chi porta il cartaceo) e può già
//   indicare la scadenza
// Campi (multipart): type_id, school_id, variant?, student_id? (solo scuola/HQ),
// expires_at? (solo scuola/HQ), files[]
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()
  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')

  const form = await request.formData()
  const typeId = String(form.get('type_id') ?? '')
  const variant = form.get('variant') ? String(form.get('variant')) : null
  const requestedStudentId = form.get('student_id') ? String(form.get('student_id')) : null
  const expiresAt = form.get('expires_at') ? String(form.get('expires_at')) : null
  const files = form.getAll('files').filter((f): f is File => f instanceof File)

  if (!typeId) return NextResponse.json({ error: 'type_id_required' }, { status: 400 })

  const invalid = validateUploadSet(files.map(f => ({ type: f.type, size: f.size })))
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  const admin = createAdminClient()

  const { data: docType } = await admin
    .from('school_document_types')
    .select('id, school_id, code, variants, has_expiry, active')
    .eq('id', typeId)
    .maybeSingle()
  if (!docType || !docType.active) return NextResponse.json({ error: 'type_not_found' }, { status: 404 })

  // Chi carica per chi: l'allieva solo per sé, la scuola solo per le proprie
  let studentId: string | null = null
  const canManage = isHQ || (!!profile?.school_id && profile.school_id === docType.school_id)

  if (requestedStudentId && canManage) {
    studentId = requestedStudentId
  } else {
    const { data: me } = await admin.from('students').select('id').eq('user_id', user.id).maybeSingle()
    if (!me) return NextResponse.json({ error: 'student_not_found' }, { status: 404 })
    studentId = me.id
  }

  // La variante, se il tipo ne prevede, dev'essere una di quelle ammesse
  if (variant && docType.variants?.length && !docType.variants.includes(variant)) {
    return NextResponse.json({ error: 'invalid_variant' }, { status: 400 })
  }

  // Carica gli allegati nel bucket privato
  const uploaded: DocFile[] = []
  const stamp = Date.now()
  for (const [i, file] of files.entries()) {
    const path = `${docType.school_id}/${studentId}/${docType.code}-${stamp}-${i}.${EXT[file.type]}`
    const { error: upErr } = await admin.storage
      .from('documents')
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    uploaded.push({ path, name: file.name, mime: file.type, size: file.size })
  }

  // Un documento per allieva/scuola/tipo: il nuovo caricamento sostituisce
  // il precedente e riapre la validazione.
  const { data: existing } = await admin
    .from('student_documents')
    .select('id, files')
    .eq('student_id', studentId)
    .eq('school_id', docType.school_id)
    .eq('type', docType.code)
    .maybeSingle<{ id: string; files: DocFile[] | null }>()

  const row = {
    student_id: studentId,
    school_id: docType.school_id,
    type: docType.code,
    type_id: docType.id,
    variant,
    files: uploaded,
    file_url: null,
    uploaded_at: new Date().toISOString(),
    status: 'valid',
    // La scadenza la decide la scuola: se carica l'allieva resta da compilare
    expires_at: docType.has_expiry && expiresAt && canManage ? expiresAt : null,
    validated_by: canManage ? user.id : null,
    validated_at: canManage ? new Date().toISOString() : null,
  }

  const { data: saved, error } = existing
    ? await admin.from('student_documents').update(row).eq('id', existing.id).select('id').single()
    : await admin.from('student_documents').insert(row).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Gli allegati sostituiti non servono più
  const oldPaths = (existing?.files ?? []).map(f => f.path).filter(Boolean)
  if (oldPaths.length) await admin.storage.from('documents').remove(oldPaths)

  return NextResponse.json({ id: saved.id })
}
