import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'hq') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!hookUrl) {
    return NextResponse.json({ error: 'Deploy hook not configured' }, { status: 500 })
  }

  const res = await fetch(hookUrl, { method: 'POST' })
  if (!res.ok) {
    return NextResponse.json({ error: 'Deploy hook failed' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
