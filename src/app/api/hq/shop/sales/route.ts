import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const PAYMENT_METHODS = ['bonifico', 'carta', 'contante', 'cambio', 'regalo']

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return null
  return user
}

// Registro vendite (più recenti prima)
export async function GET() {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await createAdminClient()
    .from('shop_sales')
    .select('id, qty, unit_price, total, commission, shipping, source, order_id, payment_method, discount, referrer, referrer_percentage, referrer_commission, size, color, notes, created_at, product_id, student_id, school_id, shop_products(name), students(name), schools(name)')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Vendita manuale multi-riga (come il carrello studente):
// body { student_id?, payment_method, discount?, referrer?, referrer_percentage?,
//        items: [{ product_id, variant_id, qty }] }
// Scala lo stock (mai sotto zero), incrementa il venduto, ripartisce lo sconto
// proporzionalmente sulle righe e calcola commissione scuola + referente sul netto.
export async function POST(request: Request) {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const body = await request.json()
  const { student_id, notes } = body
  const payment_method = PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : 'contante'
  const referrer: string | null = typeof body.referrer === 'string' && body.referrer.trim() ? body.referrer.trim() : null
  const referrerPct = referrer ? Math.min(100, Math.max(0, Number(body.referrer_percentage) || 0)) : 0
  const requestedDiscount = Math.max(0, Number(body.discount) || 0)
  const items: { product_id: string; variant_id: string; qty: number }[] =
    Array.isArray(body.items) ? body.items : []
  if (items.length === 0) return NextResponse.json({ error: 'items are required' }, { status: 400 })

  // Commissione scuola: se lo studente è legato a una scuola, si applica la
  // sua % negozio (incentivo vendite)
  let schoolId: string | null = null
  let commissionPct = 0
  if (student_id) {
    const { data: student } = await admin.from('students').select('school_id').eq('id', student_id).maybeSingle()
    if (student?.school_id) {
      const { data: school } = await admin
        .from('schools')
        .select('id, shop_commission_percentage')
        .eq('id', student.school_id)
        .maybeSingle()
      if (school) {
        schoolId = school.id
        commissionPct = Number(school.shop_commission_percentage) || 0
      }
    }
  }

  const orderId = randomUUID()

  // Prima passata: valida righe, scala stock, raccoglie i lordi
  const lines: { product_id: string; variant_id: string; size: string | null; color: string | null; qty: number; unit_price: number; gross: number }[] = []
  for (const item of items) {
    const qty = Math.floor(Number(item.qty) || 0)
    if (!item.product_id || !item.variant_id || qty < 1) {
      return NextResponse.json({ error: 'invalid_item' }, { status: 400 })
    }

    const [{ data: product }, { data: variant }] = await Promise.all([
      admin.from('shop_products').select('id, price').eq('id', item.product_id).is('school_id', null).single(),
      admin.from('shop_product_variants').select('id, product_id, size, color, stock, sold').eq('id', item.variant_id).single(),
    ])
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (!variant || variant.product_id !== item.product_id) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 })
    }

    // La vendita fisica vince sullo stock configurato: mai sotto zero
    const { error: stockErr } = await admin
      .from('shop_product_variants')
      .update({ stock: Math.max(0, variant.stock - qty), sold: variant.sold + qty })
      .eq('id', variant.id)
    if (stockErr) return NextResponse.json({ error: stockErr.message }, { status: 500 })

    const unit_price = Number(product.price)
    lines.push({
      product_id: product.id,
      variant_id: variant.id,
      size: variant.size,
      color: variant.color,
      qty,
      unit_price,
      gross: Math.round(unit_price * qty * 100) / 100,
    })
  }

  // Sconto ordine ripartito proporzionalmente (l'ultima riga assorbe gli arrotondamenti);
  // commissione scuola e referente calcolate sul netto
  const subtotal = Math.round(lines.reduce((s, l) => s + l.gross, 0) * 100) / 100
  const discount = Math.min(requestedDiscount, subtotal)
  let discountLeft = discount
  const saleRows = lines.map((l, i) => {
    const share = i === lines.length - 1
      ? Math.round(discountLeft * 100) / 100
      : Math.round((subtotal > 0 ? discount * (l.gross / subtotal) : 0) * 100) / 100
    discountLeft = Math.round((discountLeft - share) * 100) / 100
    const net = Math.round((l.gross - share) * 100) / 100
    return {
      order_id: orderId,
      product_id: l.product_id,
      variant_id: l.variant_id,
      student_id: student_id || null,
      school_id: schoolId,
      qty: l.qty,
      unit_price: l.unit_price,
      discount: share,
      total: net,
      commission: Math.round(net * commissionPct) / 100,
      referrer,
      referrer_percentage: referrerPct,
      referrer_commission: Math.round(net * referrerPct) / 100,
      size: l.size,
      color: l.color,
      payment_method,
      source: 'manual',
      notes: notes || null,
    }
  })

  const { data: sales, error } = await admin.from('shop_sales').insert(saleRows).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = saleRows.reduce((s, r) => s + Number(r.total), 0)
  return NextResponse.json({ order_id: orderId, sales, total: Math.round(total * 100) / 100 })
}
