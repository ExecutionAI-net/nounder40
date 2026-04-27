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
  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return null
  return user
}

export async function POST(request: Request) {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { country_id, name } = await request.json()
  if (!country_id || !name) return NextResponse.json({ error: 'country_id and name required' }, { status: 400 })

  const { data, error } = await admin()
    .from('hq_cities')
    .insert({ country_id, name: name.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
