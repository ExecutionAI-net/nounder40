'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

type Status = 'sending' | 'success' | 'unknown-error' | 'error'

export default function SendInviteOnNew({ schoolId }: { schoolId: string }) {
  const t = useTranslations('hq.schools')
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('new') !== '1') return

    setStatus('sending')
    apiFetch<{ success?: boolean }>(`/hq/schools/${schoolId}/resend-invite/`, { method: 'POST' })
      .then(d => {
        setStatus(d.success ? 'success' : 'unknown-error')
      })
      .catch(e => {
        const body = e instanceof ApiError ? e.body as { error?: string } : null
        setErrorDetail(body?.error ?? e.message)
        setStatus('error')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) return null

  const isError = status === 'unknown-error' || status === 'error'
  const text =
    status === 'sending' ? t('sendingInviteEmail')
    : status === 'success' ? t('inviteSentSuccess')
    : status === 'unknown-error' ? t('inviteErrorUnknown')
    : t('inviteErrorPrefix', { error: errorDetail ?? '' })

  return (
    <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${isError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
      {text}
    </div>
  )
}
