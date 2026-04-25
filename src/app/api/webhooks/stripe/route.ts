import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { sendAfterPurchaseEmail } from '@/lib/email-helpers'
import { STRIPE_META_TYPE } from '@/lib/stripe-metadata'
import { DEFAULT_PLATFORM_FEE_PERCENT } from '@/lib/constants'

// Module-level singleton — avoids re-instantiation on every webhook delivery
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

export async function POST(request: Request) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const meta = session.metadata ?? {}
      console.log('[webhook] checkout.session.completed type:', meta.type, 'pkg:', meta.package_id)

      if (meta.type === STRIPE_META_TYPE.PACKAGE && meta.package_id && meta.student_id && meta.school_id) {
        // One-time package
        const { data: pkg } = await supabase
          .from('packages')
          .select('credits, validity_days')
          .eq('id', meta.package_id)
          .single()

        if (pkg) {
          const expiresAt = new Date()
          expiresAt.setDate(expiresAt.getDate() + pkg.validity_days)

          // Idempotency: skip if this payment_intent was already processed
          const { data: dupCheck } = await supabase
            .from('student_packages')
            .select('id')
            .eq('stripe_payment_id', session.payment_intent as string)
            .maybeSingle()

          if (dupCheck) break

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
            console.log('[webhook] one-time credits added:', pkg.credits, 'student:', meta.student_id)
            // Send purchase confirmation email
            sendAfterPurchaseEmail(meta.student_id, {
              package_name: `Package (${pkg.credits} credits)`,
              amount: session.amount_total ? `€${(session.amount_total / 100).toFixed(2)}` : '',
              credits_remaining: String(pkg.credits),
              package_expiry: expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            })
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
      // recurring_package: store customer_id so portal can use it later
      if (meta.type === STRIPE_META_TYPE.RECURRING_PACKAGE && meta.package_id && meta.student_id && meta.school_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sessionAny = session as unknown as Record<string, any>
        const customerId = sessionAny.customer as string | undefined
        if (customerId) {
          // Store customer_id on any existing recurring student_package for this school
          // (will be set properly when invoice.payment_succeeded fires with subscription_create)
          // We use a temp record so portal route can find the customer
          await supabase.from('student_packages')
            .update({ stripe_customer_id: customerId })
            .eq('student_id', meta.student_id)
            .eq('school_id', meta.school_id)
            .not('stripe_subscription_id', 'is', null)
            .is('stripe_customer_id', null)
        }
      }
      break
    }

    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent
      const meta = pi.metadata
      console.log('[webhook] payment_intent.succeeded type:', meta.type, 'tx:', meta.transaction_id)

      if (meta.type === STRIPE_META_TYPE.PACKAGE) {
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

    case 'invoice.payment_succeeded': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as unknown as Record<string, any>
      const subscriptionId = invoice.subscription as string | undefined
      const billingReason = invoice.billing_reason as string | undefined

      if (!subscriptionId) break

      // Get the Stripe subscription to read its metadata
      const stripeSub = await stripe.subscriptions.retrieve(subscriptionId).catch(() => null)
      if (!stripeSub) break

      const meta = stripeSub.metadata ?? {}
      if (meta.type !== STRIPE_META_TYPE.RECURRING_PACKAGE) break

      const packageId = meta.package_id
      const studentId = meta.student_id
      const schoolId = meta.school_id
      const creditsRollover = meta.credits_rollover === 'true'
      // customer is on the subscription object itself (string or object)
      const stripeCustomerId = typeof stripeSub.customer === 'string'
        ? stripeSub.customer
        : (stripeSub.customer as Stripe.Customer | null)?.id ?? null

      console.log('[webhook] recurring package invoice.payment_succeeded, reason:', billingReason, 'pkg:', packageId)

      // Get package details
      const { data: pkg } = await supabase
        .from('packages')
        .select('credits, validity_days, is_recurring, recurring_interval')
        .eq('id', packageId)
        .single()

      if (!pkg) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subAny = stripeSub as unknown as Record<string, any>

      // For recurring packages: expires_at = Stripe current_period_end (respects actual interval)
      // For one-time fallback: use validity_days
      const periodEnd: Date = subAny.current_period_end
        ? new Date(subAny.current_period_end * 1000)
        : (() => { const d = new Date(); d.setDate(d.getDate() + pkg.validity_days); return d })()

      // next_renewal_at = same as period end (that's when renewal fires)
      const nextRenewalAt = periodEnd.toISOString()

      if (billingReason === 'subscription_create') {
        // Idempotency: skip if this subscription was already provisioned
        const { data: dupSub } = await supabase
          .from('student_packages')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle()

        if (dupSub) break

        // First payment — create the initial student_package row
        const { error: insertErr } = await supabase.from('student_packages').insert({
          student_id: studentId,
          school_id: schoolId,
          package_id: packageId,
          credits_total: pkg.credits,
          credits_remaining: pkg.credits,
          purchased_at: new Date().toISOString(),
          expires_at: nextRenewalAt,
          payment_method: 'stripe',
          stripe_payment_id: invoice.payment_intent as string ?? '',
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: stripeCustomerId,
          next_renewal_at: nextRenewalAt,
          status: 'active',
        })
        if (insertErr) {
          console.error('[webhook] recurring student_packages insert error:', insertErr.message)
        } else {
          await supabase.from('school_students').upsert({
            school_id: schoolId,
            student_id: studentId,
          }, { onConflict: 'school_id,student_id', ignoreDuplicates: true })
          if (meta.transaction_id) {
            await supabase.from('transactions').update({ status: 'completed', stripe_payment_id: invoice.payment_intent as string ?? '' }).eq('id', meta.transaction_id)
          }
        }
      } else if (billingReason === 'subscription_cycle') {
        // Renewal — find the existing active package and refresh credits
        const { data: existingPkg } = await supabase
          .from('student_packages')
          .select('id, credits_remaining')
          .eq('stripe_subscription_id', subscriptionId)
          .eq('status', 'active')
          .maybeSingle()

        if (existingPkg) {
          const newCredits = creditsRollover
            ? existingPkg.credits_remaining + pkg.credits
            : pkg.credits

          // expires_at advances by one interval (= new period end from Stripe)
          await supabase.from('student_packages').update({
            credits_total: newCredits,
            credits_remaining: newCredits,
            expires_at: nextRenewalAt,
            next_renewal_at: nextRenewalAt,
            status: 'active',
          }).eq('id', existingPkg.id)

          // Record renewal transaction
          const { data: pkgFull } = await supabase.from('packages').select('price, name_en, school_id').eq('id', packageId).single()
          if (pkgFull) {
            const { data: schoolData } = await supabase.from('schools').select('platform_fee_percentage').eq('id', schoolId).single()
            const feePercent = schoolData?.platform_fee_percentage ?? DEFAULT_PLATFORM_FEE_PERCENT
            const platformFee = Math.round((pkgFull.price * feePercent) / 100)
            await supabase.from('transactions').insert({
              school_id: schoolId,
              student_id: studentId,
              type: 'package',
              product_id: packageId,
              product_name: pkgFull.name_en,
              amount: pkgFull.price,
              currency: 'eur',
              platform_fee: platformFee,
              school_amount: pkgFull.price - platformFee,
              payment_method: 'stripe',
              stripe_payment_id: invoice.payment_intent as string ?? '',
              status: 'completed',
            })
          }
        }
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const meta = sub.metadata ?? {}
      if (meta.type === STRIPE_META_TYPE.RECURRING_PACKAGE) {
        // Find the active student_package
        const { data: studentPkg } = await supabase
          .from('student_packages')
          .select('id, credits_remaining, credits_total, student_id, school_id, package_id')
          .eq('stripe_subscription_id', sub.id)
          .maybeSingle()

        if (studentPkg) {
          // Cancel: zero out credits and set expires_at to now
          await supabase
            .from('student_packages')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              credits_remaining: 0,
              expires_at: new Date().toISOString(),
              next_renewal_at: null,
            })
            .eq('id', studentPkg.id)

          // Record cancellation in transactions
          const { data: pkgData } = await supabase
            .from('packages')
            .select('name_en, price, school_id')
            .eq('id', studentPkg.package_id)
            .single()

          if (pkgData) {
            const { data: schoolData } = await supabase
              .from('schools')
              .select('platform_fee_percentage')
              .eq('id', studentPkg.school_id)
              .single()
            const feePercent = schoolData?.platform_fee_percentage ?? DEFAULT_PLATFORM_FEE_PERCENT
            await supabase.from('transactions').insert({
              school_id: studentPkg.school_id,
              student_id: studentPkg.student_id,
              type: 'package',
              product_id: studentPkg.package_id,
              product_name: `${pkgData.name_en} (cancelled)`,
              amount: 0,
              currency: 'eur',
              platform_fee: 0,
              school_amount: 0,
              payment_method: 'stripe',
              stripe_payment_id: sub.id,
              status: 'refunded',
            })
          }

          console.log('[webhook] recurring package cancelled, credits zeroed:', studentPkg.id)
        }
      }
      break
    }

    case 'invoice.payment_failed': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as unknown as Record<string, any>
      const subscriptionId = invoice.subscription as string | undefined

      if (subscriptionId) {
        const { data: studentPkg } = await supabase
          .from('student_packages')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle()

        if (studentPkg) {
          await supabase
            .from('student_packages')
            .update({ status: 'past_due' })
            .eq('id', studentPkg.id)
          console.log('[webhook] recurring package marked past_due:', studentPkg.id)
        }
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
