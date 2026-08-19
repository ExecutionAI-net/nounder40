import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { BRAND_COLOR } from '@/lib/constants'

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

export async function GET() {
  const db = admin()
  const { data, error } = await db
    .from('packages')
    .select('*')
    .is('school_id', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const user = await requireHQ()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const {
    name_en, name_it, description_en, credits, validity_days, price, color,
    is_popular, is_vip, language, is_recurring, recurring_interval, credits_rollover,
  } = body

  if (!name_en || !credits || !validity_days || price === undefined) {
    return NextResponse.json({ error: 'name_en, credits, validity_days, price are required' }, { status: 400 })
  }

  const db = admin()
  const { data, error } = await db.from('packages').insert({
    school_id: null,
    name_en,
    name_it: name_it || name_en,
    description_en: description_en || null,
    credits: Number(credits),
    validity_days: Number(validity_days),
    price: Number(price),
    color: color || BRAND_COLOR,
    language: language || 'it',
    is_popular: is_popular ?? false,
    is_vip: is_vip ?? false,
    is_recurring: is_recurring || false,
    recurring_interval: is_recurring ? (recurring_interval || 'month') : null,
    credits_rollover: credits_rollover || false,
    lesson_type_restriction: null,
    active: true,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
