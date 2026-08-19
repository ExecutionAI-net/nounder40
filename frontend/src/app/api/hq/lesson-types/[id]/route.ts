import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Linked-record counts, shown before deleting a lesson type
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const [{ count: courses }, { count: lessons }] = await Promise.all([
    admin.from('courses').select('id', { count: 'exact', head: true }).eq('lesson_type_id', id),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('lesson_type_id', id),
  ])
  return NextResponse.json({ courses: courses ?? 0, lessons: lessons ?? 0 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { data, error } = await supabase
    .from('lesson_types')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, roles').eq('id', user.id).single()
  if (!(profile?.role === 'hq' || profile?.roles?.includes('hq'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Hard delete — blocked while courses/lessons still use this type
  // (deactivation is a PATCH { active: false })
  const admin = createAdminClient()
  const [{ count: courses }, { count: lessons }] = await Promise.all([
    admin.from('courses').select('id', { count: 'exact', head: true }).eq('lesson_type_id', id),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('lesson_type_id', id),
  ])
  if ((courses ?? 0) > 0 || (lessons ?? 0) > 0) {
    return NextResponse.json({ error: 'in_use', courses, lessons }, { status: 409 })
  }

  const { error } = await admin.from('lesson_types').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
