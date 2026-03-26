import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data } = await supabase.from('platform_settings').select('key, value')

  const s: Record<string, string> = {}
  data?.forEach(({ key, value }) => { s[key] = value })

  return NextResponse.json({
    teachers:       parseInt(s.stat_teachers        ?? '20'),
    students:       parseInt(s.stat_students        ?? '249'),
    lessonsMonthly: parseInt(s.stat_lessons_monthly ?? '950'),
    schools:        parseInt(s.stat_schools         ?? '3'),
  })
}
