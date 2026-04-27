import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [{ data: countries }, { data: cities }] = await Promise.all([
    db.from('hq_countries').select('id, name, code').order('name'),
    db.from('hq_cities').select('id, country_id, name').order('name'),
  ])

  return NextResponse.json({ countries: countries ?? [], cities: cities ?? [] })
}
