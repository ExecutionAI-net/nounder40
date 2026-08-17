import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

export async function GET() {
  const res = await fetch(`${DJANGO_API_URL}/api/platform-settings`, { cache: 'no-store' })
  const s: Record<string, string> = await res.json()

  return NextResponse.json({
    teachers:       parseInt(s.stat_teachers        ?? '20'),
    students:       parseInt(s.stat_students        ?? '249'),
    lessonsMonthly: parseInt(s.stat_lessons_monthly ?? '950'),
    schools:        parseInt(s.stat_schools         ?? '3'),
  })
}
