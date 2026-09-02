'use client'

import { useTranslations } from 'next-intl'
import CountrySelect from '@/components/ui/CountrySelect'

// "www.scuola.com" → "https://www.scuola.com" (usata da chi salva questi campi)
export function normalizeWebsite(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  if (!s) return null
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export type SchoolAddressValues = {
  address: string
  address_line2: string
  city: string
  province: string
  country: string
  vat_number: string
  website: string
}

export const EMPTY_SCHOOL_ADDRESS: SchoolAddressValues = {
  address: '', address_line2: '', city: '', province: '', country: '', vat_number: '', website: '',
}

// Shared address + VAT + website fields for a school. Free text everywhere
// except the country, which is an ISO code from a select: that code is what
// groups schools in HQ > Locations and what the calendar link ?country=XX
// uses. Used by the school profile page and the HQ school edit modal.
export default function SchoolAddressFields({
  values,
  onChange,
  inputClassName,
  labelClassName,
}: {
  values: SchoolAddressValues
  onChange: (values: SchoolAddressValues) => void
  inputClassName?: string
  labelClassName?: string
}) {
  const t = useTranslations('schoolAddress')

  const inputCls = inputClassName ?? 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = labelClassName ?? 'block text-xs text-gray-500 mb-1'

  function set(field: keyof SchoolAddressValues, value: string) {
    onChange({ ...values, [field]: value })
  }

  const fields: { key: keyof SchoolAddressValues; label: string; placeholder?: string; span2?: boolean; type?: string }[] = [
    { key: 'address', label: t('labelAddress'), placeholder: t('placeholderAddress'), span2: true },
    { key: 'address_line2', label: t('labelAddressLine2'), placeholder: t('placeholderAddressLine2'), span2: true },
    { key: 'city', label: t('labelCity') },
    { key: 'province', label: t('labelProvince'), placeholder: t('placeholderProvince') },
    { key: 'country', label: t('labelCountry') },
    { key: 'vat_number', label: t('labelVat'), placeholder: t('placeholderVat') },
    // type 'text' e non 'url': il browser bloccava il submit senza https://
    // (ora https:// viene aggiunto automaticamente al salvataggio)
    { key: 'website', label: t('labelWebsite'), placeholder: t('placeholderWebsite'), span2: true },
  ]

  return (
    <>
      {fields.map(({ key, label, placeholder, span2, type }) => (
        <div key={key} className={span2 ? 'sm:col-span-2' : ''}>
          <label className={labelCls}>{label}</label>
          {key === 'country' ? (
            <CountrySelect value={values.country} onChange={code => set('country', code)} className={`${inputCls} bg-white`} />
          ) : (
            <input
              type={type ?? 'text'}
              value={values[key]}
              onChange={e => set(key, e.target.value)}
              placeholder={placeholder}
              className={inputCls}
            />
          )}
        </div>
      ))}
    </>
  )
}
