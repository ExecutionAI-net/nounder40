import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: studentRecord } = await supabase
    .from('students')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!studentRecord) return NextResponse.json([])

  const { data, error } = await supabase
    .from('student_packages')
    .select('*, packages(name_en, color, description_en), schools(name, city)')
    .eq('student_id', studentRecord.id)
    .order('purchased_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
