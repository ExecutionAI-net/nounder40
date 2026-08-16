import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveChatScope } from '@/lib/api/chat-scope'

export const dynamic = 'force-dynamic'

// Eliminazione di un messaggio.
// Regola: si cancella ciò che ha scritto la propria parte; scuola e HQ possono
// inoltre ripulire le conversazioni che gestiscono (moderazione).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const scope = resolveChatScope(profile, new URL(request.url).searchParams.get('role'))

  const admin = createAdminClient()
  const { data: message } = await admin
    .from('messages')
    .select('id, conversation_id, sender_id, sender_role, attachment_url')
    .eq('id', id)
    .maybeSingle()
  if (!message) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // La conversazione dev'essere visibile: le policy RLS fanno da filtro
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, type, school_id')
    .eq('id', message.conversation_id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isMine = message.sender_role === scope || message.sender_id === user.id
  const moderates =
    (scope === 'school' && conv.school_id === profile.school_id) ||
    (scope === 'hq' && conv.type === 'hq_school')

  if (!isMine && !moderates) return NextResponse.json({ error: 'not_yours' }, { status: 403 })

  const { error } = await admin.from('messages').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Via anche l'allegato: il file non serve più a nessuno
  const path = message.attachment_url
  if (path && !/^https?:\/\//i.test(path)) {
    await admin.storage.from('chat-attachments').remove([path])
  }

  return NextResponse.json({ deleted: true })
}
