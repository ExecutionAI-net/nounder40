import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, hq_sub_role').eq('id', user.id).single()
  if (profile?.role !== 'hq' || profile.hq_sub_role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden: Super Admin only' }, { status: 403 })
  }

  const { id, password } = await request.json()
  if (!id || !password) return NextResponse.json({ error: 'id and password are required' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: invite } = await db.from('pending_invitations').select('*').eq('id', id).eq('type', 'hq_member').single()
  if (!invite) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const { data: userData, error: createError } = await db.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: invite.name, role: 'hq' },
  })

  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })

  const userId = userData.user.id

  await db.from('profiles').upsert({
    id: userId,
    email: invite.email,
    name: invite.name,
    role: 'hq',
    hq_sub_role: invite.role_detail,
  })

  await db.from('pending_invitations').delete().eq('id', id)

  return NextResponse.json({ success: true })
}
