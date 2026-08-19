import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_SIZE = 4 * 1024 * 1024 // 4MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGES = 6

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return null
  return user
}

// Aggiunge un'immagine alla galleria del prodotto (max 6)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: product } = await admin.from('shop_products').select('id, images').eq('id', id).is('school_id', null).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const images: string[] = product.images ?? []
  if (images.length >= MAX_IMAGES) return NextResponse.json({ error: 'max_images' }, { status: 400 })

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: 'invalid_type' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: 'too_large' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `shop/${id}-${Date.now()}.${ext}`

  const { error: upErr } = await admin.storage.from('school-assets')
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = admin.storage.from('school-assets').getPublicUrl(path)
  const updated = [...images, pub.publicUrl]
  const { error } = await admin.from('shop_products').update({ images: updated }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ images: updated })
}

// Rimuove un'immagine dalla galleria: body { url }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: product } = await admin.from('shop_products').select('id, images').eq('id', id).is('school_id', null).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const { url } = await request.json()
  const images: string[] = (product.images ?? []).filter((u: string) => u !== url)

  const { error } = await admin.from('shop_products').update({ images }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // best-effort: rimuovi il file dallo storage
  const path = typeof url === 'string' ? url.split('/school-assets/')[1] : null
  if (path) await admin.storage.from('school-assets').remove([path]).catch(() => {})

  return NextResponse.json({ images })
}
