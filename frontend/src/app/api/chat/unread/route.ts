import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveChatScope } from '@/lib/api/chat-scope'

export const dynamic = 'force-dynamic'

// Messaggi non letti dell'utente corrente: totale (badge nella barra laterale)
// e suddivisione per tipo di conversazione (badge sui tab della posta).
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ total: 0, byType: {} })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ total: 0, byType: {} })

  const admin = createAdminClient()
  // Il pannello dice quale casella guardare: lo stesso account può essere
  // scuola e allieva insieme e i non letti sono diversi.
  const scope = resolveChatScope(profile, new URL(request.url).searchParams.get('scope'))

  let query = admin.from('conversations').select('id, type')
  if (scope === 'school' && profile.school_id) {
    query = query.eq('school_id', profile.school_id)
  } else if (scope === 'hq') {
    query = query.eq('type', 'hq_school')
  } else if (scope === 'teacher') {
    const { data: teacher } = await admin.from('teachers').select('id').eq('user_id', user.id).maybeSingle()
    if (!teacher) return NextResponse.json({ total: 0, byType: {} })
    query = query.eq('teacher_id', teacher.id)
  } else {
    const { data: student } = await admin.from('students').select('id').eq('user_id', user.id).maybeSingle()
    if (!student) return NextResponse.json({ total: 0, byType: {} })
    query = query.eq('student_id', student.id)
  }

  const { data: conversations } = await query
  if (!conversations?.length) return NextResponse.json({ total: 0, byType: {} })

  const typeById = new Map(conversations.map(c => [c.id, c.type]))

  // Non letti = scritti da altri e mai aperti. Le note interne non contano
  // per l'allieva, che non le vede nemmeno.
  let messages = admin
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', [...typeById.keys()])
    .is('read_at', null)
    // Non letto = scritto dall'altra parte. Con `sender_id` un account che è
    // insieme scuola e allieva non vedeva mai i propri messaggi arrivare.
    .neq('sender_role', scope)

  // L'allieva non vede le note interne, quindi non le contiamo
  if (scope === 'student' || scope === 'teacher') {
    messages = messages.eq('is_internal', false)
  }

  const { data: unread } = await messages
  const byType: Record<string, number> = {}
  for (const m of unread ?? []) {
    const type = typeById.get(m.conversation_id) ?? 'other'
    byType[type] = (byType[type] ?? 0) + 1
  }

  return NextResponse.json({ total: unread?.length ?? 0, byType })
}
