import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

export async function GET() {
  const res = await fetch(`${DJANGO_API_URL}/api/platform-settings`, { cache: 'no-store' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: Request) {
  const body = await request.json()
  const updates = {
    stat_teachers:        String(parseInt(body.teachers        ?? '0')),
    stat_students:        String(parseInt(body.students        ?? '0')),
    stat_lessons_monthly: String(parseInt(body.lessonsMonthly  ?? '0')),
    stat_schools:         String(parseInt(body.schools         ?? '0')),
  }

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${DJANGO_API_URL}/api/platform-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(updates),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
