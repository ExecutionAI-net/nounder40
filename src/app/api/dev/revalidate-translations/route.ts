import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'

export const dynamic = 'force-dynamic'

// Manual cache purge for DB-stored translations.
// Open in local dev; in production it requires an authenticated HQ user.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    const auth = await requireRole('hq')
    if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  revalidateTag('translations')
  return NextResponse.json({ revalidated: true, timestamp: new Date().toISOString() })
}
