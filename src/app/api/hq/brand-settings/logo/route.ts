import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND_DEFAULTS, BRAND_KEYS } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024 // 4MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export async function POST(request: Request) {
  if (!await requireRole('hq')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  const admin = createAdminClient()
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `brand/logo-${Date.now()}.${ext}`

  const { error: upErr } = await admin.storage.from('school-assets')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from('school-assets').getPublicUrl(path)
  const { error } = await admin.from('platform_settings')
    .upsert({ key: BRAND_KEYS.logoUrl, value: pub.publicUrl, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ image_url: pub.publicUrl })
}

// Ripristina il logo di default (il file caricato viene rimosso best-effort)
export async function DELETE() {
  if (!await requireRole('hq')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: current } = await admin.from('platform_settings')
    .select('value').eq('key', BRAND_KEYS.logoUrl).maybeSingle()

  const { error } = await admin.from('platform_settings')
    .upsert({ key: BRAND_KEYS.logoUrl, value: BRAND_DEFAULTS.logoUrl, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const path = current?.value?.split('/school-assets/')[1]
  if (path) await admin.storage.from('school-assets').remove([path])

  return NextResponse.json({ image_url: BRAND_DEFAULTS.logoUrl })
}
