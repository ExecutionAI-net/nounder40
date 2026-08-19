import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST /api/school/courses/reorder — Body: { ids: string[] } (ordine completo)
// Salva sort_order = posizione nella lista.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { ids } = await request.json() as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase
      .from('courses')
      .update({ sort_order: i + 1 })
      .eq('id', ids[i])
      .eq('school_id', profile.school_id)
    if (error) {
      // colonna non ancora migrata (055)
      if (error.message.includes('sort_order')) {
        return NextResponse.json({ error: 'sort_order column missing — run migration 055' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
