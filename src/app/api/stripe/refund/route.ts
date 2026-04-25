import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    revalidateAll()
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: school } = await supabase
    .from('schools')
    .select('id, stripe_account_id')
    .eq('user_id', user.id)
    .single()

  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { transaction_id } = await request.json()
  if (!transaction_id) return NextResponse.json({ error: 'Missing transaction_id' }, { status: 400 })

  const { data: tx } = await supabase
    .from('transactions')
    .select('id, stripe_payment_id, amount, status, school_id')
    .eq('id', transaction_id)
    .eq('school_id', school.id)
    .single()

  if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (tx.status === 'refunded') return NextResponse.json({ error: 'Already refunded' }, { status: 400 })
  if (!tx.stripe_payment_id) return NextResponse.json({ error: 'No Stripe payment to refund' }, { status: 400 })

  await stripe.refunds.create(
    { payment_intent: tx.stripe_payment_id },
    { stripeAccount: school.stripe_account_id }
  )

  await supabase.from('transactions').update({ status: 'refunded' }).eq('id', tx.id)

  revalidateAll()
  return NextResponse.json({ refunded: true })
}
