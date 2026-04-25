import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { createClient as createUserClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/translations — returns all translations grouped by key
// Response: { key: string, en: string, it: string, es: string, fr: string, de: string }[]
export async function GET() {
  const supabase = adminClient()

  // Paginate to bypass Supabase 1000-row default limit
  const pageSize = 1000
  let allData: { key: string; locale: string; value: string }[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('translations')
      .select('key, locale, value')
      .order('key')
      .range(offset, offset + pageSize - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    allData = allData.concat(data ?? [])
    if (!data || data.length < pageSize) {
      hasMore = false
    } else {
      offset += pageSize
    }
  }

  // Group by key
  const byKey: Record<string, Record<string, string>> = {}
  for (const row of allData) {
    if (!byKey[row.key]) byKey[row.key] = {}
    byKey[row.key][row.locale] = row.value ?? ''
  }

  const result = Object.entries(byKey).map(([key, locales]) => ({ key, ...locales }))
  revalidateAll()
  return NextResponse.json(result)
}

// POST /api/translations — upsert a translation value
// Body: { key: string, locale: string, value: string }
export async function POST(request: Request) {
  const userSupabase = await createUserClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only HQ can manage translations
  const { data: profile } = await userSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { key, locale, value } = body

  if (!key || !locale || value === undefined) {
    revalidateAll()
    return NextResponse.json({ error: 'key, locale, and value are required' }, { status: 400 })
  }

  const supabase = adminClient()
  const { error } = await supabase
    .from('translations')
    .upsert({ key, locale, value, updated_at: new Date().toISOString() }, { onConflict: 'key,locale' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalidate cache so the new translation loads within 60 seconds
  revalidateTag('translations')

  revalidateAll()
  return NextResponse.json({ ok: true })
}

// DELETE /api/translations — delete a translation key (all locales)
// Body: { key: string }
export async function DELETE(request: Request) {
  const userSupabase = await createUserClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await userSupabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { key } = body
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const supabase = adminClient()
  const { error } = await supabase.from('translations').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateTag('translations')
  revalidateAll()
  return NextResponse.json({ ok: true })
}
