'use client'

import { useState, useEffect, Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { apiFetch, ApiError } from '@/lib/api/client'
import { setTokens } from '@/lib/api/tokens'
import { useAuth } from '@/lib/api/auth-context'

type CompleteInviteResponse = {
  user: { role: string; roles: string[]; [key: string]: unknown }
  access: string
  refresh: string
}

function SetupAccountForm() {
  const t = useTranslations('auth.setup')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setUser } = useAuth()
  const uid = searchParams.get('uid')
  const token = searchParams.get('token')

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid || !token) { router.replace('/login'); return }
    setReady(true)
  }, [uid, token, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError(t('nameRequired')); return }
    if (password.length < 8) { setError(t('passwordTooShort')); return }
    if (password !== confirm) { setError(t('passwordMismatch')); return }

    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<CompleteInviteResponse>('/auth/complete-invite/', {
        method: 'POST',
        body: JSON.stringify({ uid, token, full_name: name.trim(), password }),
      })
      setTokens(data.access, data.refresh)
      setUser(data.user as Parameters<typeof setUser>[0])
      const roles = data.user.roles?.length ? data.user.roles : [data.user.role]
      router.replace(roles.length > 1 ? '/select-role' : `/${roles[0] ?? 'student'}/dashboard`)
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body ? (err.body as { error?: string }) : null
      setError(body?.error === 'invalid_link' || body?.error === 'invalid_or_expired_token' ? t('linkExpired') : t('setupFailed'))
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          <h2 className="text-base font-semibold text-gray-800 mb-1">{t('welcome')}</h2>
          <p className="text-sm text-gray-400 mb-6">{t('welcomeDesc')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('fullNameLabel')}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('fullNamePlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('passwordLabel')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('passwordPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPasswordLabel')}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('confirmPasswordPlaceholder')}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition mt-2"
            >
              {loading ? t('settingUp') : t('completeSetup')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function SetupAccountPage() {
  return (
    <Suspense>
      <SetupAccountForm />
    </Suspense>
  )
}
