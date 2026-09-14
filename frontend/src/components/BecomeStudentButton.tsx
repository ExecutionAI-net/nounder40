'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'

// "Diventa anche allieva": aggiunge il profilo studente a un account che
// gia' esiste (insegnante, staff di scuola, HQ). Fino a ieri non c'era
// nessuna strada: /register rifiutava l'email e nessuno aggiungeva il ruolo.
// Due clic (il secondo conferma), poi si entra nel pannello allieva.
export default function BecomeStudentButton({
  className,
  compact = false,
  next = '/student/dashboard',
}: {
  className: string
  /** Solo icona (sidebar chiusa) */
  compact?: boolean
  /** Dove andare a profilo creato */
  next?: string
}) {
  const t = useTranslations('roleSwitcher')
  const router = useRouter()
  const { refreshUser } = useAuth()
  const [armed, setArmed] = useState(false)
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)

  // La conferma scade da sola: un clic distratto non resta "armato"
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(id)
  }, [armed])

  async function handleClick() {
    if (working) return
    if (!armed) { setArmed(true); setFailed(false); return }
    setWorking(true)
    try {
      await apiFetch('/auth/become-student/', { method: 'POST' })
      await refreshUser()
      router.push(next)
    } catch {
      setFailed(true)
      setArmed(false)
      setWorking(false)
    }
  }

  const label = working ? t('becomeStudentWorking') : failed ? t('becomeStudentFailed') : armed ? t('becomeStudentConfirm') : t('becomeStudent')

  return (
    <button type="button" onClick={handleClick} disabled={working} title={label} className={className}>
      <span aria-hidden>🎓</span>
      {!compact && <span className="truncate">{label}</span>}
    </button>
  )
}
