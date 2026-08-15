import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024 // 4MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Upload immagine per i template email (HQ). Restituisce l'URL pubblico da
// inserire nel corpo dell'email (bucket school-assets, cartella email-assets/).
export async function POST(request: Request) {
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg'
  const path = `email-assets/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const admin = createAdminClient()
  const { error: upErr } = await admin.storage.from('school-assets')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from('school-assets').getPublicUrl(path)
  return NextResponse.json({ image_url: pub.publicUrl })
}
