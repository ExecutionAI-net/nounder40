'use client'

import { useEffect, useRef, useState } from 'react'

// Menu "Colonne" con una checkbox per colonna: cosa togliere dalla tabella e,
// con lei, dal CSV e dal PDF (Rapporti › Lezioni, Carlo 2026-10-31).
// Lavora sulle colonne *nascoste*, non su quelle visibili: una colonna aggiunta
// in futuro compare da sola anche a chi aveva già salvato la propria scelta.
// `locked` = sempre visibile (l'identità della riga, es. il nome della lezione).
export type PickableColumn = { key: string; label: string; locked?: boolean }

export default function ColumnPicker({
  label,
  showAllLabel,
  columns,
  hidden,
  onChange,
  footer,
  extraAction,
}: {
  label: string
  showAllLabel: string
  columns: PickableColumn[]
  hidden: string[]
  onChange: (hidden: string[]) => void
  footer?: string  // a quiet line under the list, e.g. "saved in this browser"
  extraAction?: { label: string; onClick: () => void }  // e.g. "reset column widths"
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

  function toggle(key: string) {
    onChange(hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key])
  }

  const visibleCount = columns.filter(c => !hidden.includes(c.key)).length
  const trimmed = visibleCount < columns.length

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`text-sm px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 ${trimmed
          ? 'border-brand/40 text-brand font-medium bg-white'
          : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
      >
        {label}
        {trimmed && <span className="text-xs tabular-nums">· {visibleCount}/{columns.length}</span>}
        <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          {trimmed && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-brand hover:bg-gray-50 border-b border-gray-100"
            >
              {showAllLabel}
            </button>
          )}
          {columns.map(c => {
            const checked = !hidden.includes(c.key)
            return (
              <label
                key={c.key}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm ${c.locked ? 'text-gray-400' : 'text-gray-700 hover:bg-gray-50 cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={c.locked}
                  onChange={() => toggle(c.key)}
                  className="rounded border-gray-300 text-brand focus:ring-brand/30"
                />
                {c.label}
              </label>
            )
          })}
          {(footer || extraAction) && (
            <div className="px-3 pt-1.5 pb-1 mt-1 border-t border-gray-100">
              {extraAction && (
                <button type="button" onClick={extraAction.onClick} className="block text-xs text-brand hover:underline mb-1">
                  {extraAction.label}
                </button>
              )}
              {footer && <p className="text-[11px] leading-snug text-gray-400">{footer}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
