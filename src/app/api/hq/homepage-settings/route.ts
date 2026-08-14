import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data } = await supabase.from('platform_settings').select('key, value')
  const s: Record<string, string> = {}
  data?.forEach(({ key, value }) => { s[key] = value })
  return NextResponse.json(s)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const updates = [
    { key: 'stat_teachers',        value: String(parseInt(body.teachers        ?? '0')) },
    { key: 'stat_students',        value: String(parseInt(body.students        ?? '0')) },
    { key: 'stat_lessons_monthly', value: String(parseInt(body.lessonsMonthly  ?? '0')) },
    { key: 'stat_schools',         value: String(parseInt(body.schools         ?? '0')) },
  ]

  for (const row of updates) {
    await supabase.from('platform_settings')
      .upsert({ key: row.key, value: row.value, updated_at: new Date().toISOString() })
  }

  return NextResponse.json({ success: true })
}
