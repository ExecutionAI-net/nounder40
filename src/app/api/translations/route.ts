import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient as createUserClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Faz 2 pilot: this resource is served by Django now (see backend/legacy_db/
// translations.py) instead of talking to Supabase directly. Django re-checks
// auth/role itself from the same bearer token, so this route stays a thin
// proxy -- request/response shapes are unchanged for every existing caller.
const DJANGO_API_URL = process.env.DJANGO_API_URL!

async function authHeader() {
  const userSupabase = await createUserClient()
  const { data: { session } } = await userSupabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

// GET /api/translations — returns all translations grouped by key
// Response: { key: string, en: string, it: string, es: string, fr: string, de: string }[]
export async function GET() {
  const res = await fetch(`${DJANGO_API_URL}/api/translations`, { cache: 'no-store' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

// POST /api/translations — upsert a translation value
// Body: { key: string, locale: string, value: string }
export async function POST(request: Request) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/translations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (res.ok) revalidateTag('translations') // new value loads within 60s
  return NextResponse.json(data, { status: res.status })
}

// DELETE /api/translations — delete a translation key (all locales)
// Body: { key: string }
export async function DELETE(request: Request) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/translations`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (res.ok) revalidateTag('translations')
  return NextResponse.json(data, { status: res.status })
}
