import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const [{ data: countries }, { data: cities }] = await Promise.all([
    supabase.from('hq_countries').select('id, name, code').order('name'),
    supabase.from('hq_cities').select('id, country_id, name').order('name'),
  ])

  return NextResponse.json({ countries: countries ?? [], cities: cities ?? [] })
}
