import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { STRIPE_META_TYPE } from '@/lib/stripe-metadata'

export const dynamic = 'force-dynamic'

type CheckoutItem = {
  product_id: string
  size: string | null
  color: string | null
  qty: number
}

// Checkout del negozio: vendita diretta HQ via Stripe (account master, nessun
// Connect scuola). Basta essere registrati. La scuola dello studente — se
// presente — matura la commissione, calcolata dal webhook a pagamento avvenuto.
// Regola spedizione: una sola per ordine, il costo più alto tra i prodotti.
export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Profilo studente (auto-creato se manca, come nel checkout pacchetti)
  let { data: student } = await admin
    .from('students')
    .select('id, school_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!student) {
    const { data: profile } = await admin.from('profiles').select('name, email').eq('id', user.id).single()
    const { data: created } = await admin.from('students').insert({
      user_id: user.id,
      name: profile?.name ?? '',
      email: profile?.email ?? user.email ?? '',
    }).select('id, school_id').single()
    student = created
  }
  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  const body = await request.json()
  const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : []
  if (items.length === 0) return NextResponse.json({ error: 'items are required' }, { status: 400 })

  // Valida i prodotti e costruisci le righe ordine
  const orderLines: {
    product_id: string
    variant_id: string | null
    name: string
    size: string | null
    color: string | null
    qty: number
    unit_price: number
  }[] = []
  let shipping = 0

  for (const item of items) {
    const qty = Math.floor(Number(item.qty) || 0)
    if (!item.product_id || qty < 1) return NextResponse.json({ error: 'invalid_item' }, { status: 400 })

    const { data: product } = await admin
      .from('shop_products')
      .select('id, name, price, shipping_cost, active, shop_product_variants(id, size, color, stock)')
      .eq('id', item.product_id)
      .single()
    if (!product || !product.active) return NextResponse.json({ error: 'product_not_found' }, { status: 404 })

    shipping = Math.max(shipping, Number(product.shipping_cost) || 0)

    // Con stock a varianti: la combinazione deve esistere e avere disponibilità
    const variants = product.shop_product_variants ?? []
    let variantId: string | null = null
    if (variants.length > 0) {
      const variant = variants.find(v => (v.size ?? null) === (item.size || null) && (v.color ?? null) === (item.color || null))
      if (!variant || variant.stock < qty) {
        return NextResponse.json({ error: 'no_stock', product: product.name }, { status: 400 })
      }
      variantId = variant.id
    }

    orderLines.push({
      product_id: product.id,
      variant_id: variantId,
      name: product.name,
      size: item.size || null,
      color: item.color || null,
      qty,
      unit_price: Number(product.price),
    })
  }

  const subtotal = Math.round(orderLines.reduce((s, l) => s + l.unit_price * l.qty, 0) * 100) / 100
  const total = Math.round((subtotal + shipping) * 100) / 100

  // Ordine in stato pending: il webhook lo finalizza a pagamento avvenuto
  const { data: order, error: orderErr } = await admin
    .from('shop_orders')
    .insert({
      student_id: user.id, // FK → auth.users
      school_id: student.school_id ?? null,
      items: orderLines,
      subtotal,
      shipping,
      total,
      status: 'pending',
    })
    .select('id')
    .single()
  if (orderErr || !order) return NextResponse.json({ error: orderErr?.message ?? 'order_failed' }, { status: 500 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = orderLines.map(l => ({
    price_data: {
      currency: 'eur',
      product_data: {
        name: l.name + (l.size || l.color ? ` (${[l.size, l.color].filter(Boolean).join(' · ')})` : ''),
      },
      unit_amount: Math.round(l.unit_price * 100),
    },
    quantity: l.qty,
  }))
  if (shipping > 0) {
    line_items.push({
      price_data: {
        currency: 'eur',
        product_data: { name: 'Spedizione' },
        unit_amount: Math.round(shipping * 100),
      },
      quantity: 1,
    })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      customer_email: user.email ?? undefined,
      success_url: `${appUrl}/student/shop?payment=success`,
      cancel_url: `${appUrl}/student/shop?payment=cancelled`,
      metadata: {
        type: STRIPE_META_TYPE.SHOP,
        shop_order_id: order.id,
        student_db_id: student.id,
      },
    })
    await admin.from('shop_orders').update({ stripe_payment_id: session.id }).eq('id', order.id)
    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    // Ordine orfano: il checkout non è partito
    await admin.from('shop_orders').delete().eq('id', order.id)
    const message = err instanceof Error ? err.message : 'stripe_error'
    console.error('[shop/checkout] session create error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
