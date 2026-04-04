import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  const body = await request.text()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    console.error('[webhook] signature verification failed:', message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Use service role client — webhook has no user session, RLS would block all writes
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata ?? {}
      console.log('[webhook] checkout.session.completed meta:', meta)

      if (meta.type === 'package' && meta.package_id && meta.student_id && meta.school_id) {
        const { data: pkg } = await supabase
          .from('packages')
          .select('credits, validity_days')
          .eq('id', meta.package_id)
          .single()

        if (pkg) {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + pkg.validity_days)

          const { error: insertErr } = await supabase.from('student_packages').insert({
            student_id: meta.student_id,
            school_id: meta.school_id,
            package_id: meta.package_id,
            credits_total: pkg.credits,
            credits_remaining: pkg.credits,
            purchased_at: new Date().toISOString(),
            expires_at: expiresAt.toISOString(),
            payment_method: 'stripe',
            stripe_payment_id: session.payment_intent as string ?? '',
            status: 'active',
          })
          if (insertErr) {
            console.error('[webhook] student_packages insert error:', insertErr.message)
          } else {
            console.log('[webhook] credits added:', pkg.credits, 'student:', meta.student_id)
            // Ensure student is enrolled in this school
            await supabase.from('school_students').upsert({
              school_id: meta.school_id,
              student_id: meta.student_id,
            }, { onConflict: 'school_id,student_id', ignoreDuplicates: true })
          }
        } else {
          console.error('[webhook] package not found:', meta.package_id)
        }

        if (meta.transaction_id) {
          await supabase
            .from('transactions')
            .update({ status: 'completed', stripe_payment_id: session.payment_intent as string ?? '' })
            .eq('id', meta.transaction_id)
        }
      }
      break
    }

    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent
      const meta = pi.metadata
      console.log('[webhook] payment_intent.succeeded meta:', meta)

      // Only process if not already handled by checkout.session.completed
      if (meta.type === 'package') {
        if (meta.transaction_id) {
          await supabase
            .from('transactions')
            .update({ status: 'completed', stripe_payment_id: pi.id })
            .eq('id', meta.transaction_id)
            .eq('status', 'pending')
        }

        if (meta.discount_code_id) {
          await supabase.rpc('increment_discount_usage', { code_id: meta.discount_code_id })
        }
      }
      break
    }

    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription
      const meta = sub.metadata
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subAny = sub as unknown as Record<string, any>

      if (meta.type === 'subscription' && meta.subscription_catalog_id) {
        const { data: catalog } = await supabase
          .from('subscriptions_catalog')
          .select('access_count, period_value, period_unit')
          .eq('id', meta.subscription_catalog_id)
          .single()

        if (catalog) {
          // Calculate period end from catalog data (fallback to 1 month)
          const periodEnd = new Date()
          const pv = catalog.period_value ?? 1
          const pu = catalog.period_unit ?? 'months'
          if (pu === 'days') periodEnd.setDate(periodEnd.getDate() + pv)
          else if (pu === 'weeks') periodEnd.setDate(periodEnd.getDate() + pv * 7)
          else if (pu === 'months') periodEnd.setMonth(periodEnd.getMonth() + pv)
          else if (pu === 'years') periodEnd.setFullYear(periodEnd.getFullYear() + pv)
          // Use stripe's period end if available
          if (subAny.current_period_end) {
            periodEnd.setTime(subAny.current_period_end * 1000)
          }

          await supabase.from('student_subscriptions').insert({
            student_id: meta.student_id,
            school_id: meta.school_id,
            subscription_catalog_id: meta.subscription_catalog_id,
            access_total: catalog.access_count,
            access_remaining: catalog.access_count,
            started_at: new Date().toISOString(),
            current_period_end: periodEnd.toISOString(),
            stripe_subscription_id: sub.id,
            status: 'active',
          })
        }

        if (meta.transaction_id) {
          await supabase
            .from('transactions')
            .update({ status: 'completed', stripe_payment_id: sub.id })
            .eq('id', meta.transaction_id)
        }
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subAny2 = sub as unknown as Record<string, any>
      const periodEnd = subAny2.current_period_end
        ? new Date(subAny2.current_period_end * 1000)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      const { data: existing } = await supabase
        .from('student_subscriptions')
        .select('id, subscription_catalog_id')
        .eq('stripe_subscription_id', sub.id)
        .single()

      if (existing) {
        if (sub.status === 'active') {
          // Renewal: reset access counter
          const { data: catalog } = await supabase
            .from('subscriptions_catalog')
            .select('access_count')
            .eq('id', existing.subscription_catalog_id)
            .single()

          await supabase
            .from('student_subscriptions')
            .update({
              current_period_end: periodEnd.toISOString(),
              access_remaining: catalog?.access_count ?? null,
              grace_period_ends_at: null,
              status: 'active',
            })
            .eq('id', existing.id)
        } else if (sub.status === 'past_due') {
          // Payment failed — will be handled by invoice.payment_failed
        }
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription

      await supabase
        .from('student_subscriptions')
        .update({ status: 'cancelled' })
        .eq('stripe_subscription_id', sub.id)
      break
    }

    case 'invoice.payment_failed': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as unknown as Record<string, any>
      const subscriptionId = invoice.subscription as string | undefined

      if (subscriptionId) {
        const { data: studentSub } = await supabase
          .from('student_subscriptions')
          .select('id, school_id')
          .eq('stripe_subscription_id', subscriptionId)
          .single()

        if (studentSub) {
          const { data: school } = await supabase
            .from('schools')
            .select('grace_period_days')
            .eq('id', studentSub.school_id)
            .single()

          const graceDays = school?.grace_period_days ?? 7
          const graceEndsAt = new Date()
          graceEndsAt.setDate(graceEndsAt.getDate() + graceDays)

          await supabase
            .from('student_subscriptions')
            .update({
              status: 'grace_period',
              grace_period_ends_at: graceEndsAt.toISOString(),
            })
            .eq('id', studentSub.id)
        }
      }
      break
    }

    case 'invoice.payment_succeeded': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as unknown as Record<string, any>
      const subscriptionId2 = invoice.subscription as string | undefined

      if (subscriptionId2 && invoice.billing_reason === 'subscription_cycle') {
        await supabase
          .from('student_subscriptions')
          .update({ status: 'active', grace_period_ends_at: null })
          .eq('stripe_subscription_id', subscriptionId2)
      }
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge

      if (charge.payment_intent) {
        await supabase
          .from('transactions')
          .update({ status: 'refunded' })
          .eq('stripe_payment_id', charge.payment_intent as string)
      }
      break
    }

    case 'account.updated': {
      const account = event.data.object as Stripe.Account
      const schoolId = account.metadata?.school_id

      if (schoolId && account.details_submitted && account.charges_enabled) {
        await supabase
          .from('schools')
          .update({ stripe_onboarding_complete: true })
          .eq('id', schoolId)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
