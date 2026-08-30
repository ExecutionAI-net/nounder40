'use client'

import { useLocale } from 'next-intl'
import { countryOptions, flagOf } from '@/lib/countries'

// Select paese: il valore e' SEMPRE il codice ISO (IT, ES…), il nome e'
// nella lingua di chi guarda. Un valore vecchio scritto a mano ("Italia")
// resta visibile finche' non lo si sostituisce, cosi' non si perde nulla.
export default function CountrySelect({
  value,
  onChange,
  className,
  name,
  allowEmpty = true,
}: {
  value: string
  onChange: (code: string) => void
  className?: string
  name?: string
  allowEmpty?: boolean
}) {
  const locale = useLocale()
  const options = countryOptions(locale)
  const known = options.some(o => o.code === value.toUpperCase())
  return (
    <select name={name} value={known ? value.toUpperCase() : value} onChange={e => onChange(e.target.value)} className={className}>
      {allowEmpty && <option value="">—</option>}
      {!known && value && <option value={value}>{flagOf(value)} {value}</option>}
      {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  )
}
