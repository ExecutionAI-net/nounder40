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

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return null
  return user
}

export async function GET() {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin()
    .from('shop_products')
    .select('*')
    .is('school_id', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  if (!await requireHQ()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { name, description, category, price } = body

  if (!name || !price) {
    return NextResponse.json({ error: 'name and price are required' }, { status: 400 })
  }

  const { data, error } = await admin()
    .from('shop_products')
    .insert({
      name,
      description: description || null,
      category: category || 'other',
      price: Number(price),
      school_id: null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
