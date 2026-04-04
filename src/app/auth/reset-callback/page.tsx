'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    async function handle() {
      const supabase = createClient()
      const code = new URLSearchParams(window.location.search).get('code')

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          router.replace('/login?error=reset_expired')
          return
        }
      } else {
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
