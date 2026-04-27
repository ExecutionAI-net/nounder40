import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return null
  return user
}

export async function POST(request: Request) {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, code } = await request.json()
  if (!name || !code) return NextResponse.json({ error: 'name and code required' }, { status: 400 })

  const { data, error } = await admin()
    .from('hq_countries')
    .insert({ name: name.trim(), code: code.trim().toUpperCase() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
