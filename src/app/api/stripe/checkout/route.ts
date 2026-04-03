import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, product_id, discount_code } = await request.json()

  if (!type || !product_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Get student record — auto-create if missing (e.g. multi-role or legacy user)
  let { data: student } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!student) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: profile } = await admin.from('profiles').select('name, email').eq('id', user.id).single()
    const { data: created } = await admin.from('students').insert({
      user_id: user.id,
      name: profile?.name ?? '',
      email: profile?.email ?? user.email ?? '',
    }).select('id').single()
    student = created
  }

  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

  // Get student's school from students.school_id
  const { data: studentWithSchool } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', student.id)
    .single()

  if (!studentWithSchool?.school_id) {
    console.error('[stripe/checkout] no school_id on student:', student.id)
    return NextResponse.json({ error: 'You are not enrolled in any school' }, { status: 400 })
  }

  const school_id = studentWithSchool.school_id

  // Get school Stripe account
  const { data: school } = await supabase
    .from('schools')
    .select('id, name, stripe_account_id, platform_fee_percentage')
    .eq('id', school_id)
    .single()

  if (!school?.stripe_account_id) {
    return NextResponse.json({ error: 'School payment account is not set up yet' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const feePercent = school.platform_fee_percentage ?? 10

  if (type === 'package') {
    const { data: pkg } = await supabase
      .from('packages')
      .select('id, name_en, price, credits, validity_days')
      .eq('id', product_id)
      .eq('active', true)
      .single()

    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

    // Validate discount code if provided
    let discountAmount = 0
    let discountCodeId: string | null = null
    if (discount_code) {
      const { data: code } = await supabase
        .from('discount_codes')
        .select('id, type, value, minimum_order, valid_for, expires_at, active')
        .eq('school_id', school_id)
        .eq('code', discount_code.toUpperCase())
        .single()

      if (code && code.active && (!code.expires_at || new Date(code.expires_at) > new Date())) {
        if (code.valid_for === 'all' || code.valid_for === 'packages') {
          if (!code.minimum_order || pkg.price >= code.minimum_order) {
            discountCodeId = code.id
            discountAmount = code.type === 'percentage'
              ? Math.round((pkg.price * code.value) / 100)
              : code.value
          }
        }
      }
    }

    const finalPrice = Math.max(0, pkg.price - discountAmount)
    const platformFee = Math.round((finalPrice * feePercent) / 100)

    // Create pending transaction
    const { data: tx } = await supabase.from('transactions').insert({
      school_id,
      student_id: student.id,
      type: 'package',
      product_id: pkg.id,
      product_name: pkg.name_en,
      amount: finalPrice,
      currency: 'eur',
      platform_fee: platformFee,
      school_amount: finalPrice - platformFee,
      payment_method: 'stripe',
      status: 'pending',
    }).select('id').single()

    let session
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: pkg.name_en },
            unit_amount: Math.round(finalPrice * 100),
          },
          quantity: 1,
        }],
        payment_intent_data: {
          application_fee_amount: Math.round(platformFee * 100),
          transfer_data: { destination: school.stripe_account_id },
          metadata: {
            type: 'package',
            package_id: pkg.id,
            school_id,
            student_id: student.id,
            transaction_id: tx?.id ?? '',
            discount_code_id: discountCodeId ?? '',
            credits: pkg.credits,
            validity_days: pkg.validity_days,
          },
        },
        success_url: `${appUrl}/student/packages?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/student/buy?payment=cancelled`,
        metadata: {
          type: 'package',
          package_id: pkg.id,
          school_id,
          student_id: student.id,
          transaction_id: tx?.id ?? '',
        },
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Stripe session creation failed'
      console.error('[stripe/checkout] session create error (package):', message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })

  } else if (type === 'subscription') {
    const { data: sub } = await supabase
      .from('subscriptions_catalog')
      .select('id, name_en, price, stripe_price_id')
      .eq('id', product_id)
      .single()

    if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })

    const platformFee = Math.round((sub.price * feePercent) / 100)

    const { data: tx } = await supabase.from('transactions').insert({
      school_id,
      student_id: student.id,
      type: 'subscription',
      product_id: sub.id,
      product_name: sub.name_en,
      amount: sub.price,
      currency: 'eur',
      platform_fee: platformFee,
      school_amount: sub.price - platformFee,
      payment_method: 'stripe',
      status: 'pending',
    }).select('id').single()

    let session
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: { name: sub.name_en },
            unit_amount: Math.round(sub.price * 100),
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],
        subscription_data: {
          application_fee_percent: feePercent,
          transfer_data: { destination: school.stripe_account_id },
          metadata: {
            type: 'subscription',
            subscription_catalog_id: sub.id,
            school_id,
            student_id: student.id,
            transaction_id: tx?.id ?? '',
          },
        },
        success_url: `${appUrl}/student/packages?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/student/buy?payment=cancelled`,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Stripe session creation failed'
      console.error('[stripe/checkout] session create error (subscription):', message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ url: session.url })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}
