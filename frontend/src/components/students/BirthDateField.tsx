'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

// Data di nascita — vive nel tab Documenti (è un dato "documentale", non serve
// alla registrazione). Riusato dal profilo allieva e dalla scheda allieva
// lato scuola: salva da solo al cambio, tramite la onSave del chiamante
// (endpoint diversi nei due pannelli).
export default function BirthDateField({ value, onSave, readOnly = false }: {
  value: string | null
  onSave: (value: string | null) => Promise<void>
  readOnly?: boolean
}) {
  const t = useTranslations('student.profile')
  const [current, setCurrent] = useState(value ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  async function handleChange(v: string) {
    setCurrent(v)
    setState('saving')
    try {
      await onSave(v || null)
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 2500)
    } catch {
      setState('error')
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{t('dateOfBirth')}</label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={current}
          disabled={readOnly || state === 'saving'}
          onChange={e => handleChange(e.target.value)}
          className={`w-full max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm ${readOnly ? 'bg-gray-50 text-gray-500' : ''}`}
        />
        {state === 'saving' && <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />}
        {state === 'saved' && <span className="text-green-600 text-sm">✓</span>}
      </div>
      {state === 'error' && <p className="text-xs text-red-600 mt-1">{t('birthDateError')}</p>}
    </div>
  )
}
