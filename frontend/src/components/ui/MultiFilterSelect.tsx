'use client'

import { useEffect, useRef, useState } from 'react'

// Filtro a multiselezione con checkbox (usato nelle liste corsi/lezioni).
// Chiuso: mostra l'etichetta ("Tutti gli insegnanti") o "Etichetta · N".
// `prominent` = variante evidenziata (es. Tipo di lezione nella pagina Prenota).
// Le opzioni possono avere un'immagine (thumbnail nel menu, es. foto del corso).
export default function MultiFilterSelect({
  label,
  options,
  selected,
  onChange,
  prominent = false,
}: {
  label: string
  options: { value: string; label: string; image?: string | null }[]
  selected: string[]
  onChange: (values: string[]) => void
  prominent?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  const active = selected.length > 0
  const hasImages = options.some(o => o.image)

  const buttonCls = prominent
    ? `px-4 py-2 border-2 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand/20 transition flex items-center gap-1.5 font-semibold shadow-sm ${
        active ? 'border-brand text-brand bg-brand/5' : 'border-brand/40 text-gray-800'
      }`
    : `px-3 py-1.5 border rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20 transition flex items-center gap-1.5 ${
        active ? 'border-brand/40 text-brand font-medium' : 'border-gray-200 text-gray-600'
      }`

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className={buttonCls}>
        {active ? `${label} · ${selected.length}` : label}
        <span className={prominent ? 'text-brand/50' : 'text-gray-300'}>▾</span>
      </button>

      {open && (
        <div className={`absolute z-40 mt-1 ${hasImages ? 'min-w-[240px]' : 'min-w-[190px]'} max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1`}>
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 border-b border-gray-50"
            >
              ✕ {label}
            </button>
          )}
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="w-3.5 h-3.5 rounded border-gray-300 cursor-pointer shrink-0"
              />
              {hasImages && (
                opt.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.image} alt="" className="w-9 h-9 object-cover rounded-lg shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0" />
                )
              )}
              <span className="truncate">{opt.label}</span>
            </label>
          ))}
          {options.length === 0 && <p className="px-3 py-2 text-xs text-gray-300">—</p>}
        </div>
      )}
    </div>
  )
}
