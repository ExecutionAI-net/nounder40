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
    const { student_id, amount, reason, note, expires_at } = body

    if (!student_id || !amount || !reason) {
      return NextResponse.json({ error: 'student_id, amount and reason are required' }, { status: 400 })
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
      return NextResponse.json({ error: 'Student not found in this school' }, { status: 404 })
    }

    // Find active package with nearest expiry
    const { data: activePackages } = await supabase
      .from('student_packages')
      .select('id, credits_remaining, credits_total, expires_at')
      .eq('student_id', student_id)
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('expires_at', { ascending: true, nullsFirst: false })
      .limit(1)

    let packageId: string | null = null

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

    // Record the grant
    const { error: grantErr } = await supabase
      .from('manual_credit_grants')
      .insert({
        school_id: schoolId,
        student_id,
        package_id: packageId,
        granted_by: user.id,
        amount: Number(amount),
        reason,
        note: note ?? null,
      })

    if (grantErr) {
      console.error('[credits/grant POST] insert grant error', grantErr)
      return NextResponse.json({ error: grantErr.message }, { status: 500 })
    }

    console.log(`[credits/grant] ${profile.name} granted ${amount} credits to student ${student_id} (reason: ${reason})`)
    return NextResponse.json({ granted: true, package_id: packageId })
  } catch (err) {
    console.error('[credits/grant POST] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
