'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

// Campo "codice sconto" usato dove si paga: acquisto pacchetti e carrello del
// negozio. La verifica passa dallo stesso motore del checkout (backend
// commerce/discounts.py), quindi quello che l'allieva vede è quello che paga.

type CheckResult = { code: string; name: string; amount_off: number; total: number }

const ERROR_KEYS: Record<string, string> = {
  invalid_discount_code: 'errInvalid',
  discount_code_expired: 'errExpired',
  discount_code_wrong_scope: 'errScope',
  discount_code_exhausted: 'errExhausted',
  discount_code_minimum_not_met: 'errMinimum',
}

export default function DiscountCodeField({
  scope,
  schoolId,
  subtotal,
  applied,
  onApply,
}: {
  scope: 'packages' | 'subscriptions' | 'shop'
  schoolId?: string | null
  subtotal: number
  applied: { code: string; amount_off: number } | null
  onApply: (value: { code: string; amount_off: number } | null) => void
}) {
  const t = useTranslations('discountCodes')
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApply() {
    if (!code.trim()) return
    setChecking(true)
    setError(null)
    try {
      const res = await apiFetch<CheckResult>('/student/discount-code/check/', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), scope, school_id: schoolId || null, subtotal }),
      })
      onApply({ code: res.code, amount_off: Number(res.amount_off) })
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(t(ERROR_KEYS[errCode ?? ''] ?? 'errInvalid'))
      onApply(null)
    }
    setChecking(false)
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
        <p className="text-xs text-green-700">
          {t('appliedNotice', { code: applied.code, amount: applied.amount_off.toFixed(2) })}
        </p>
        <button
          type="button"
          onClick={() => { onApply(null); setCode(''); }}
          className="text-xs text-green-700 underline hover:no-underline shrink-0"
        >
          {t('remove')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApply() } }}
          placeholder={t('studentPlaceholder')}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={checking || !code.trim()}
          className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50 shrink-0"
        >
          {checking ? t('checking') : t('apply')}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  )
}
