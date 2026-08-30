'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'

// I link nelle email portano il destinatario (?for=email). Se nel browser
// c'e' la sessione di un ALTRO account, chi clicca si ritroverebbe nel
// profilo sbagliato senza accorgersene: questo banner lo dice e offre il
// cambio account. Il parametro e' solo informativo, non autentica nessuno.
export default function AccountMismatchBanner() {
  const t = useTranslations('layout')
  const router = useRouter()
  const { user, logout } = useAuth()
  const [intended, setIntended] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIntended(params.get('for'))
  }, [])

  if (!intended || !user?.email || intended.toLowerCase() === user.email.toLowerCase()) return null

  async function switchAccount() {
    const here = window.location.pathname + window.location.search
    await logout()
    router.push(`/login?next=${encodeURIComponent(here)}`)
  }

  return (
    <div className="mx-4 mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-amber-800">
        {t('wrongAccount', { current: user.email, intended })}
      </p>
      <button
        onClick={switchAccount}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition"
      >
        {t('switchAccount')}
      </button>
    </div>
  )
}
