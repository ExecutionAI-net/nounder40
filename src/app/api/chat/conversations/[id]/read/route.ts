import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveChatScope } from '@/lib/api/chat-scope'

export const dynamic = 'force-dynamic'

// Segna come letti i messaggi della conversazione scritti dagli altri.
// Chiamata all'apertura della chat e all'arrivo di un messaggio mentre è aperta.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // La conversazione dev'essere leggibile dall'utente: le policy RLS di
  // `conversations` fanno già da filtro, qui basta verificarne l'esito.
  const { data: conv } = await supabase.from('conversations').select('id').eq('id', id).maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Si leggono i messaggi dell'altra parte: il ruolo arriva dal pannello,
  // perché lo stesso account può stare su entrambi i lati della conversazione.
  const body = await request.json().catch(() => ({}))
  const scope = resolveChatScope(profile, body?.role)

  const { error } = await createAdminClient()
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', id)
    .neq('sender_role', scope)
    .is('read_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
