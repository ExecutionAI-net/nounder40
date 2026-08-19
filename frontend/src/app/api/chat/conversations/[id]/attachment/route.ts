import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

// La conversazione dev'essere visibile all'utente: le policy RLS su
// `conversations` fanno da filtro, qui basta guardare l'esito della lettura.
async function canAccess(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: conv } = await supabase.from('conversations').select('id').eq('id', id).maybeSingle()
  return conv ? user : null
}

// Carica un allegato (immagine, PDF o documento) e restituisce il percorso da
// salvare sul messaggio. Il bucket è privato: si legge con GET qui sotto.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await canAccess(id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  // Nome ripulito ma riconoscibile: resta leggibile nella chat
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-60)
  const path = `${id}/${Date.now()}-${safeName}`

  const admin = createAdminClient()
  const { error } = await admin.storage
    .from('chat-attachments')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ path, name: file.name, mime: file.type })
}

// Apertura dell'allegato con link firmato (?path=...)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await canAccess(id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const path = new URL(request.url).searchParams.get('path')
  // Il percorso appartiene per forza a questa conversazione
  if (!path || !path.startsWith(`${id}/`)) return NextResponse.json({ error: 'bad_path' }, { status: 400 })

  const { data: signed, error } = await createAdminClient()
    .storage.from('chat-attachments')
    .createSignedUrl(path, 300)

  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'sign_failed' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
