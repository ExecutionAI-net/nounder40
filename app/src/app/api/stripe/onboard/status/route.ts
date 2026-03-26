import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: school } = await supabase
    .from('schools')
    .select('id, stripe_account_id, stripe_onboarding_complete')
    .eq('user_id', user.id)
    .single()

  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!school.stripe_account_id) {
    return NextResponse.json({ connected: false, onboarding_complete: false })
  }

  // Check with Stripe if onboarding is complete
  const account = await stripe.accounts.retrieve(school.stripe_account_id)
  const complete = account.details_submitted && account.charges_enabled

  if (complete && !school.stripe_onboarding_complete) {
    await supabase
      .from('schools')
      .update({ stripe_onboarding_complete: true })
      .eq('id', school.id)
  }

  return NextResponse.json({
    connected: !!school.stripe_account_id,
    onboarding_complete: complete,
    account_id: school.stripe_account_id,
  })
}
