import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

async function requireHQ(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return null
  return user
}

export async function POST(request: Request) {
  const supabase = await createClient()
  if (!await requireHQ(supabase)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { country_id, name } = await request.json()
  if (!country_id || !name) return NextResponse.json({ error: 'country_id and name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('hq_cities')
    .insert({ country_id, name: name.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data)
}
