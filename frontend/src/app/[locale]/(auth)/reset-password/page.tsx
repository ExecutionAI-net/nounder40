'use client'

import { useState, useEffect, Suspense } from 'react'
import { useTranslations } from 'next-intl'
import { passwordProblem } from '@/lib/password'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { apiFetch, ApiError } from '@/lib/api/client'
import { setTokens } from '@/lib/api/tokens'
import { useAuth, type AuthUser } from '@/lib/api/auth-context'
import PasswordInput from '@/components/ui/PasswordInput'

function ResetPasswordForm() {
  const t = useTranslations('auth.resetPassword')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setUser } = useAuth()
  const uid = searchParams.get('uid')
  const token = searchParams.get('token')

  // ST-R3-07: prima si controllava solo che uid e token ci fossero, quindi un
  // link gia' usato ridisegnava il modulo e la persona scopriva che era morto
  // solo dopo aver scelto una password e premuto salva. Il backend sa gia'
  // rispondere (`invalid_or_expired_token`): glielo si chiede subito, e la
  // risposta e' la stessa pagina di sempre — /login?error=reset_expired.
  // Verificare un token non lo consuma.
  useEffect(() => {
    if (!uid || !token) {
      router.replace('/login?error=reset_expired')
      return
    }
    let cancelled = false
    apiFetch('/auth/password-reset-validate/', {
      method: 'POST',
      body: JSON.stringify({ uid, token }),
    })
      .then(() => { if (!cancelled) setReady(true) })
      .catch(err => {
        if (cancelled) return
        // Un link davvero scaduto va detto; una rete che non risponde no —
        // meglio il modulo, che al salvataggio dara' comunque l'esito giusto.
        if (err instanceof ApiError && err.status === 400) router.replace('/login?error=reset_expired')
        else setReady(true)
      })
    return () => { cancelled = true }
  }, [uid, token, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password)
    if (problem) { setError(t(problem === 'short' ? 'passwordTooShort' : 'passwordWeak')); return }
    if (password !== confirm) { setError(t('passwordMismatch')); return }

    setLoading(true)
    setError(null)

    try {
      type ConfirmResponse = { access?: string; refresh?: string; user?: AuthUser }
      const data = await apiFetch<ConfirmResponse>('/auth/password-reset-confirm/', {
        method: 'POST',
        body: JSON.stringify({ uid, token, new_password: password }),
      })
      // Password nuova = accesso immediato (il backend restituisce i token
      // come il login): un'allieva atterra dritta sul calendario.
      // Il profilo arriva già nella risposta: nessuna chiamata a /auth/me/,
      // che se fallisce (rate limit, rete) lascerebbe user=null e la guard
      // rimbalzerebbe al login una persona appena autenticata.
      if (data.access && data.refresh && data.user) {
        setTokens(data.access, data.refresh)
        setUser(data.user)
        const roles = data.user.roles?.length ? data.user.roles : [data.user.role ?? 'student']
        if (roles.length > 1) router.replace('/select-role')
        else if (roles[0] === 'student') router.replace('/student/book')
        else router.replace(`/${roles[0]}/dashboard`)
        return
      }
      router.replace('/login?reset=success')
    } catch (err) {
      // Ogni esito ha il suo messaggio: prima qualsiasi 400 mandava al login
      // senza spiegazione (anche una password rifiutata dal validatore) e ogni
      // altro errore diceva "password troppo corta".
      const code = err instanceof ApiError && typeof err.body === 'object' && err.body && 'error' in err.body
        ? String((err.body as { error: unknown }).error) : null
      if (code === 'invalid_link' || code === 'invalid_or_expired_token') {
        router.replace('/login?error=reset_expired')
        return
      }
      if (code === 'weak_password') {
        const body = (err as ApiError).body as { codes?: unknown; detail?: unknown }
        const codes = Array.isArray(body.codes) ? body.codes.map(String) : []
        const key = codes.includes('password_too_similar') ? 'passwordTooSimilar'
          : codes.includes('password_too_common') ? 'passwordTooCommon'
          : codes.includes('password_too_short') ? 'passwordTooShort'
          : codes.includes('password_entirely_numeric') ? 'passwordWeak'
          : null
        const reasons = Array.isArray(body.detail) ? body.detail.map(String).join(' ') : ''
        setError(key ? t(key) : reasons ? `${t('passwordRejected')} ${reasons}` : t('passwordRejected'))
      } else if (err instanceof ApiError && (err.status === 429 || err.status === 503)) {
        setError(t('tooManyAttempts'))
      } else {
        setError(t('genericError'))
      }
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
            <PasswordInput
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('newPasswordPlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPasswordLabel')}</label>
            <PasswordInput
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
