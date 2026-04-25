import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VALID_REASONS = ['gift', 'refund', 'correction', 'compensation', 'other']

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id, name')
      .eq('id', user.id)
      .single()

    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const schoolId = profile.school_id
    const body = await request.json()
    const { student_id, amount, reason, note, expires_at, package_catalog_id, price, payment_method } = body

    if (!student_id || !amount || !reason) {
      return NextResponse.json({ error: 'student_id, amount and reason are required' }, { status: 400 })
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(String(student_id))) {
      return NextResponse.json({ error: 'Invalid student_id' }, { status: 400 })
    }

    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }

    if (Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
    }

    // Verify student belongs to this school
    const { data: schoolStudent } = await supabase
      .from('school_students')
      .select('id')
      .eq('school_id', schoolId)
      .eq('student_id', student_id)
      .maybeSingle()

    if (!schoolStudent) {
      console.warn(`[credits/grant] school_students lookup failed for student_id=${student_id}, school_id=${schoolId}`)
      return NextResponse.json({ error: 'Student not found in this school' }, { status: 404 })
    }

    let packageId: string | null = null
    let catalogPkgName: string | null = null

    if (package_catalog_id) {
      // Assign a specific package catalog item — always create a new student_packages row
      const { data: catalogPkg, error: catalogErr } = await supabase
        .from('packages')
        .select('id, credits, validity_days, name_en')
        .eq('id', package_catalog_id)
        .eq('school_id', schoolId)
        .eq('active', true)
        .single()

      if (catalogErr || !catalogPkg) {
        console.error('[credits/grant POST] package catalog lookup error', catalogErr)
        return NextResponse.json({ error: 'Package not found or inactive' }, { status: 404 })
      }

      const creditsToGrant = Number(amount) || catalogPkg.credits
      const expiresAt = catalogPkg.validity_days
        ? new Date(Date.now() + catalogPkg.validity_days * 86400 * 1000).toISOString()
        : null

      const { data: newPkg, error: pkgErr } = await supabase
        .from('student_packages')
        .insert({
          student_id,
          school_id: schoolId,
          package_id: catalogPkg.id,
          credits_total: creditsToGrant,
          credits_remaining: creditsToGrant,
          purchased_at: new Date().toISOString(),
          expires_at: expiresAt,
          payment_method: 'manual',
          status: 'active',
        })
        .select('id')
        .single()

      if (pkgErr || !newPkg) {
        console.error('[credits/grant POST] create package from catalog error', pkgErr)
        return NextResponse.json({ error: pkgErr?.message ?? 'Failed to create package' }, { status: 500 })
      }

      packageId = newPkg.id
      catalogPkgName = catalogPkg.name_en
      console.log(`[credits/grant] assigned catalog package "${catalogPkg.name_en}" (${creditsToGrant} credits)`)
    } else {
      // No catalog package selected — find active package or create a virtual one
      const { data: activePackages } = await supabase
        .from('student_packages')
        .select('id, credits_remaining, credits_total, expires_at')
        .eq('student_id', student_id)
        .eq('school_id', schoolId)
        .eq('status', 'active')
        .order('expires_at', { ascending: true, nullsFirst: false })
        .limit(1)

      if (activePackages && activePackages.length > 0) {
        // Add to existing package
        const pkg = activePackages[0]
        packageId = pkg.id

        const { error: updateErr } = await supabase
          .from('student_packages')
          .update({
            credits_remaining: (pkg.credits_remaining ?? 0) + Number(amount),
            credits_total: (pkg.credits_total ?? 0) + Number(amount),
          })
          .eq('id', pkg.id)

        if (updateErr) {
          console.error('[credits/grant POST] update package error', updateErr)
          return NextResponse.json({ error: updateErr.message }, { status: 500 })
        }
      } else {
        // No active package — create a virtual manual package
        const { data: newPkg, error: pkgErr } = await supabase
          .from('student_packages')
          .insert({
            student_id,
            school_id: schoolId,
            package_id: null,
            credits_total: Number(amount),
            credits_remaining: Number(amount),
            purchased_at: new Date().toISOString(),
            expires_at: expires_at ?? null,
            payment_method: 'manual',
            status: 'active',
          })
          .select('id')
          .single()

        if (pkgErr || !newPkg) {
          console.error('[credits/grant POST] create virtual package error', pkgErr)
          return NextResponse.json({ error: pkgErr?.message ?? 'Failed to create package' }, { status: 500 })
        }

        packageId = newPkg.id
      }
    }

    // Record the grant
    const { error: grantErr } = await supabase
      .from('manual_credit_grants')
      .insert({
        school_id: schoolId,
        student_id,
        package_id: packageId,
        package_name: catalogPkgName,
        granted_by: user.id,
        amount: Number(amount),
        reason,
        note: note ?? null,
        price: price ? Number(price) : null,
        payment_method: price && Number(price) > 0 ? (payment_method ?? 'cash') : null,
      })

    if (grantErr) {
      console.error('[credits/grant POST] insert grant error', grantErr)
      return NextResponse.json({ error: grantErr.message }, { status: 500 })
    }

    // Record transaction if a price was paid
    if (price && Number(price) > 0) {
      const { data: school } = await supabase
        .from('schools')
        .select('platform_fee_percentage, name')
        .eq('id', schoolId)
        .single()

      const feeRate = (school?.platform_fee_percentage ?? 0) / 100
      const totalAmount = Number(price)
      const platformFee = Math.round(totalAmount * feeRate * 100) / 100
      const schoolAmount = Math.round((totalAmount - platformFee) * 100) / 100

      const { error: txErr } = await supabase.from('transactions').insert({
        school_id: schoolId,
        student_id,
        type: 'package',
        product_id: package_catalog_id ?? null,
        product_name: package_catalog_id
          ? (school?.name ?? 'Package')
          : `Manual credit grant (${reason})`,
        amount: totalAmount,
        currency: 'eur',
        platform_fee: platformFee,
        school_amount: schoolAmount,
        payment_method: payment_method ?? 'cash',
        status: 'completed',
      })

      if (txErr) {
        console.error('[credits/grant POST] transaction insert error', txErr)
        // Non-fatal — credits already granted
      } else {
        console.log(`[credits/grant] transaction recorded: €${totalAmount} (fee: €${platformFee}, school: €${schoolAmount})`)
      }
    }

    console.log(`[credits/grant] ${profile.name} granted ${amount} credits to student ${student_id} (reason: ${reason})`)
    return NextResponse.json({ granted: true, package_id: packageId })
  } catch (err) {
    console.error('[credits/grant POST] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
