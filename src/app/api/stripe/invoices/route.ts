import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find all recurring packages to get stripe customers
  const { data: pkgs } = await supabase
    .from('student_packages')
    .select('stripe_customer_id, stripe_subscription_id, school_id')
    .eq('student_id', user.id)
    .not('stripe_customer_id', 'is', null)
    .not('stripe_subscription_id', 'is', null)

  if (!pkgs || pkgs.length === 0) return NextResponse.json([])

  // Deduplicate by school_id+customer_id pairs
  const seen = new Set<string>()
  const pairs = pkgs.filter(p => {
    const key = `${p.school_id}:${p.stripe_customer_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const allInvoices: {
    id: string
    amount_paid: number
    currency: string
    status: string | null
    created: number
    invoice_pdf: string | null
    hosted_invoice_url: string | null
    description: string | null
  }[] = []

  for (const pair of pairs) {
    const { data: school } = await supabase
      .from('schools')
      .select('stripe_account_id')
      .eq('id', pair.school_id)
      .single()

    if (!school?.stripe_account_id) continue

    const invoices = await stripe.invoices.list(
      { customer: pair.stripe_customer_id!, limit: 24 },
      { stripeAccount: school.stripe_account_id }
    ).catch(() => null)

    if (invoices) {
      for (const inv of invoices.data) {
        allInvoices.push({
          id: inv.id,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          status: inv.status,
          created: inv.created,
          invoice_pdf: inv.invoice_pdf ?? null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          description: inv.description ?? null,
        })
      }
    }
  }

  allInvoices.sort((a, b) => b.created - a.created)
  return NextResponse.json(allInvoices)
}
