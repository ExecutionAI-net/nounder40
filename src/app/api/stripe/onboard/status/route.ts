import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

  // If DB already says complete, trust it — skip the live Stripe poll.
  // Stripe v2 Connect can return charges_enabled=false on accounts that are
  // visibly "Enabled" in the dashboard.
  if (school.stripe_onboarding_complete) {
    return NextResponse.json({
      connected: true,
      onboarding_complete: true,
      account_id: school.stripe_account_id,
    })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  let complete = false
  try {
    const account = await stripe.accounts.retrieve(school.stripe_account_id)
    complete = !!(account.details_submitted && account.charges_enabled)
  } catch (err) {
    console.error('[stripe/onboard/status] retrieve failed:', err)
  }

  if (complete) {
    // schools UPDATE is restricted to HQ via RLS — use admin client so the
    // flag actually flips after a successful Stripe onboarding.
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    await admin
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
