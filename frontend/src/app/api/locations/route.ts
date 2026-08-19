import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [{ data: countries }, { data: cities }] = await Promise.all([
    db.from('hq_countries').select('id, name, code').order('name'),
    db.from('hq_cities').select('id, country_id, name').order('name'),
  ])

  // ?withSchools=1 → solo paesi/città dove esiste almeno una scuola ATTIVA
  // (i filtri di prenotazione devono rispecchiare la rete reale, non il catalogo)
  const withSchools = new URL(request.url).searchParams.get('withSchools') === '1'
  if (!withSchools) {
    return NextResponse.json({ countries: countries ?? [], cities: cities ?? [] })
  }

  const { data: schools } = await db.from('schools').select('country, city').eq('active', true)
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
  const schoolCountries = new Set((schools ?? []).map(sc => norm(sc.country)))
  const schoolCities = new Set((schools ?? []).map(sc => norm(sc.city)))

  // le scuole hanno country come nome ("Italy") o codice ("IT"): matcha entrambi
  const realCountries = (countries ?? []).filter(c =>
    schoolCountries.has(norm(c.name)) || schoolCountries.has(norm(c.code)))
  const realCountryIds = new Set(realCountries.map(c => c.id))
  const realCities = (cities ?? []).filter(c =>
    schoolCities.has(norm(c.name)) && realCountryIds.has(c.country_id))

  return NextResponse.json({ countries: realCountries, cities: realCities })
}
