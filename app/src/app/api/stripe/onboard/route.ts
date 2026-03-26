import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: school } = await supabase
    .from('schools')
    .select('id, name, stripe_account_id')
    .eq('user_id', user.id)
    .single()

  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let accountId = school.stripe_account_id

  // Create Express account if not yet created
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { school_id: school.id, school_name: school.name },
    })
    accountId = account.id
    await supabase.from('schools').update({ stripe_account_id: accountId }).eq('id', school.id)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl}/school/payments?onboard=refresh`,
    return_url: `${appUrl}/school/payments?onboard=success`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: accountLink.url })
}
