'use client'

import { useEffect, useRef, useState } from 'react'

// Filtro a selezione multipla (regola piattaforma: i filtri sono sempre
// multiselezione). Bottone con conteggio + dropdown di checkbox.
export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`px-3 py-2 rounded-lg border text-sm bg-white flex items-center gap-2 transition ${
          selected.length ? 'border-[#6B1F3A]/40 text-[#6B1F3A] font-medium' : 'border-gray-200 text-gray-600'
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-[#6B1F3A] text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{selected.length}</span>
        )}
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-56 max-h-64 overflow-y-auto bg-white rounded-xl border border-gray-100 shadow-lg p-2">
          {options.length === 0 ? (
            <p className="text-xs text-gray-400 px-2 py-1.5">—</p>
          ) : options.map(o => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="w-4 h-4 rounded border-gray-300 accent-[#6B1F3A]"
              />
              <span className="text-sm text-gray-700 truncate">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
            >
              ✕ Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
