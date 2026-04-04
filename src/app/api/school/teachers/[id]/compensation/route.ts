import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: teacherId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { compensation_plan_id } = await request.json()

  const { error } = await supabase
    .from('teacher_schools')
    .update({ compensation_plan_id: compensation_plan_id ?? null })
    .eq('teacher_id', teacherId)
    .eq('school_id', school.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: true })
}
