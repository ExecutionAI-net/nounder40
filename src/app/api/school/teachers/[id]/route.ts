import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Edit a teacher's details — only for teachers assigned to the caller's school
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('school')
  if (!auth || !auth.profile.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('teacher_schools')
    .select('teacher_id')
    .eq('teacher_id', id)
    .eq('school_id', auth.profile.school_id)
    .single()
  if (!membership) return NextResponse.json({ error: 'Teacher not in your school' }, { status: 403 })

  const { name, phone, bio } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { error } = await admin.from('teachers')
    .update({ name: name.trim(), phone: phone?.trim() || null, ...(bio !== undefined ? { bio: bio?.trim() || null } : {}) })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep the teacher's profile name in sync (used by layouts/chat)
  const { data: teacher } = await admin.from('teachers').select('user_id').eq('id', id).single()
  if (teacher?.user_id) {
    await admin.from('profiles').update({ name: name.trim() }).eq('id', teacher.user_id)
  }

  return NextResponse.json({ ok: true })
}
