import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function POST(
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

  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type, school_id, student_id, first_response_at')
    .eq('id', id)
    .single()

  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Access control
  if (profile.role === 'school' && conv.school_id !== profile.school_id) {
    revalidateAll()
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (profile.role === 'student') {
    const { data: student } = await supabase
      .from('students')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!student || conv.student_id !== student.id) {
      revalidateAll()
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const body = await request.json()
  const { content, is_internal, attachment_url } = body

  if (!content?.trim() && !attachment_url) {
    revalidateAll()
    return NextResponse.json({ error: 'Content required' }, { status: 400 })
  }

  const isInternal = profile.role !== 'student' && !!is_internal

  const { data: message } = await supabase
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id: user.id,
      sender_role: profile.role,
      content: content?.trim() ?? '',
      is_internal: isInternal,
      attachment_url: attachment_url ?? null,
    })
    .select()
    .single()

  // Update conversation metadata
  const convUpdates: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
  }

  if (profile.role !== 'student') {
    convUpdates.status = 'in_progress'
    if (!conv.first_response_at) {
      convUpdates.first_response_at = new Date().toISOString()
    }
  }

  await supabase.from('conversations').update(convUpdates).eq('id', id)

  revalidateAll()
  return NextResponse.json(message)
}
