'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function handle() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const token_hash = params.get('token_hash')
      const type = params.get('type')
      const next = params.get('next')

      console.log('[auth/callback] params:', { code: !!code, token_hash: !!token_hash, type, next })

      const supabase = createClient()

      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as 'signup' | 'email' | 'recovery' | 'invite' | 'email_change' | 'magiclink',
        })
        if (error) {
          console.error('[auth/callback] verifyOtp error:', error.message)
          router.push('/login?error=auth&detail=' + encodeURIComponent(error.message))
          return
        }
        console.log('[auth/callback] verifyOtp success')
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[auth/callback] exchangeCodeForSession error:', error.message)
          router.push('/login?error=auth&detail=' + encodeURIComponent(error.message))
          return
        }
        console.log('[auth/callback] exchangeCodeForSession success')
      } else {
        console.error('[auth/callback] no code or token_hash in URL')
        router.push('/login?error=auth&detail=no_params')
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        console.error('[auth/callback] getUser returned null after auth')
        router.push('/login?error=auth')
        return
      }
      console.log('[auth/callback] user:', user.id, user.email)

      if (next === '/reset-password') {
        router.push('/reset-password')
        return
      }

      const meta = user.user_metadata ?? {}
      const isHQInvite = !!meta.hq_sub_role
      const isTeacherInvite = !!meta.teacher_invite
      const isSchoolInvite = !!meta.school_invite

      if (isTeacherInvite || isSchoolInvite || isHQInvite) {
        console.log('[auth/callback] invite detected, redirecting to setup-account')
        router.push('/setup-account')
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, roles, name')
        .eq('id', user.id)
        .single()

      if (profileError) console.error('[auth/callback] profile fetch error:', profileError.message)
      console.log('[auth/callback] profile:', profile?.role)

      // For newly confirmed students: create student record + school link from metadata
      const confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null
      const justVerified = confirmedAt && (Date.now() - confirmedAt.getTime()) < 120_000
      console.log('[auth/callback] justVerified:', justVerified, 'school_id in meta:', meta.school_id)

      if (justVerified && profile?.role === 'student' && meta.school_id) {
        const schoolId = meta.school_id as string

        const { data: existingStudent } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle()

        let studentId = existingStudent?.id
        console.log('[auth/callback] existingStudent:', studentId)

        if (!studentId) {
          const { data: newStudent, error: studentErr } = await supabase.from('students').insert({
            user_id: user.id,
            name: profile.name ?? meta.name ?? user.email!.split('@')[0],
            email: user.email!,
            phone: meta.phone ?? null,
            date_of_birth: meta.date_of_birth ?? null,
            city: meta.city ?? null,
            country: meta.country ?? null,
          }).select('id').single()

          if (studentErr) console.error('[auth/callback] student insert error:', studentErr.message)
          studentId = newStudent?.id
          console.log('[auth/callback] created student:', studentId)
        }

        if (studentId) {
          const { error: ssErr } = await supabase.from('school_students').upsert(
            { school_id: schoolId, student_id: studentId, free_lesson_used: false },
            { onConflict: 'school_id,student_id', ignoreDuplicates: true }
          )
          if (ssErr) console.error('[auth/callback] school_students upsert error:', ssErr.message)
          else console.log('[auth/callback] school_students linked:', studentId, '->', schoolId)
        } else {
          console.error('[auth/callback] no studentId, skipping school_students link')
        }
      }

      const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
      if (roles.length > 1) {
        router.push('/select-role')
        return
      }

      const role = profile?.role ?? 'student'
      console.log('[auth/callback] redirecting to:', `/${role}/dashboard`)
      router.push(`/${role}/dashboard`)
    }

    handle()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[#6B1F3A] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">Signing you in...</p>
      </div>
    </div>
  )
}
