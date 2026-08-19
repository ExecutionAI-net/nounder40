import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Simple in-memory rate limiter: max 5 resets per admin per 60 seconds
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60_000

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  if (entry.count >= RATE_LIMIT) return true
  entry.count++
  return false
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('school_id')
      .eq('id', user.id)
      .single()

    if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { student_user_id } = await request.json()
    if (!student_user_id) {
      return NextResponse.json({ error: 'student_user_id required' }, { status: 400 })
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(String(student_user_id))) {
      return NextResponse.json({ error: 'Invalid student_user_id' }, { status: 400 })
    }

    const db = admin()

    // Verify student belongs to this school
    const { data: schoolStudent } = await db
      .from('school_students')
      .select('id')
      .eq('school_id', profile.school_id)
      .eq('student_id', student_user_id)
      .maybeSingle()

    if (!schoolStudent) {
      return NextResponse.json({ error: 'Student not found in this school' }, { status: 404 })
    }

    // Look up the student's actual email server-side — never trust client-supplied email
    const { data: studentRecord } = await db
      .from('students')
      .select('email')
      .eq('user_id', student_user_id)
      .single()

    if (!studentRecord?.email) {
      return NextResponse.json({ error: 'Student email not found' }, { status: 404 })
    }

    const { error } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: studentRecord.email,
    })

    if (error) {
      console.error('[reset-password] generateLink error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log('[reset-password] recovery link sent for student:', student_user_id)
    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('[reset-password] unexpected', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
