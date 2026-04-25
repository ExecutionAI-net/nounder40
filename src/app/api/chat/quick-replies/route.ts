import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'school' || !profile.school_id) {
    revalidateAll()
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data } = await supabase
    .from('quick_reply_templates')
    .select('id, title, content')
    .eq('school_id', profile.school_id)
    .order('title')

  revalidateAll()
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'school' || !profile.school_id) {
    revalidateAll()
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, content } = await request.json()
  if (!title || !content) return NextResponse.json({ error: 'title and content required' }, { status: 400 })

  const { data } = await supabase
    .from('quick_reply_templates')
    .insert({ school_id: profile.school_id, title, content })
    .select('id, title, content')
    .single()

  revalidateAll()
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'school' || !profile.school_id) {
    revalidateAll()
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  await supabase
    .from('quick_reply_templates')
    .delete()
    .eq('id', id)
    .eq('school_id', profile.school_id)

  revalidateAll()
  return NextResponse.json({ deleted: true })
}
