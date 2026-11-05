'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { moveKey } from '@/lib/use-table-columns'

// Menu "Colonne" con una checkbox per colonna: cosa togliere dalla tabella e,
// con lei, dal CSV e dal PDF (Rapporti › Lezioni, Carlo 2026-10-31).
// Lavora sulle colonne *nascoste*, non su quelle visibili: una colonna aggiunta
// in futuro compare da sola anche a chi aveva già salvato la propria scelta.
// `locked` = sempre visibile (l'identità della riga, es. il nome della lezione).
// Con `onReorder` ogni riga ha due frecce ▲ ▼ (Carlo 2026-11-05): l'elenco è
// nell'ordine della tabella e la nuova lista completa di chiavi torna al
// chiamante, che la salva (lib/use-table-columns.useStoredColumnOrder); anche
// l'ordine arriva a CSV e PDF perché la pagina esporta le colonne visibili
// così come stanno. Tutti i testi vengono da `tableTools`: il menu è uguale
// in ogni tabella.
export type PickableColumn = { key: string; label: string; locked?: boolean }

export default function ColumnPicker({
  columns,
  hidden,
  onChange,
  onReorder,
  resetOrder,
  resetWidths,
}: {
  columns: PickableColumn[]        // in the table's order
  hidden: string[]
  onChange: (hidden: string[]) => void
  onReorder?: (keys: string[]) => void  // the arrows, with the new full order
  resetOrder?: () => void          // given when the reader has an order of their own
  resetWidths?: () => void         // given when a column has been dragged
}) {
  const t = useTranslations('tableTools')
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
  function move(index: number, step: number) {
    onReorder?.(moveKey(columns.map(c => c.key), index, step))
  }

  // a locked column is shown whatever an old stored list says
  const isVisible = (c: PickableColumn) => Boolean(c.locked) || !hidden.includes(c.key)
  const visibleCount = columns.filter(isVisible).length
  const trimmed = visibleCount < columns.length
  const arrowCls = 'px-1 text-xs leading-none text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:hover:text-gray-400'

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
        {t('columns')}
        {trimmed && <span className="text-xs tabular-nums">· {visibleCount}/{columns.length}</span>}
        <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
          {trimmed && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-brand hover:bg-gray-50 border-b border-gray-100"
            >
              {t('showAll')}
            </button>
          )}
          {columns.map((c, i) => {
            const checked = isVisible(c)
            return (
              <div key={c.key} className="flex items-center gap-1 pr-2 hover:bg-gray-50">
                <label
                  className={`flex-1 flex items-center gap-2 px-3 py-1.5 text-sm ${c.locked ? 'text-gray-400' : 'text-gray-700 cursor-pointer'}`}
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
                {onReorder && (
                  <>
                    <button type="button" aria-label={`${t('moveUp')}: ${c.label}`} title={t('moveUp')} disabled={i === 0} onClick={() => move(i, -1)} className={arrowCls}>▲</button>
                    <button type="button" aria-label={`${t('moveDown')}: ${c.label}`} title={t('moveDown')} disabled={i === columns.length - 1} onClick={() => move(i, 1)} className={arrowCls}>▼</button>
                  </>
                )}
              </div>
            )
          })}
          <div className="px-3 pt-1.5 pb-1 mt-1 border-t border-gray-100">
            {resetOrder && (
              <button type="button" onClick={resetOrder} className="block text-xs text-brand hover:underline mb-1">{t('resetOrder')}</button>
            )}
            {resetWidths && (
              <button type="button" onClick={resetWidths} className="block text-xs text-brand hover:underline mb-1">{t('resetWidths')}</button>
            )}
            <p className="text-[11px] leading-snug text-gray-400">{t('savedNote')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
