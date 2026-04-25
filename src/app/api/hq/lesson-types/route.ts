import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('lesson_types')
    .select('*')
    .order('name_en', { ascending: true })
  revalidateAll()
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { code, name_it, name_en, name_fr, name_es, level, description_it, description_en } = body

  if (!code || !name_it || !name_en) {
    revalidateAll()
    return NextResponse.json({ error: 'code, name_it and name_en are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lesson_types')
    .insert({ code: code.toUpperCase(), name_it, name_en, name_fr, name_es, level, description_it, description_en })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data)
}
