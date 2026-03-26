import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: conv } = await supabase
    .from('conversations')
    .select('*, schools(id, name, email), students(id, name, email, phone), teachers(id, name, email)')
    .eq('id', id)
    .single()

  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Access control
  if (profile.role === 'school' && conv.school_id !== profile.school_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role === 'student') {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!student || conv.student_id !== student.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Fetch messages (students don't see internal notes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let msgQuery: any = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  if (profile.role === 'student') {
    msgQuery = msgQuery.eq('is_internal', false)
  }

  const { data: messages } = await msgQuery

  // Mark messages as read
  const unreadIds = (messages ?? [])
    .filter((m: { read_at: string | null; sender_id: string }) => !m.read_at && m.sender_id !== user.id)
    .map((m: { id: string }) => m.id)

  if (unreadIds.length > 0) {
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds)
  }

  return NextResponse.json({ conversation: conv, messages: messages ?? [] })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, school_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role === 'student') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if (body.status) updates.status = body.status
  if (body.priority) updates.priority = body.priority
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to

  const { data } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', id)
    .select('id, status, priority, assigned_to')
    .single()

  return NextResponse.json(data)
}
