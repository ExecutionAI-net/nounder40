import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const level = searchParams.get('level')
  const language = searchParams.get('language')

  let query = supabase
    .from('library_content')
    .select('*, lesson_types(name_en)')
    .is('school_id', null)
    .order('created_at', { ascending: false })

  if (type && type !== 'all') query = query.eq('type', type)
  if (level && level !== 'all') query = query.eq('level', level)
  if (language && language !== 'all') query = query.eq('language', language)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { title, type, level, language, description, file_url, thumbnail_url, duration_seconds, visible_to_students, student_access, price } = body

  if (!title || !type) {
    return NextResponse.json({ error: 'title and type are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('library_content')
    .insert({
      title,
      type,
      level: level || 'all',
      language: language || 'en',
      description: description || null,
      file_url: file_url || null,
      thumbnail_url: thumbnail_url || null,
      duration_seconds: duration_seconds ? Number(duration_seconds) : null,
      visible_to_students: visible_to_students ?? false,
      student_access: student_access || 'included',
      price: price ? Number(price) : null,
      school_id: null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
