'use client'

import { useState } from 'react'

// Campo telefono con prefisso internazionale separato + numero.
// Il valore esterno resta UNA stringa ("+39 331 1234567"): nessun cambio di
// schema DB — split in lettura, ricomposizione in scrittura.

const PREFIXES: { code: string; label: string }[] = [
  // Europa
  { code: '+39', label: '🇮🇹 +39' },
  { code: '+34', label: '🇪🇸 +34' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+41', label: '🇨🇭 +41' },
  { code: '+43', label: '🇦🇹 +43' },
  { code: '+32', label: '🇧🇪 +32' },
  { code: '+31', label: '🇳🇱 +31' },
  { code: '+351', label: '🇵🇹 +351' },
  { code: '+30', label: '🇬🇷 +30' },
  { code: '+353', label: '🇮🇪 +353' },
  { code: '+352', label: '🇱🇺 +352' },
  { code: '+356', label: '🇲🇹 +356' },
  { code: '+357', label: '🇨🇾 +357' },
  { code: '+45', label: '🇩🇰 +45' },
  { code: '+46', label: '🇸🇪 +46' },
  { code: '+47', label: '🇳🇴 +47' },
  { code: '+354', label: '🇮🇸 +354' },
  { code: '+358', label: '🇫🇮 +358' },
  { code: '+48', label: '🇵🇱 +48' },
  { code: '+420', label: '🇨🇿 +420' },
  { code: '+421', label: '🇸🇰 +421' },
  { code: '+36', label: '🇭🇺 +36' },
  { code: '+40', label: '🇷🇴 +40' },
  { code: '+359', label: '🇧🇬 +359' },
  { code: '+385', label: '🇭🇷 +385' },
  { code: '+386', label: '🇸🇮 +386' },
  { code: '+387', label: '🇧🇦 +387' },
  { code: '+382', label: '🇲🇪 +382' },
  { code: '+389', label: '🇲🇰 +389' },
  { code: '+383', label: '🇽🇰 +383' },
  { code: '+372', label: '🇪🇪 +372' },
  { code: '+371', label: '🇱🇻 +371' },
  { code: '+370', label: '🇱🇹 +370' },
  { code: '+380', label: '🇺🇦 +380' },
  { code: '+375', label: '🇧🇾 +375' },
  { code: '+373', label: '🇲🇩 +373' },
  { code: '+381', label: '🇷🇸 +381' },
  { code: '+355', label: '🇦🇱 +355' },
  { code: '+376', label: '🇦🇩 +376' },
  { code: '+377', label: '🇲🇨 +377' },
  { code: '+378', label: '🇸🇲 +378' },
  { code: '+350', label: '🇬🇮 +350' },
  { code: '+90', label: '🇹🇷 +90' },
  { code: '+7', label: '🇷🇺 +7' },
  // Nord America
  { code: '+1', label: '🇺🇸/🇨🇦 +1' },
  // America Latina
  { code: '+52', label: '🇲🇽 +52' },
  { code: '+502', label: '🇬🇹 +502' },
  { code: '+503', label: '🇸🇻 +503' },
  { code: '+504', label: '🇭🇳 +504' },
  { code: '+505', label: '🇳🇮 +505' },
  { code: '+506', label: '🇨🇷 +506' },
  { code: '+507', label: '🇵🇦 +507' },
  { code: '+501', label: '🇧🇿 +501' },
  { code: '+53', label: '🇨🇺 +53' },
  { code: '+509', label: '🇭🇹 +509' },
  { code: '+54', label: '🇦🇷 +54' },
  { code: '+55', label: '🇧🇷 +55' },
  { code: '+56', label: '🇨🇱 +56' },
  { code: '+57', label: '🇨🇴 +57' },
  { code: '+58', label: '🇻🇪 +58' },
  { code: '+51', label: '🇵🇪 +51' },
  { code: '+591', label: '🇧🇴 +591' },
  { code: '+593', label: '🇪🇨 +593' },
  { code: '+595', label: '🇵🇾 +595' },
  { code: '+598', label: '🇺🇾 +598' },
  { code: '+592', label: '🇬🇾 +592' },
  { code: '+597', label: '🇸🇷 +597' },
  { code: '+594', label: '🇬🇫 +594' },
  // Caraibi (NANP: +1 + prefisso d'area)
  { code: '+1 809', label: '🇩🇴 +1 809' },
  { code: '+1 829', label: '🇩🇴 +1 829' },
  { code: '+1 849', label: '🇩🇴 +1 849' },
  { code: '+1 787', label: '🇵🇷 +1 787' },
  { code: '+1 939', label: '🇵🇷 +1 939' },
  { code: '+1 876', label: '🇯🇲 +1 876' },
  { code: '+1 868', label: '🇹🇹 +1 868' },
  { code: '+1 242', label: '🇧🇸 +1 242' },
  { code: '+1 246', label: '🇧🇧 +1 246' },
  { code: '+1 268', label: '🇦🇬 +1 268' },
  { code: '+1 284', label: '🇻🇬 +1 284' },
  { code: '+1 345', label: '🇰🇾 +1 345' },
  { code: '+1 473', label: '🇬🇩 +1 473' },
  { code: '+1 649', label: '🇹🇨 +1 649' },
  { code: '+1 664', label: '🇲🇸 +1 664' },
  { code: '+1 721', label: '🇸🇽 +1 721' },
  { code: '+1 758', label: '🇱🇨 +1 758' },
  { code: '+1 767', label: '🇩🇲 +1 767' },
  { code: '+1 784', label: '🇻🇨 +1 784' },
  { code: '+1 869', label: '🇰🇳 +1 869' },
  { code: '+590', label: '🇬🇵 +590' },
  { code: '+596', label: '🇲🇶 +596' },
  { code: '+599', label: '🇨🇼 +599' },
  { code: '+297', label: '🇦🇼 +297' },
  // Africa
  { code: '+20', label: '🇪🇬 +20' },
  { code: '+212', label: '🇲🇦 +212' },
  { code: '+213', label: '🇩🇿 +213' },
  { code: '+216', label: '🇹🇳 +216' },
  { code: '+218', label: '🇱🇾 +218' },
  { code: '+221', label: '🇸🇳 +221' },
  { code: '+225', label: '🇨🇮 +225' },
  { code: '+233', label: '🇬🇭 +233' },
  { code: '+234', label: '🇳🇬 +234' },
  { code: '+237', label: '🇨🇲 +237' },
  { code: '+243', label: '🇨🇩 +243' },
  { code: '+244', label: '🇦🇴 +244' },
  { code: '+254', label: '🇰🇪 +254' },
  { code: '+255', label: '🇹🇿 +255' },
  { code: '+256', label: '🇺🇬 +256' },
  { code: '+258', label: '🇲🇿 +258' },
  { code: '+27', label: '🇿🇦 +27' },
  { code: '+238', label: '🇨🇻 +238' },
  // Medio Oriente e Asia
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+972', label: '🇮🇱 +972' },
  { code: '+966', label: '🇸🇦 +966' },
  { code: '+974', label: '🇶🇦 +974' },
  { code: '+965', label: '🇰🇼 +965' },
  { code: '+973', label: '🇧🇭 +973' },
  { code: '+968', label: '🇴🇲 +968' },
  { code: '+962', label: '🇯🇴 +962' },
  { code: '+961', label: '🇱🇧 +961' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+92', label: '🇵🇰 +92' },
  { code: '+94', label: '🇱🇰 +94' },
  { code: '+880', label: '🇧🇩 +880' },
  { code: '+81', label: '🇯🇵 +81' },
  { code: '+82', label: '🇰🇷 +82' },
  { code: '+86', label: '🇨🇳 +86' },
  { code: '+852', label: '🇭🇰 +852' },
  { code: '+886', label: '🇹🇼 +886' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+60', label: '🇲🇾 +60' },
  { code: '+62', label: '🇮🇩 +62' },
  { code: '+63', label: '🇵🇭 +63' },
  { code: '+66', label: '🇹🇭 +66' },
  { code: '+84', label: '🇻🇳 +84' },
  // Oceania
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+64', label: '🇳🇿 +64' },
]

const DEFAULT_PREFIX = '+39'

// Divide "+39 331 123..." in { prefix, number } (match sul prefisso più lungo)
function splitPhone(value: string | null | undefined): { prefix: string; number: string } {
  const v = (value ?? '').trim()
  if (!v.startsWith('+')) return { prefix: DEFAULT_PREFIX, number: v }
  const sorted = [...PREFIXES].sort((a, b) => b.code.length - a.code.length)
  const hit = sorted.find(p => v.startsWith(p.code))
  if (hit) return { prefix: hit.code, number: v.slice(hit.code.length).trim() }
  // prefisso sconosciuto: tienilo com'è (max 4 cifre dopo il +)
  const m = v.match(/^(\+\d{1,4})\s*(.*)$/)
  if (m) return { prefix: m[1], number: m[2] }
  return { prefix: DEFAULT_PREFIX, number: v }
}

export default function PhoneInput({
  value,
  onChange,
  className = '',
  inputClassName = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20',
  required = false,
  disabled = false,
  placeholder = '331 1234567',
}: {
  value: string
  onChange: (full: string) => void
  className?: string
  inputClassName?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const parsed = splitPhone(value)
  // il prefisso scelto va ricordato anche quando il numero è vuoto
  const [prefix, setPrefix] = useState(parsed.prefix)
  const number = parsed.number
  // se il valore esterno cambia prefisso (es. load async), allineati
  const effectivePrefix = value?.trim().startsWith('+') ? parsed.prefix : prefix

  const knownPrefix = PREFIXES.some(p => p.code === effectivePrefix)

  function emit(pfx: string, num: string) {
    const n = num.trim()
    onChange(n ? `${pfx} ${n}` : '')
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        value={effectivePrefix}
        disabled={disabled}
        onChange={e => { setPrefix(e.target.value); emit(e.target.value, number) }}
        className="px-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 shrink-0"
      >
        {!knownPrefix && <option value={effectivePrefix}>{effectivePrefix}</option>}
        {PREFIXES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
      </select>
      <input
        type="tel"
        value={number}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => { setPrefix(effectivePrefix); emit(effectivePrefix, e.target.value) }}
        className={inputClassName}
      />
    </div>
  )
}
