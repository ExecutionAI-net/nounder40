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

      if (next === '/reset-password' || type === 'recovery') {
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
      console.log('[auth/callback] profile role:', profile?.role)

      // Non-invite student signup: ensure profile role + student record are set up
      const name = meta.name ?? profile?.name ?? user.email!.split('@')[0]

      const { error: profileUpdateErr } = await supabase
        .from('profiles')
        .update({ role: 'student', name })
        .eq('id', user.id)
      if (profileUpdateErr) console.error('[auth/callback] profile update error:', profileUpdateErr.message)
      else console.log('[auth/callback] profile updated: role=student name=', name)

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
        router.push('/select-role')
        return
      }

      const role = 'student'
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
