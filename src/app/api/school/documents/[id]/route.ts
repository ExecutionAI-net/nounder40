import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revalidateAll } from '@/lib/revalidate'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  if (!profile?.school_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { action, expires_at } = await request.json() // action: 'validate' | 'reject', expires_at: ISO string (optional)

  if (action === 'validate') {
    const updateData: Record<string, unknown> = {
      status: 'valid',
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    }
    if (expires_at) updateData.expires_at = expires_at

    const { error } = await supabase
      .from('student_documents')
      .update(updateData)
      .eq('id', id)
      .eq('school_id', profile.school_id)

    if (error) {
      console.error('[documents/validate] error:', error.message)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    revalidateAll()
    return NextResponse.json({ updated: true })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('student_documents')
      .update({ status: 'expired', validated_by: null, validated_at: null })
      .eq('id', id)
      .eq('school_id', profile.school_id)

    if (error) {
      console.error('[documents/reject] error:', error.message)
      revalidateAll()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    revalidateAll()
    return NextResponse.json({ updated: true })
  }

  revalidateAll()
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
