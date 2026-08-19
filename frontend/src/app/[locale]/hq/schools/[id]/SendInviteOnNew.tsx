'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch, ApiError } from '@/lib/api/client'

export default function SendInviteOnNew({ schoolId }: { schoolId: string }) {
  const searchParams = useSearchParams()
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('new') !== '1') return

    setMsg('Sending invite email...')
    apiFetch<{ success?: boolean }>(`/hq/schools/${schoolId}/resend-invite/`, { method: 'POST' })
      .then(d => {
        if (d.success) setMsg('Invite email sent successfully.')
        else setMsg('Email error: unknown')
      })
      .catch(e => {
        const body = e instanceof ApiError ? e.body as { error?: string } : null
        setMsg(`Email error: ${body?.error ?? e.message}`)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!msg) return null

  const isError = msg.startsWith('Email error')
  return (
    <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${isError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
      {msg}
    </div>
  )
}
