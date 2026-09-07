'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import PasswordInput from '@/components/ui/PasswordInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import { passwordProblem } from '@/lib/password'

/**
 * "Cambia password" — un solo riquadro per tutti e quattro i pannelli
 * (allieva, insegnante, scuola, HQ). L'e-mail di benvenuto dice da sempre che
 * la password si cambia dalla propria area, ma l'unica strada era il "password
 * dimenticata" (QA R2-L10): l'endpoint c'era, l'interfaccia no.
 *
 * Gli errori del backend NON si stampano mai grezzi (QA R2-M15): arrivano in
 * inglese da `validate_password` e vengono ricondotti qui alle chiavi
 * tradotte, esattamente come fa la pagina di reset.
 */

type ChangePasswordBody = {
  detail?: unknown
  new_password?: unknown
  current_password?: unknown
}

/** Messaggi di django.contrib.auth + accounts.validators → chiave i18n. */
function messageKey(message: string): string | null {
  const m = message.toLowerCase()
  if (m.includes('too similar')) return 'errorTooSimilar'
  if (m.includes('too short')) return 'errorTooShort'
  if (m.includes('too common')) return 'errorTooCommon'
  if (m.includes('entirely numeric')) return 'errorNumeric'
  return null
}

export default function ChangePasswordCard({ className = '' }: { className?: string }) {
  const t = useTranslations('account')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDone(false)

    // Stesse regole mostrate su registrazione e reset: 8+ caratteri, lettere e
    // numeri. Meglio dirlo prima del giro di rete.
    const problem = passwordProblem(next)
    if (problem) { setError(t(problem === 'short' ? 'errorTooShort' : 'errorWeak')); return }
    if (next !== confirm) { setError(t('errorMismatch')); return }

    setSaving(true)
    setError(null)
    try {
      await apiFetch('/auth/change-password/', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(translateError(err))
    }
    setSaving(false)
  }

  function translateError(err: unknown): string {
    if (!(err instanceof ApiError)) return t('errorGeneric')
    if (err.status === 429 || err.status === 503) return t('errorTooManyAttempts')
    const body = (typeof err.body === 'object' && err.body ? err.body : {}) as ChangePasswordBody

    // La password attuale sbagliata torna come {"detail": "..."} dalla view.
    if (typeof body.detail === 'string') {
      return body.detail.toLowerCase().includes('current password')
        ? t('errorCurrentPassword')
        : t('errorGeneric')
    }

    const messages = Array.isArray(body.new_password) ? body.new_password.map(String) : []
    for (const message of messages) {
      const key = messageKey(message)
      if (key) return t(key)
    }
    if (messages.length) return t('errorRejected')
    if (Array.isArray(body.current_password)) return t('errorCurrentPassword')
    return t('errorGeneric')
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20'
  const labelCls = 'block text-xs text-gray-400 mb-1'

  return (
    <form onSubmit={handleSubmit} className={`bg-white rounded-xl border border-gray-100 p-6 space-y-4 ${className}`}>
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}
      {done && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">{t('success')}</div>}

      <div>
        <label className={labelCls} htmlFor="account-current-password">{t('currentLabel')}</label>
        <PasswordInput
          id="account-current-password"
          required
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="account-new-password">{t('newLabel')}</label>
        <PasswordInput
          id="account-new-password"
          required
          autoComplete="new-password"
          value={next}
          onChange={e => setNext(e.target.value)}
          className={inputCls}
        />
        <p className="text-xs text-gray-400 mt-1">{t('hint')}</p>
      </div>

      <div>
        <label className={labelCls} htmlFor="account-confirm-password">{t('confirmLabel')}</label>
        <PasswordInput
          id="account-confirm-password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className={inputCls}
        />
      </div>

      <button
        type="submit"
        disabled={saving || !current || !next || !confirm}
        className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
      >
        {saving ? t('submitting') : t('submit')}
      </button>
    </form>
  )
}
