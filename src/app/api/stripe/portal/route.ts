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

  // Find the student's most recent recurring package to get stripe_customer_id + school stripe account
  const { data: pkg } = await supabase
    .from('student_packages')
    .select('stripe_customer_id, school_id')
    .eq('student_id', user.id)
    .not('stripe_customer_id', 'is', null)
    .not('stripe_subscription_id', 'is', null)
    .order('purchased_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!pkg?.stripe_customer_id) {
    return NextResponse.json({ error: 'No active recurring subscription found' }, { status: 404 })
  }

  const { data: school } = await supabase
    .from('schools')
    .select('stripe_account_id')
    .eq('id', pkg.school_id)
    .single()

  if (!school?.stripe_account_id) {
    return NextResponse.json({ error: 'School payment account not configured' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const session = await stripe.billingPortal.sessions.create(
    { customer: pkg.stripe_customer_id, return_url: `${appUrl}/student/buy` },
    { stripeAccount: school.stripe_account_id }
  )

  return NextResponse.json({ url: session.url })
}
