import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024 // 4MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

// Upload/replace the lesson type image (HQ level, shown to students when booking)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: lt } = await admin.from('lesson_types').select('id, image_url').eq('id', id).single()
  if (!lt) return NextResponse.json({ error: 'Lesson type not found' }, { status: 404 })

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `lesson-types/${id}-${Date.now()}.${ext}`

  const { error: upErr } = await admin.storage.from('school-assets')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from('school-assets').getPublicUrl(path)
  const { error } = await admin.from('lesson_types').update({ image_url: pub.publicUrl }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (lt.image_url) {
    const old = lt.image_url.split('/school-assets/')[1]
    if (old) await admin.storage.from('school-assets').remove([old]).catch(() => {})
  }

  return NextResponse.json({ image_url: pub.publicUrl })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: lt } = await admin.from('lesson_types').select('id, image_url').eq('id', id).single()
  if (!lt) return NextResponse.json({ error: 'Lesson type not found' }, { status: 404 })

  if (lt.image_url) {
    const old = lt.image_url.split('/school-assets/')[1]
    if (old) await admin.storage.from('school-assets').remove([old]).catch(() => {})
  }
  await admin.from('lesson_types').update({ image_url: null }).eq('id', id)
  return NextResponse.json({ ok: true })
}
