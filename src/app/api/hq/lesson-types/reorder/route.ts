import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// POST /api/hq/lesson-types/reorder — Body: { ids: string[] } (ordine completo visualizzato)
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { ids } = await request.json() as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  for (let i = 0; i < ids.length; i++) {
    const { error } = await admin.from('lesson_types').update({ sort_order: i + 1 }).eq('id', ids[i])
    if (error) {
      if (error.message.includes('sort_order')) {
        return NextResponse.json({ error: 'sort_order column missing — run migration 057' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
