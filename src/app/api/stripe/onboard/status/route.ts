import { NextResponse } from 'next/server'
import Stripe from 'stripe' // lazy init inside handler
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: school } = await supabase
    .from('schools')
    .select('id, stripe_account_id, stripe_onboarding_complete')
    .eq('id', profile.school_id)
    .single()

  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!school.stripe_account_id) {
    return NextResponse.json({ connected: false, onboarding_complete: false })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({
      connected: !!school.stripe_account_id,
      onboarding_complete: school.stripe_onboarding_complete ?? false,
      account_id: school.stripe_account_id,
    })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
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
