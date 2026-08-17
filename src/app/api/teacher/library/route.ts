import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Faz 2 pilot: served by Django now (see backend/legacy_db/library.py).
const DJANGO_API_URL = process.env.DJANGO_API_URL!

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {}

  const qs = new URL(request.url).search
  const res = await fetch(`${DJANGO_API_URL}/api/teacher/library${qs}`, { headers, cache: 'no-store' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
