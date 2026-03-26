import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return 'Nu40_' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: members } = await supabase
    .from('profiles')
    .select('id, name, email, hq_sub_role, created_at')
    .eq('role', 'hq')
    .order('created_at', { ascending: false })

  return NextResponse.json(members ?? [])
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

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const tempPassword = generateTempPassword()

  const { data: userData, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name, role: 'hq' },
  })

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })

  const userId = userData.user.id

  await admin.from('profiles').upsert({
    id: userId,
    email,
    name,
    role: 'hq',
    hq_sub_role,
  })

  return NextResponse.json({ id: userId, tempPassword })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  await admin.auth.admin.deleteUser(id)
  await admin.from('profiles').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
