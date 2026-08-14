import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: student } = await supabase
    .from('students')
    .select('school_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!student?.school_id) return NextResponse.json([])

  const { data, error } = await supabase
    .from('packages')
    .select('id, name_en, description_en, credits, validity_days, price, color, language, image_url, is_popular, is_recurring, recurring_interval, credits_rollover')
    .eq('school_id', student.school_id)
    .eq('active', true)
    .order('price', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
