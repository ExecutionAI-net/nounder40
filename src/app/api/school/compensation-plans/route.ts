import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

async function getSchoolId(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return data?.school_id ?? null
}

export async function GET() {
  const supabase = await createClient()
  const schoolId = await getSchoolId(supabase)
  if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('compensation_plans')
    .select('id, name, base_fee, bonus_threshold, bonus_max_threshold, bonus_per_student')
    .eq('school_id', schoolId)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const schoolId = await getSchoolId(supabase)
  if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, base_fee, bonus_threshold, bonus_max_threshold, bonus_per_student } = body

  if (!name || base_fee === undefined) {
    revalidateAll()
    return NextResponse.json({ error: 'name and base_fee required' }, { status: 400 })
  }

  if (bonus_max_threshold && Number(bonus_max_threshold) <= Number(bonus_threshold ?? 0)) {
    revalidateAll()
    return NextResponse.json({ error: 'bonus_max_threshold must be greater than bonus_threshold' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('compensation_plans')
    .insert({
      school_id: schoolId,
      name,
      base_fee: Number(base_fee),
      bonus_threshold: Number(bonus_threshold ?? 0),
      bonus_max_threshold: bonus_max_threshold ? Number(bonus_max_threshold) : null,
      bonus_per_student: Number(bonus_per_student ?? 0),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateAll()
  return NextResponse.json(data)
}
