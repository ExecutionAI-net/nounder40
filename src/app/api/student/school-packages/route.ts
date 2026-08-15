import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Catalogo pubblico dei pacchetti. Studente loggato: quelli della sua scuola.
// Anonimo: tutti i pacchetti attivi della rete (filtrabili con ?school_id=...),
// con nome/città della scuola per le card. L'acquisto resta protetto
// (/api/stripe/checkout richiede login).
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { searchParams } = new URL(request.url)

  let schoolId: string | null = null
  if (user) {
    const { data: student } = await supabase
      .from('students')
      .select('school_id')
      .eq('user_id', user.id)
      .maybeSingle()
    schoolId = student?.school_id ?? null
  }
  if (!schoolId) schoolId = searchParams.get('school_id')

  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let query = db
    .from('packages')
    .select('id, school_id, name_en, description_en, credits, validity_days, price, color, language, image_url, is_popular, is_vip, is_recurring, recurring_interval, credits_rollover, schools(id, name, city)')
    .eq('active', true)
    .order('price', { ascending: true })

  if (schoolId) query = query.eq('school_id', schoolId)

  const { data, error } = await query.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
