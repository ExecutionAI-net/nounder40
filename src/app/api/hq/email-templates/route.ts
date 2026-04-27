import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as adminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function admin() {
  return adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireHQ() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return null
  return user
}

// GET /api/hq/email-templates — all templates grouped by key
export async function GET() {
  const supabase = admin()
  const { data, error } = await supabase
    .from('email_templates')
    .select('key, locale, subject, body_html, updated_at')
    .order('key')
    .order('locale')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/hq/email-templates — upsert a single template
export async function POST(req: Request) {
  const user = await requireHQ()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key, locale, subject, body_html } = await req.json()
  if (!key || !locale) return NextResponse.json({ error: 'key and locale required' }, { status: 400 })

  const { error } = await admin()
    .from('email_templates')
    .upsert({ key, locale, subject: subject ?? '', body_html: body_html ?? '', updated_at: new Date().toISOString() }, { onConflict: 'key,locale' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/hq/email-templates — delete all locales for a key
export async function DELETE(req: Request) {
  const user = await requireHQ()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await req.json()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const { error } = await admin().from('email_templates').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
