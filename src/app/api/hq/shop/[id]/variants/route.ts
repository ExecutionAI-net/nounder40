import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return null
  return user
}

const key = (size: string | null, color: string | null) => `${size ?? ''}|${color ?? ''}`

// Sostituisce lo stock del prodotto: body { variants: [{ size, color, stock }] }.
// Le combinazioni esistenti conservano il contatore `sold`; quelle assenti vengono rimosse.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: product } = await admin.from('shop_products').select('id').eq('id', id).is('school_id', null).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const body = await request.json()
  const incoming: { size: string | null; color: string | null; stock: number }[] =
    Array.isArray(body?.variants) ? body.variants : []

  const { data: existing } = await admin
    .from('shop_product_variants')
    .select('id, size, color')
    .eq('product_id', id)
  const existingByKey = new Map((existing ?? []).map(v => [key(v.size, v.color), v.id]))
  const incomingKeys = new Set(incoming.map(v => key(v.size ?? null, v.color ?? null)))

  for (const v of incoming) {
    const size = v.size || null
    const color = v.color || null
    const stock = Math.max(0, Math.floor(Number(v.stock) || 0))
    const existingId = existingByKey.get(key(size, color))
    if (existingId) {
      const { error } = await admin.from('shop_product_variants').update({ stock }).eq('id', existingId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await admin.from('shop_product_variants').insert({ product_id: id, size, color, stock })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const toDelete = (existing ?? []).filter(v => !incomingKeys.has(key(v.size, v.color))).map(v => v.id)
  if (toDelete.length > 0) {
    await admin.from('shop_product_variants').delete().in('id', toDelete)
  }

  const { data: variants, error } = await admin
    .from('shop_product_variants')
    .select('id, size, color, stock, sold')
    .eq('product_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variants: variants ?? [] })
}
