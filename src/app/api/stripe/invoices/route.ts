import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: pkgs } = await supabase
    .from('student_packages')
    .select('stripe_subscription_id')
    .eq('student_id', user.id)
    .not('stripe_subscription_id', 'is', null)

  if (!pkgs || pkgs.length === 0) return NextResponse.json({ invoices: [], subscriptions: [] })

  const allInvoices: {
    id: string
    amount_paid: number
    currency: string
    status: string | null
    created: number
    invoice_pdf: string | null
  }[] = []

  const subscriptionDetails: {
    subscription_id: string
    next_payment_at: number | null
    next_payment_amount: number | null
    cancel_at: number | null          // scheduled cancellation date (cancel_at_period_end)
    cancelled_at: number | null       // already cancelled at this timestamp
    currency: string
    status: string
  }[] = []

  const seen = new Set<string>()

  for (const pkg of pkgs) {
    if (!pkg.stripe_subscription_id || seen.has(pkg.stripe_subscription_id)) continue
    seen.add(pkg.stripe_subscription_id)

    const stripeSub = await stripe.subscriptions.retrieve(pkg.stripe_subscription_id).catch(() => null)
    if (!stripeSub) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAny = stripeSub as unknown as Record<string, any>

    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : null

    subscriptionDetails.push({
      subscription_id: stripeSub.id,
      // If cancel_at_period_end, next charge won't happen — show period end as cancellation date instead
      next_payment_at: stripeSub.cancel_at_period_end ? null : (subAny.current_period_end ?? null),
      next_payment_amount: stripeSub.cancel_at_period_end ? null : (stripeSub.items?.data?.[0]?.price?.unit_amount ?? null),
      cancel_at: stripeSub.cancel_at_period_end ? (subAny.current_period_end ?? null) : (subAny.cancel_at ?? null),
      cancelled_at: subAny.canceled_at ?? null,
      currency: stripeSub.items?.data?.[0]?.price?.currency ?? 'eur',
      status: stripeSub.status,
    })

    if (customerId) {
      const invoices = await stripe.invoices.list({ customer: customerId, limit: 12 }).catch(() => null)
      if (invoices) {
        for (const inv of invoices.data) {
          allInvoices.push({
            id: inv.id,
            amount_paid: inv.amount_paid,
            currency: inv.currency,
            status: inv.status,
            created: inv.created,
            invoice_pdf: inv.invoice_pdf ?? null,
          })
        }
      }
    }
  }

  allInvoices.sort((a, b) => b.created - a.created)
  const uniqueInvoices = allInvoices.filter((inv, idx, arr) => arr.findIndex(i => i.id === inv.id) === idx)

  return NextResponse.json({ invoices: uniqueInvoices, subscriptions: subscriptionDetails })
}
