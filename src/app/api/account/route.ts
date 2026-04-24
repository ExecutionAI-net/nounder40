import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET: current user's profile
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, name, phone, role, roles, hq_sub_role, school_sub_role, school_id, language_preference, created_at, schools(name, city, country, logo_url, active)')
    .eq('id', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH: update name, phone, language_preference
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, phone, language_preference } = body

  const update: Record<string, unknown> = {}
  if (typeof name === 'string') update.name = name.trim()
  if (typeof phone === 'string' || phone === null) update.phone = phone || null
  if (typeof language_preference === 'string' && ['en', 'it', 'es', 'fr', 'de'].includes(language_preference)) {
    update.language_preference = language_preference
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields' }, { status: 400 })
  }

  // Authorization already done via getUser(); use the service-role client for
  // the write so that we get back the actual affected row (RLS can silently
  // affect 0 rows and return { data: null, error: null }, which makes the
  // API incorrectly report success).
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('id, name, phone, language_preference')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Profile not found for current user' }, { status: 404 })

  return NextResponse.json({ updated: true, profile: data })
}
