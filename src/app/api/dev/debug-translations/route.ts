import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const key = (serviceKey ?? anonKey)!
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing env vars', url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey })
  }

  // Exact same fetch as request.ts
  const res = await fetch(
    `${url}/rest/v1/translations?select=key,value&locale=eq.en`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: '0-9999',
        Prefer: 'count=exact',
      },
      cache: 'no-store',
    }
  )

  const contentRange = res.headers.get('content-range')
  const status = res.status
  const data: { key: string; value: string }[] = await res.json()

  // Count hq keys
  const hqKeys = data.filter(d => d.key.startsWith('hq.'))
  const hqDashboardKeys = data.filter(d => d.key.startsWith('hq.dashboard.'))

  return NextResponse.json({
    env: { url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey },
    fetchStatus: status,
    contentRange,
    totalRows: data.length,
    hqKeysCount: hqKeys.length,
    hqDashboardKeysCount: hqDashboardKeys.length,
    sampleHqDashboard: hqDashboardKeys.slice(0, 5),
    firstKey: data[0]?.key,
    lastKey: data[data.length - 1]?.key,
  })
}
