import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { session_id } = await request.json()
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(session_id)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Stripe error'
    console.error('[verify-session] retrieve error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  console.log('[verify-session] payment_status:', session.payment_status, 'payment_intent:', session.payment_intent)

  if (session.payment_status !== 'paid') {
    console.log('[verify-session] not paid yet:', session.payment_status)
    return NextResponse.json({ status: 'pending' })
  }

  const meta = session.metadata ?? {}
  console.log('[verify-session] session paid, meta:', JSON.stringify(meta))

  if (meta.type === 'package' && meta.package_id && meta.student_id && meta.school_id) {
    const paymentIntentId = session.payment_intent as string | null

    // Idempotency: check if already added for this session
    const { data: existing, error: existingErr } = await admin
      .from('student_packages')
      .select('id')
      .eq('stripe_payment_id', paymentIntentId ?? session.id)
      .maybeSingle()

    console.log('[verify-session] idempotency check - existing:', existing?.id ?? 'none', 'err:', existingErr?.message ?? 'none')

    if (existing) {
      console.log('[verify-session] credits already added, skipping')
      return NextResponse.json({ status: 'already_processed' })
    }

    const { data: pkg, error: pkgErr } = await admin
      .from('packages')
      .select('credits, validity_days')
      .eq('id', meta.package_id)
      .single()

    console.log('[verify-session] package lookup - credits:', pkg?.credits ?? 'NOT FOUND', 'err:', pkgErr?.message ?? 'none')

    if (!pkg) {
      console.error('[verify-session] package not found:', meta.package_id)
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + pkg.validity_days)

    const insertPayload = {
      student_id: meta.student_id,
      school_id: meta.school_id,
      package_id: meta.package_id,
      credits_total: pkg.credits,
      credits_remaining: pkg.credits,
      purchased_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      payment_method: 'stripe',
      stripe_payment_id: paymentIntentId ?? session.id,
      status: 'active',
    }
    console.log('[verify-session] inserting student_packages:', JSON.stringify(insertPayload))

    const { error: insertErr } = await admin.from('student_packages').insert(insertPayload)

    if (insertErr) {
      console.error('[verify-session] student_packages insert error:', insertErr.message, insertErr.code, insertErr.details)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    console.log('[verify-session] credits added:', pkg.credits, 'student:', meta.student_id)

    if (meta.transaction_id) {
      await admin
        .from('transactions')
        .update({ status: 'completed', stripe_payment_id: session.payment_intent as string })
        .eq('id', meta.transaction_id)
    }

    return NextResponse.json({ status: 'activated', credits: pkg.credits })
  }

  return NextResponse.json({ status: 'no_action' })
}
