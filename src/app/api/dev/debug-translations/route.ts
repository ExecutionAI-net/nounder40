import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const key = serviceKey ?? anonKey
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing env vars', url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey })
  }

  const supabase = createClient(url, key)
  const { data, error, count } = await supabase
    .from('translations')
    .select('key, value', { count: 'exact' })
    .eq('locale', 'en')
    .like('key', 'hq.dashboard%')
    .limit(20)

  return NextResponse.json({
    env: { url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey },
    error: error?.message ?? null,
    count,
    sample: data?.slice(0, 5),
  })
}
