import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  revalidateTag('translations')
  return NextResponse.json({ revalidated: true, timestamp: new Date().toISOString() })
}
