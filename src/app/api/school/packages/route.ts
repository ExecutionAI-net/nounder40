import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'
import { BRAND_COLOR } from '@/lib/constants'
import { revalidateAll } from '@/lib/revalidate'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

function intervalToStripe(interval: string): { interval: Stripe.PriceCreateParams.Recurring.Interval; interval_count: number } {
  switch (interval) {
    case 'week': return { interval: 'week', interval_count: 1 }
    case '3month': return { interval: 'month', interval_count: 3 }
    case 'year': return { interval: 'year', interval_count: 1 }
    default: return { interval: 'month', interval_count: 1 }
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('packages')
    .select('*, lesson_types(name_en)')
    .eq('school_id', profile.school_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    name_en, name_it, description_en, credits, validity_days, price,
    lesson_type_restriction, color, is_popular,
    is_recurring, recurring_interval, credits_rollover,
  } = body

  if (!name_en || !credits || !validity_days || price === undefined) {
    revalidateAll()
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Create Stripe product + price if Stripe is configured
  let stripeProductId: string | null = null
  let stripePriceId: string | null = null

  if (stripe) {
    try {
      // Get school's Stripe account
      const { data: school } = await supabase
        .from('schools')
        .select('stripe_account_id, stripe_onboarding_complete')
        .eq('id', profile.school_id)
        .single()

      if (school?.stripe_account_id && school.stripe_onboarding_complete) {
        const product = await stripe.products.create(
          { name: name_en, description: description_en || undefined },
          { stripeAccount: school.stripe_account_id }
        )
        stripeProductId = product.id

        const priceParams: Stripe.PriceCreateParams = {
          product: product.id,
          unit_amount: Math.round(Number(price) * 100),
          currency: 'eur',
        }

        if (is_recurring) {
          const { interval, interval_count } = intervalToStripe(recurring_interval ?? 'month')
          priceParams.recurring = { interval, interval_count }
        }

        const stripePrice = await stripe.prices.create(priceParams, { stripeAccount: school.stripe_account_id })
        stripePriceId = stripePrice.id
      }
    } catch (err) {
      console.error('[packages POST] Stripe error:', err)
      // Non-fatal — proceed without Stripe IDs
    }
  }

  const { data, error } = await supabase.from('packages').insert({
    school_id: profile.school_id,
    name_en, name_it: name_it || null,
    description_en: description_en || null,
    credits: Number(credits),
    validity_days: Number(validity_days),
    price: Number(price),
    lesson_type_restriction: lesson_type_restriction || null,
    color: color || BRAND_COLOR,
    is_popular: is_popular || false,
    is_recurring: is_recurring || false,
    recurring_interval: is_recurring ? (recurring_interval || 'month') : null,
    credits_rollover: credits_rollover || false,
    stripe_product_id: stripeProductId,
    stripe_price_id: stripePriceId,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data)
}
