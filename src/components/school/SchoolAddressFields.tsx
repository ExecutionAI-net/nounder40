'use client'

import { useTranslations } from 'next-intl'

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

// Shared address + VAT + website fields for a school (free-text everywhere —
// per Carlo: no fixed country/city lists). Used by the school profile page
// and the HQ school edit modal.
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
    { key: 'website', label: t('labelWebsite'), placeholder: t('placeholderWebsite'), span2: true, type: 'url' },
  ]

  return (
    <>
      {fields.map(({ key, label, placeholder, span2, type }) => (
        <div key={key} className={span2 ? 'col-span-2' : ''}>
          <label className={labelCls}>{label}</label>
          <input
            type={type ?? 'text'}
            value={values[key]}
            onChange={e => set(key, e.target.value)}
            placeholder={placeholder}
            className={inputCls}
          />
        </div>
      ))}
    </>
  )
}
