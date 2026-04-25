import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

async function getSchoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
  return profile?.school_id ?? null
}

// PATCH: update a status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { name, color, burns_credit, is_default, sort_order } = body

    // If setting as default, unset others first
    if (is_default) {
      await supabase
        .from('attendance_statuses')
        .update({ is_default: false })
        .eq('school_id', schoolId)
    }

    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (color !== undefined) updateData.color = color
    if (burns_credit !== undefined) updateData.burns_credit = burns_credit
    if (is_default !== undefined) updateData.is_default = is_default
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data, error } = await supabase
      .from('attendance_statuses')
      .update(updateData)
      .eq('id', id)
      .eq('school_id', schoolId)
      .select()
      .single()

    if (error) {
      console.error('[attendance-statuses PATCH]', error)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    revalidateAll()
    return NextResponse.json({ status: data })
  } catch (err) {
    console.error('[attendance-statuses PATCH] unexpected', err)
    revalidateAll()
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE: remove a status
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const schoolId = await getSchoolId(supabase)
    if (!schoolId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Check if any attendance records use this status
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('status_id', id)

    if ((count ?? 0) > 0) {
      revalidateAll()
      return NextResponse.json(
        { error: 'Cannot delete: this status is used in attendance records.' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('attendance_statuses')
      .delete()
      .eq('id', id)
      .eq('school_id', schoolId)

    if (error) {
      console.error('[attendance-statuses DELETE]', error)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    revalidateAll()
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[attendance-statuses DELETE] unexpected', err)
    revalidateAll()
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
