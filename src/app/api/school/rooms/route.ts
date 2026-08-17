import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Faz 2 pilot: served by Django now (see backend/legacy_db/rooms.py).
// Replaces the direct Supabase calls that used to live in
// src/app/[locale]/school/locations/page.tsx (a client component).
const DJANGO_API_URL = process.env.DJANGO_API_URL!

async function authHeader() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function GET(request: Request) {
  const qs = new URL(request.url).search
  const res = await fetch(`${DJANGO_API_URL}/api/school/rooms${qs}`, {
    headers: await authHeader(),
    cache: 'no-store',
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: Request) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/school/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
