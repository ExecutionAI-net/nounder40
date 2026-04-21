import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: pkg } = await supabase
    .from('student_packages')
    .select('stripe_customer_id, stripe_subscription_id, school_id')
    .eq('student_id', user.id)
    .not('stripe_subscription_id', 'is', null)
    .order('purchased_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!pkg?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active recurring subscription found' }, { status: 404 })
  }

  let customerId = pkg.stripe_customer_id

  if (!customerId) {
    // Subscription lives on platform account — retrieve without stripeAccount
    const stripeSub = await stripe.subscriptions.retrieve(pkg.stripe_subscription_id).catch(() => null)

    if (!stripeSub) {
      return NextResponse.json({ error: 'Could not retrieve subscription from Stripe' }, { status: 500 })
    }

    customerId = typeof stripeSub.customer === 'string'
      ? stripeSub.customer
      : (stripeSub.customer as Stripe.Customer | null)?.id ?? null

    if (customerId) {
      await supabase
        .from('student_packages')
        .update({ stripe_customer_id: customerId })
        .eq('stripe_subscription_id', pkg.stripe_subscription_id)
    }
  }

  if (!customerId) {
    return NextResponse.json({ error: 'Could not determine Stripe customer' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  try {
    // Portal also on platform account (same account as the subscription)
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/student/buy`,
    })
    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not open billing portal'
    console.error('[stripe/portal] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
