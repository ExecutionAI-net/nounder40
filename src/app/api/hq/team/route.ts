import { NextResponse } from 'next/server'
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

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = admin()

  const [{ data: members }, { data: pending }] = await Promise.all([
    db.from('profiles').select('id, name, email, hq_sub_role, created_at')
      .eq('role', 'hq').order('created_at', { ascending: false }),
    db.from('pending_invitations').select('id, name, email, role_detail, created_at')
      .eq('type', 'hq_member').order('created_at', { ascending: false }),
  ])

  return NextResponse.json({ active: members ?? [], pending: pending ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden: Super Admin only' }, { status: 403 })
  }

  const { name, email, hq_sub_role } = await request.json()
  if (!name || !email || !hq_sub_role) {
    return NextResponse.json({ error: 'name, email and hq_sub_role are required' }, { status: 400 })
  }

  const db = admin()

  // Check if already pending or active
  const { data: existing } = await db.from('pending_invitations').select('id').eq('email', email).single()
  if (existing) return NextResponse.json({ error: 'An invitation for this email already exists' }, { status: 400 })

  const { data: activeProfile } = await db.from('profiles').select('id').eq('email', email).single()
  if (activeProfile) return NextResponse.json({ error: 'This email is already a team member' }, { status: 400 })

  const { error } = await db.from('pending_invitations').insert({
    type: 'hq_member',
    name,
    email,
    role_detail: hq_sub_role,
    invited_by: user.id,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, pending } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = admin()

  if (pending) {
    await db.from('pending_invitations').delete().eq('id', id)
  } else {
    if (id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    await db.auth.admin.deleteUser(id)
    await db.from('profiles').delete().eq('id', id)
  }

  return NextResponse.json({ success: true })
}
