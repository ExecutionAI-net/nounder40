import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

// L'insegnante aggiorna la PROPRIA scheda (la stessa che vede la scuola)
export async function PATCH(request: Request) {
  const auth = await requireRole('teacher')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: teacher } = await admin.from('teachers').select('id, user_id').eq('user_id', auth.user.id).single()
  if (!teacher) return NextResponse.json({ error: 'Teacher record not found' }, { status: 404 })

  const { phone, email, bio } = await request.json()
  const update: Record<string, string | null> = {}
  if (phone !== undefined) update.phone = phone?.trim() || null
  if (email !== undefined) {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
    }
    update.email = email?.trim() || null
  }
  if (bio !== undefined) update.bio = bio?.trim() || null
  if (!Object.keys(update).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { error } = await admin.from('teachers').update(update).eq('id', teacher.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

// Foto profilo (visibile anche alla scuola)
export async function POST(request: Request) {
  const auth = await requireRole('teacher')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: teacher } = await admin.from('teachers').select('id, photo_url').eq('user_id', auth.user.id).single()
  if (!teacher) return NextResponse.json({ error: 'Teacher record not found' }, { status: 404 })

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `teachers/${teacher.id}-${Date.now()}.${ext}`

  const { error: upErr } = await admin.storage.from('school-assets')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from('school-assets').getPublicUrl(path)
  await admin.from('teachers').update({ photo_url: pub.publicUrl }).eq('id', teacher.id)

  if (teacher.photo_url) {
    const old = teacher.photo_url.split('/school-assets/')[1]
    if (old) await admin.storage.from('school-assets').remove([old]).catch(() => {})
  }

  return NextResponse.json({ image_url: pub.publicUrl })
}

export async function DELETE() {
  const auth = await requireRole('teacher')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: teacher } = await admin.from('teachers').select('id, photo_url').eq('user_id', auth.user.id).single()
  if (!teacher) return NextResponse.json({ error: 'Teacher record not found' }, { status: 404 })

  if (teacher.photo_url) {
    const old = teacher.photo_url.split('/school-assets/')[1]
    if (old) await admin.storage.from('school-assets').remove([old]).catch(() => {})
  }
  await admin.from('teachers').update({ photo_url: null }).eq('id', teacher.id)
  return NextResponse.json({ ok: true })
}
