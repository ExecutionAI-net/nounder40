import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next')

  console.log('[auth/callback] params:', { code: !!code, token_hash: !!token_hash, type, next })

  const supabase = await createClient()

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'signup' | 'email' | 'recovery' | 'invite' | 'email_change' | 'magiclink',
    })
    if (error) {
      console.error('[auth/callback] verifyOtp error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=auth&detail=${encodeURIComponent(error.message)}`)
    }
    console.log('[auth/callback] verifyOtp success')
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=auth&detail=${encodeURIComponent(error.message)}`)
    }
    console.log('[auth/callback] exchangeCodeForSession success')
  } else {
    console.error('[auth/callback] no code or token_hash in URL')
    return NextResponse.redirect(`${origin}/login?error=auth&detail=no_params`)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.error('[auth/callback] getUser returned null after auth')
    return NextResponse.redirect(`${origin}/login?error=auth`)
  }
  console.log('[auth/callback] user:', user.id, user.email)

  if (next === '/reset-password' || type === 'recovery') {
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  const meta = user.user_metadata ?? {}
  const isHQInvite = !!meta.hq_sub_role
  const isTeacherInvite = !!meta.teacher_invite
  const isSchoolInvite = !!meta.school_invite

  if (isTeacherInvite || isSchoolInvite || isHQInvite) {
    console.log('[auth/callback] invite detected, redirecting to setup-account')
    return NextResponse.redirect(`${origin}/setup-account`)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, roles, name')
    .eq('id', user.id)
    .single()

  if (profileError) console.error('[auth/callback] profile fetch error:', profileError.message)
  console.log('[auth/callback] profile role:', profile?.role)

  const name = meta.name ?? meta.full_name ?? profile?.name ?? user.email!.split('@')[0]

  if (!profile) {
    const { error: profileInsertErr } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email!,
      role: 'student',
      roles: ['student'],
      name,
    })
    if (profileInsertErr) console.error('[auth/callback] profile insert error:', profileInsertErr.message)
    else console.log('[auth/callback] profile created: role=student name=', name)
  } else {
    const { error: profileUpdateErr } = await supabase
      .from('profiles')
      .update({ name })
      .eq('id', user.id)
    if (profileUpdateErr) console.error('[auth/callback] profile update error:', profileUpdateErr.message)
  }

  const { data: existingStudent } = await supabase
    .from('students').select('id').eq('user_id', user.id).maybeSingle()

  if (!existingStudent) {
    const { error: studentErr } = await supabase.from('students').insert({
      user_id: user.id,
      name,
      email: user.email!,
      phone: meta.phone ?? null,
      date_of_birth: meta.date_of_birth ?? null,
      city: meta.city ?? null,
      country: meta.country ?? null,
    })
    if (studentErr) console.error('[auth/callback] student insert error:', studentErr.message)
    else console.log('[auth/callback] student record created')
  } else {
    console.log('[auth/callback] student already exists:', existingStudent.id)
  }

  const roles: string[] = profile?.roles?.length ? profile.roles : ['student']
  if (roles.length > 1) {
    return NextResponse.redirect(`${origin}/select-role`)
  }

  const role = profile?.role ?? 'student'
  const dashboardMap: Record<string, string> = {
    hq: '/hq/dashboard',
    school: '/school/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
  }

  const dest = dashboardMap[role] ?? '/student/dashboard'
  console.log('[auth/callback] redirecting to:', dest)
  return NextResponse.redirect(`${origin}${dest}`)
}
