import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('school_id')
    .eq('id', user.id)
    .single()

  const school = profile?.school_id ? { id: profile.school_id } : null
  if (!school) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('student_documents')
    .select(`
      id, type, file_url, uploaded_at, expires_at, status,
      validated_by, validated_at,
      students(id, name, email)
    `)
    .eq('school_id', school.id)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const now = new Date()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  const computed = (data ?? []).map(doc => {
    if (!doc.expires_at) return doc
    const exp = new Date(doc.expires_at)
    let status = doc.status
    if (exp < now) status = 'expired'
    else if (exp.getTime() - now.getTime() < thirtyDays) status = 'expiring'
    else status = 'valid'
    return { ...doc, status }
  })

  return NextResponse.json(computed)
}
