import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { current_password, new_password } = await request.json()

  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'Both current_password and new_password are required' }, { status: 400 })
  }
  if (new_password.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
  }

  // Verify current password by re-authenticating
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: current_password,
  })
  if (verifyErr) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const { error: updateErr } = await supabase.auth.updateUser({ password: new_password })
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ updated: true })
}
