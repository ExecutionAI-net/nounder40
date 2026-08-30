'use client'

import { useTranslations } from 'next-intl'
import type { ProfileFields } from './StudentProfileFields'

// Indirizzo di spedizione, tutto testo libero: serve solo se un giorno
// l'allieva compra qualcosa dal negozio, quindi niente liste chiuse di
// paesi/città e nessun campo obbligatorio.
export default function StudentAddressFields({
  value,
  onChange,
  readOnly = false,
}: {
  value: ProfileFields
  onChange?: (next: ProfileFields) => void
  readOnly?: boolean
}) {
  const t = useTranslations('student.profile')
  const set = (patch: Partial<ProfileFields>) => onChange?.({ ...value, ...patch })
  const input = `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ${readOnly ? 'bg-gray-50 text-gray-500' : ''}`
  const field = (key: 'address' | 'postal_code' | 'city' | 'province' | 'country', label: string, autoComplete: string) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input className={input} value={value[key] ?? ''} disabled={readOnly} autoComplete={autoComplete}
        onChange={e => set({ [key]: e.target.value })} />
    </div>
  )

  return (
    <div className="space-y-4">
      {field('address', t('address'), 'street-address')}
      <div className="grid grid-cols-3 gap-3">
        {field('postal_code', t('postalCode'), 'postal-code')}
        <div className="col-span-2">{field('city', t('city'), 'address-level2')}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field('province', t('province'), 'address-level1')}
        {field('country', t('country'), 'country-name')}
      </div>
    </div>
  )
}
