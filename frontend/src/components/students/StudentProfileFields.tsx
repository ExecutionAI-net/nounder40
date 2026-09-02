'use client'

import { useTranslations } from 'next-intl'
import PhoneInput from '@/components/ui/PhoneInput'
import { LANGUAGES } from '@/lib/languages'

export type ProfileFields = {
  name: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  address: string | null
  city: string | null
  postal_code: string | null
  province: string | null
  country: string | null
  language_preference: string
}

// Dati anagrafici dell'allieva. Stesso identico blocco nel profilo dell'allieva
// (modificabile) e nella scheda vista dalla scuola (in sola lettura).
// L'indirizzo sta a parte (StudentAddressFields): è solo per le spedizioni.
export default function StudentProfileFields({
  value,
  onChange,
  readOnly = false,
  editableEmail = false,
}: {
  value: ProfileFields
  onChange?: (next: ProfileFields) => void
  readOnly?: boolean
  /** L'email è la credenziale di accesso: la cambia solo la scuola */
  editableEmail?: boolean
}) {
  const t = useTranslations('student.profile')
  const set = (patch: Partial<ProfileFields>) => onChange?.({ ...value, ...patch })

  const input = `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ${readOnly ? 'bg-gray-50 text-gray-500' : ''}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('firstName')}</label>
          <input className={input} value={value.first_name} disabled={readOnly} autoComplete="given-name"
            onChange={e => set({ first_name: e.target.value, name: `${e.target.value} ${value.last_name}`.trim() })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('lastName')}</label>
          <input className={input} value={value.last_name} disabled={readOnly} autoComplete="family-name"
            onChange={e => set({ last_name: e.target.value, name: `${value.first_name} ${e.target.value}`.trim() })} />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('email')}</label>
        {editableEmail ? (
          <>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={value.email}
              onChange={e => set({ email: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">{t('emailIsLogin')}</p>
          </>
        ) : (
          // Per l'allieva è in sola lettura: è la credenziale di accesso
          <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400" value={value.email} disabled />
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('phone')}</label>
        {readOnly ? (
          <input className={input} value={value.phone ?? ''} disabled />
        ) : (
          <PhoneInput
            inputClassName="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={value.phone ?? ''}
            onChange={phone => set({ phone })}
          />
        )}
      </div>

      {/* La data di nascita sta nel tab Documenti (BirthDateField): un campo
          in meno alla registrazione, che riusa questo stesso blocco */}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('language')}</label>
        <select className={input} value={value.language_preference} disabled={readOnly}
          onChange={e => set({ language_preference: e.target.value })}>
          {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        {!readOnly && <p className="text-xs text-gray-400 mt-1">{t('languageHint')}</p>}
      </div>
    </div>
  )
}
