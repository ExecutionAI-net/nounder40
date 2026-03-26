import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const level = searchParams.get('level')
  const language = searchParams.get('language')

  // Get HQ content (school_id IS NULL) that is active
  let query = supabase
    .from('library_content')
    .select('*, lesson_types(name_en)')
    .eq('active', true)
    .is('school_id', null)
    .order('created_at', { ascending: false })

  if (type && type !== 'all') query = query.eq('type', type)
  if (level && level !== 'all') query = query.eq('level', level)
  if (language && language !== 'all') query = query.eq('language', language)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
