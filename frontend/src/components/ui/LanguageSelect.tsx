'use client'

import { LANGUAGES } from '@/lib/languages'

// Lingua di un account (email, inviti, pagina di attivazione): un blocco
// solo, lo stesso nel modulo di invito della scuola, nella modale di
// modifica dell'insegnante e nel profilo che l'insegnante vede lei stessa.
// Etichetta e suggerimento li passa chi lo monta, con il proprio namespace.
export default function LanguageSelect({
  value,
  onChange,
  label,
  hint,
  disabled = false,
  className = 'w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]',
  labelClassName = 'block text-sm font-medium text-gray-700 mb-1',
}: {
  value: string
  onChange: (value: string) => void
  label: string
  hint?: string
  disabled?: boolean
  className?: string
  labelClassName?: string
}) {
  return (
    <div>
      <label className={labelClassName}>{label}</label>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        className={`${className} ${disabled ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}>
        {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
