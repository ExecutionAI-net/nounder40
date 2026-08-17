import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Faz 2 pilot: served by Django now (see backend/legacy_db/quick_replies.py)
// instead of talking to Supabase directly. Django re-checks auth/role itself
// from the same bearer token, so this route stays a thin proxy.
const DJANGO_API_URL = process.env.DJANGO_API_URL!

async function authHeader() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function GET() {
  const res = await fetch(`${DJANGO_API_URL}/api/chat/quick-replies`, {
    headers: await authHeader(),
    cache: 'no-store',
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: Request) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/chat/quick-replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(request: Request) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/chat/quick-replies`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
