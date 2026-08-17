import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Faz 2 pilot: served by Django now (see backend/legacy_db/locations.py).
const DJANGO_API_URL = process.env.DJANGO_API_URL!

export async function GET(request: Request) {
  const withSchools = new URL(request.url).searchParams.get('withSchools')
  const qs = withSchools ? `?withSchools=${withSchools}` : ''
  const res = await fetch(`${DJANGO_API_URL}/api/locations${qs}`, { cache: 'no-store' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
