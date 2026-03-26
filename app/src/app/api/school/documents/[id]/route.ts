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

  const { data: school } = await supabase
    .from('schools')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action } = await request.json() // 'validate' | 'reject'

  if (action === 'validate') {
    const { error } = await supabase
      .from('student_documents')
      .update({
        status: 'valid',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('school_id', school.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated: true })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('student_documents')
      .update({ status: 'expired', validated_by: null, validated_at: null })
      .eq('id', id)
      .eq('school_id', school.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
