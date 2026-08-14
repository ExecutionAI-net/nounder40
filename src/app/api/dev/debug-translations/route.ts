import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const key = (serviceKey ?? anonKey)!
  if (!url || !key) {
    return NextResponse.json({ error: 'Missing env vars', url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey })
  }

  // Paginated fetch — same logic as request.ts
  const pageSize = 1000
  let allData: { key: string; value: string }[] = []
  let offset = 0
  let hasMore = true
  let pages = 0

  while (hasMore) {
    const res = await fetch(
      `${url}/rest/v1/translations?select=key,value&locale=eq.en&offset=${offset}&limit=${pageSize}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        cache: 'no-store',
      }
    )
    const chunk: { key: string; value: string }[] = await res.json()
    allData = allData.concat(chunk)
    pages++
    if (chunk.length < pageSize) {
      hasMore = false
    } else {
      offset += pageSize
    }
  }

  const data = allData

  // Count hq keys
  const hqKeys = data.filter(d => d.key.startsWith('hq.'))
  const hqDashboardKeys = data.filter(d => d.key.startsWith('hq.dashboard.'))

  return NextResponse.json({
    env: { url: !!url, serviceKey: !!serviceKey, anonKey: !!anonKey },
    pages,
    totalRows: data.length,
    hqKeysCount: hqKeys.length,
    hqDashboardKeysCount: hqDashboardKeys.length,
    sampleHqDashboard: hqDashboardKeys.slice(0, 5),
    firstKey: data[0]?.key,
    lastKey: data[data.length - 1]?.key,
  })
}
