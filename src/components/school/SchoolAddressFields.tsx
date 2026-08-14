'use client'

import { useEffect, useState } from 'react'
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

type HQCountry = { id: string; name: string; code: string }
type HQCity = { id: string; country_id: string; name: string }

// Shared address + VAT + website fields for a school. Used by the school
// profile page and the HQ school edit modal. Country/city come from the
// HQ-managed lists (/api/locations) and gracefully fall back to free-text
// inputs when the lists are empty.
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
  const [countries, setCountries] = useState<HQCountry[]>([])
  const [cities, setCities] = useState<HQCity[]>([])

  useEffect(() => {
    fetch('/api/locations', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setCountries(d.countries ?? [])
        setCities(d.cities ?? [])
      })
      .catch(() => {})
  }, [])

  const inputCls = inputClassName ?? 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = labelClassName ?? 'block text-xs text-gray-500 mb-1'

  const selectedCountry = countries.find(c => c.name === values.country || c.code === values.country)
  const filteredCities = selectedCountry ? cities.filter(c => c.country_id === selectedCountry.id) : []

  function set(field: keyof SchoolAddressValues, value: string) {
    if (field === 'country') {
      onChange({ ...values, country: value, city: '' })
    } else {
      onChange({ ...values, [field]: value })
    }
  }

  return (
    <>
      <div className="col-span-2">
        <label className={labelCls}>{t('labelAddress')}</label>
        <input value={values.address} onChange={e => set('address', e.target.value)}
          placeholder={t('placeholderAddress')} className={inputCls} />
      </div>
      <div className="col-span-2">
        <label className={labelCls}>{t('labelAddressLine2')}</label>
        <input value={values.address_line2} onChange={e => set('address_line2', e.target.value)}
          placeholder={t('placeholderAddressLine2')} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>{t('labelCountry')}</label>
        {countries.length === 0 ? (
          <input value={values.country} onChange={e => set('country', e.target.value)}
            placeholder={t('labelCountry')} className={inputCls} />
        ) : (
          <select value={selectedCountry?.name ?? values.country} onChange={e => set('country', e.target.value)}
            className={`${inputCls} bg-white`}>
            <option value="">{t('selectCountry')}</option>
            {countries.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}
      </div>
      <div>
        <label className={labelCls}>{t('labelCity')}</label>
        {filteredCities.length === 0 ? (
          <input value={values.city} onChange={e => set('city', e.target.value)}
            placeholder={t('labelCity')} className={inputCls} />
        ) : (
          <select value={values.city} onChange={e => set('city', e.target.value)}
            className={`${inputCls} bg-white`}>
            <option value="">{t('selectCity')}</option>
            {filteredCities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            {values.city && !filteredCities.some(c => c.name === values.city) && (
              <option value={values.city}>{values.city}</option>
            )}
          </select>
        )}
      </div>
      <div>
        <label className={labelCls}>{t('labelProvince')}</label>
        <input value={values.province} onChange={e => set('province', e.target.value)}
          placeholder={t('placeholderProvince')} className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>{t('labelVat')}</label>
        <input value={values.vat_number} onChange={e => set('vat_number', e.target.value)}
          placeholder={t('placeholderVat')} className={inputCls} />
      </div>
      <div className="col-span-2">
        <label className={labelCls}>{t('labelWebsite')}</label>
        <input value={values.website} onChange={e => set('website', e.target.value)}
          placeholder={t('placeholderWebsite')} type="url" className={inputCls} />
      </div>
    </>
  )
}
