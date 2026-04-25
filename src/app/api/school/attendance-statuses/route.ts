import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

async function getSchoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return profile?.school_id ?? null
}

// GET: list all statuses for this school
export async function GET() {
  try {
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('attendance_statuses')
      .select('*')
      .eq('school_id', schoolId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[attendance-statuses GET]', error)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    revalidateAll()
    return NextResponse.json({ statuses: data ?? [] })
  } catch (err) {
    console.error('[attendance-statuses GET] unexpected', err)
    revalidateAll()
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST: create a new status
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { name, color, burns_credit, is_default, sort_order } = body

    if (!name || !color) {
      revalidateAll()
      return NextResponse.json({ error: 'name and color are required' }, { status: 400 })
    }

    // If this is being set as default, unset all others
    if (is_default) {
      await supabase
        .from('attendance_statuses')
        .update({ is_default: false })
        .eq('school_id', schoolId)
    }

    const { data, error } = await supabase
      .from('attendance_statuses')
      .insert({
        school_id: schoolId,
        name: name.trim(),
        color,
        burns_credit: burns_credit ?? false,
        is_default: is_default ?? false,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single()

    if (error) {
      console.error('[attendance-statuses POST]', error)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    revalidateAll()
    return NextResponse.json({ status: data })
  } catch (err) {
    console.error('[attendance-statuses POST] unexpected', err)
    revalidateAll()
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
