import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, base_fee, bonus_threshold, bonus_max_threshold, bonus_per_student } = body

  const { data, error } = await supabase
    .from('compensation_plans')
    .update({
      ...(name !== undefined && { name }),
      ...(base_fee !== undefined && { base_fee: Number(base_fee) }),
      ...(bonus_threshold !== undefined && { bonus_threshold: Number(bonus_threshold) }),
      ...(bonus_max_threshold !== undefined && { bonus_max_threshold: bonus_max_threshold ? Number(bonus_max_threshold) : null }),
      ...(bonus_per_student !== undefined && { bonus_per_student: Number(bonus_per_student) }),
    })
    .eq('id', id)
    .eq('school_id', school.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('compensation_plans')
    .delete()
    .eq('id', id)
    .eq('school_id', school.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
