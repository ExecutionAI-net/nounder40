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

      const supabase = createClient()

      // Exchange code or verify OTP — client-side so PKCE code_verifier is accessible
      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as 'signup' | 'email' | 'recovery' | 'invite' | 'email_change' | 'magiclink',
        })
        if (error) {
          router.push('/login?error=auth&detail=' + encodeURIComponent(error.message))
          return
        }
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          router.push('/login?error=auth&detail=' + encodeURIComponent(error.message))
          return
        }
      } else {
        router.push('/login?error=auth&detail=no_params')
        return
      }

      // Auth succeeded — get user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login?error=auth')
        return
      }

      if (next === '/reset-password') {
        router.push('/reset-password')
        return
      }

      const meta = user.user_metadata ?? {}
      const isHQInvite = !!meta.hq_sub_role
      const isTeacherInvite = !!meta.teacher_invite
      const isSchoolInvite = !!meta.school_invite

      if (isTeacherInvite || isSchoolInvite || isHQInvite) {
        router.push('/setup-account')
        return
      }

      // Get profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, roles, name')
        .eq('id', user.id)
        .single()

      // For newly confirmed students: create student record + school link from metadata
      const confirmedAt = user.email_confirmed_at ? new Date(user.email_confirmed_at) : null
      const justVerified = confirmedAt && (Date.now() - confirmedAt.getTime()) < 120_000
      if (justVerified && profile?.role === 'student' && meta.school_id) {
        const schoolId = meta.school_id as string

        const { data: existingStudent } = await supabase
          .from('students')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle()

        let studentId = existingStudent?.id

        if (!studentId) {
          const { data: newStudent } = await supabase.from('students').insert({
            user_id: user.id,
            name: profile.name ?? meta.name ?? user.email!.split('@')[0],
            email: user.email!,
            phone: meta.phone ?? null,
            date_of_birth: meta.date_of_birth ?? null,
            city: meta.city ?? null,
            country: meta.country ?? null,
          }).select('id').single()
          studentId = newStudent?.id
        }

        if (studentId) {
          await supabase.from('school_students').upsert(
            { school_id: schoolId, student_id: studentId, free_lesson_used: false },
            { onConflict: 'school_id,student_id', ignoreDuplicates: true }
          )
        }
      }

      // Redirect based on role
      const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role ?? 'student']
      if (roles.length > 1) {
        router.push('/select-role')
        return
      }

      const role = profile?.role ?? 'student'
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
