import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { DocFile } from '@/lib/documents'

export const dynamic = 'force-dynamic'

// Apertura di un allegato: il bucket `documents` è privato, quindi si genera
// un link firmato a scadenza breve invece di esporre un URL permanente
// (sono carte d'identità e certificati medici).
// GET /api/documents/<docId>/file?i=<indice allegato>
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('student_documents')
    .select('id, school_id, files, file_url, students(user_id)')
    .eq('id', id)
    .maybeSingle<{ id: string; school_id: string; files: DocFile[] | null; file_url: string | null; students: { user_id: string } | null }>()

  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Può vedere il documento: l'allieva stessa, la sua scuola, HQ
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()
  const isHQ = profile?.role === 'hq' || profile?.roles?.includes('hq')
  const isOwner = doc.students?.user_id === user.id
  const isSchool = !!profile?.school_id && profile.school_id === doc.school_id
  if (!isHQ && !isOwner && !isSchool) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const index = Number(new URL(request.url).searchParams.get('i') ?? 0)
  const files = Array.isArray(doc.files) ? doc.files : []
  const file = files[index]

  // Documenti caricati prima degli allegati multipli: resta l'URL salvato
  if (!file) {
    if (index === 0 && doc.file_url) return NextResponse.redirect(doc.file_url)
    return NextResponse.json({ error: 'file_not_found' }, { status: 404 })
  }

  const { data: signed, error } = await admin.storage
    .from('documents')
    .createSignedUrl(file.path, 120)

  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'sign_failed' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}
