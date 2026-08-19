'use client'

import { useState, useEffect, Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { apiFetch, ApiError } from '@/lib/api/client'

function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const uid = searchParams.get('uid')
  const token = searchParams.get('token')

  useEffect(() => {
    if (!uid || !token) {
      router.replace('/login?error=reset_expired')
      return
    }
    setReady(true)
  }, [uid, token, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError(t('passwordTooShort')); return }
    if (password !== confirm) { setError(t('passwordMismatch')); return }

    setLoading(true)
    setError(null)

    try {
      await apiFetch('/auth/password-reset-confirm/', {
        method: 'POST',
        body: JSON.stringify({ uid, token, new_password: password }),
      })
      router.replace('/login?reset=success')
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        router.replace('/login?error=reset_expired')
        return
      }
      setError(t('passwordTooShort'))
      setLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-[#6B1F3A] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-2xl shadow-sm border border-gray-100 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="mt-2 text-sm text-gray-500">{t('title')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('newPasswordLabel')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('newPasswordPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPasswordLabel')}</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('confirmPasswordPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {loading ? t('saving') : t('saveButton')}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
