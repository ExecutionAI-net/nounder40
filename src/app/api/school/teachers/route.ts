import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = admin()

  const [{ data: teachers, error }, { data: pending }] = await Promise.all([
    db.from('teacher_schools')
      .select('teacher_id, active, compensation_plan_id, teachers(id, name, email, phone, active, created_at)')
      .eq('school_id', profile.school_id)
      .order('teacher_id'),
    db.from('pending_invitations')
      .select('id, name, email, phone, created_at')
      .eq('type', 'school_teacher')
      .eq('school_id', profile.school_id)
      .order('created_at', { ascending: false }),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ teachers: teachers ?? [], pending: pending ?? [] })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    // getSession reads from cookie — no network call (middleware already validated)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = session.user
    const db = admin()

    // Parallelize profile lookup + body parse to save one RTT
    const [{ data: profile }, body] = await Promise.all([
      db.from('profiles').select('role, school_id').eq('id', user.id).single(),
      request.json() as Promise<{ name: string; email: string; phone?: string }>,
    ])

    if (profile?.role !== 'school' || !profile.school_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { name, email, phone } = body
    if (!name || !email) return NextResponse.json({ error: 'name and email are required' }, { status: 400 })

    // Check duplicate (scoped to this school)
    const { data: existingPending } = await db
      .from('pending_invitations')
      .select('id')
      .eq('email', email)
      .eq('school_id', profile.school_id)
      .maybeSingle()
    if (existingPending) return NextResponse.json({ error: 'An invitation for this email already exists' }, { status: 400 })

    // Generate UUID here so we don't need a .select() after insert
    const newId = randomUUID()

    const { error } = await db.from('pending_invitations').insert({
      id: newId,
      type: 'school_teacher',
      name,
      email,
      phone: phone || null,
      school_id: profile.school_id,
      invited_by: user.id,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, id: newId })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('POST /api/school/teachers error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, school_id').eq('id', user.id).single()
  if (profile?.role !== 'school' || !profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()
  await db.from('pending_invitations').delete().eq('id', id).eq('school_id', profile.school_id)

  return NextResponse.json({ success: true })
}
