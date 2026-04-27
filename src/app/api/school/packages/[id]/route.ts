import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

function intervalToStripe(interval: string): { interval: Stripe.PriceCreateParams.Recurring.Interval; interval_count: number } {
  switch (interval) {
    case 'week': return { interval: 'week', interval_count: 1 }
    case '3month': return { interval: 'month', interval_count: 3 }
    case 'year': return { interval: 'year', interval_count: 1 }
    default: return { interval: 'month', interval_count: 1 }
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  // If price or recurring settings changed, create a new Stripe price
  const priceChanged = body.price !== undefined || body.is_recurring !== undefined || body.recurring_interval !== undefined

  if (priceChanged && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

      const { data: school } = await supabase
        .from('schools')
        .select('stripe_account_id')
        .eq('id', profile.school_id)
        .single()

      const { data: existingPkg } = await supabase
        .from('packages')
        .select('stripe_product_id, stripe_price_id, price, is_recurring, recurring_interval')
        .eq('id', id)
        .single()

      if (school?.stripe_account_id && existingPkg?.stripe_product_id) {
        // Archive old price if exists
        if (existingPkg.stripe_price_id) {
          await stripe.prices.update(
            existingPkg.stripe_price_id,
            { active: false },
            { stripeAccount: school.stripe_account_id }
          ).catch(() => {})
        }

        const finalPrice = body.price ?? existingPkg.price
        const isRecurring = body.is_recurring ?? existingPkg.is_recurring
        const recurringInterval = body.recurring_interval ?? existingPkg.recurring_interval ?? 'month'

        const priceParams: Stripe.PriceCreateParams = {
          product: existingPkg.stripe_product_id,
          unit_amount: Math.round(Number(finalPrice) * 100),
          currency: 'eur',
        }

        if (isRecurring) {
          const { interval, interval_count } = intervalToStripe(recurringInterval)
          priceParams.recurring = { interval, interval_count }
        }

        const newPrice = await stripe.prices.create(priceParams, { stripeAccount: school.stripe_account_id })
        body.stripe_price_id = newPrice.id
      }
    } catch (err) {
      console.error('[packages PATCH] Stripe error:', err)
    }
  }

  const { data, error } = await supabase
    .from('packages')
    .update(body)
    .eq('id', id)
    .eq('school_id', profile.school_id)
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabase
    .from('packages')
    .update({ active: false })
    .eq('id', id)
    .eq('school_id', profile.school_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
