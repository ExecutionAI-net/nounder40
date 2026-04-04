'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function handle() {
      const supabase = createClient()
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const token_hash = params.get('token_hash')

      console.log('[reset-callback] params:', { code: !!code, token_hash: !!token_hash })

      if (token_hash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
        if (error) {
          console.error('[reset-callback] verifyOtp error:', error.message)
          router.replace('/login?error=reset_expired')
          return
        }
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          console.error('[reset-callback] exchangeCode error:', error.message)
          router.replace('/login?error=reset_expired')
          return
        }
      } else {
        console.error('[reset-callback] no code or token_hash')
        router.replace('/login?error=reset_expired')
        return
      }

      router.replace('/reset-password')
    }
    handle()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-2 border-[#6B1F3A] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
