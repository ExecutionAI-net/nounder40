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
  country: string | null
  language_preference: string
}

// Dati anagrafici dell'allieva. Stesso identico blocco nel profilo dell'allieva
// (modificabile) e nella scheda vista dalla scuola (in sola lettura).
export default function StudentProfileFields({
  value,
  onChange,
  readOnly = false,
  editableEmail = false,
  countries = [],
  cities = [],
}: {
  value: ProfileFields
  onChange?: (next: ProfileFields) => void
  readOnly?: boolean
  /** L'email è la credenziale di accesso: la cambia solo la scuola */
  editableEmail?: boolean
  countries?: { id: string; name: string }[]
  cities?: { id: string; name: string; country_id: string }[]
}) {
  const t = useTranslations('student.profile')
  const set = (patch: Partial<ProfileFields>) => onChange?.({ ...value, ...patch })

  const input = `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm ${readOnly ? 'bg-gray-50 text-gray-500' : ''}`
  const matchedCountry = countries.find(c => c.name === value.country)
  const filteredCities = matchedCountry ? cities.filter(c => c.country_id === matchedCountry.id) : []

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

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('dateOfBirth')}</label>
        <input type="date" className={input} value={value.date_of_birth ?? ''} disabled={readOnly}
          onChange={e => set({ date_of_birth: e.target.value })} />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">{t('address')}</label>
        <input className={input} value={value.address ?? ''} disabled={readOnly}
          onChange={e => set({ address: e.target.value })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('country')}</label>
          {countries.length === 0 ? (
            <input className={input} value={value.country ?? ''} disabled={readOnly}
              onChange={e => set({ country: e.target.value })} />
          ) : (
            <select className={`${input} bg-white`} value={value.country ?? ''} disabled={readOnly}
              onChange={e => set({ country: e.target.value, city: '' })}>
              <option value="">{t('selectCountry')}</option>
              {countries.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('city')}</label>
          {countries.length === 0 ? (
            <input className={input} value={value.city ?? ''} disabled={readOnly}
              onChange={e => set({ city: e.target.value })} />
          ) : (
            <select
              className={`${input} bg-white disabled:opacity-50`}
              value={value.city ?? ''}
              disabled={readOnly || !value.country || filteredCities.length === 0}
              onChange={e => set({ city: e.target.value })}
            >
              {!value.country ? (
                <option value="">{t('selectCountryFirst')}</option>
              ) : filteredCities.length === 0 ? (
                <option value="">{t('noCitiesAvailable')}</option>
              ) : (
                <>
                  <option value="">{t('selectCity')}</option>
                  {filteredCities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </>
              )}
            </select>
          )}
        </div>
      </div>

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
