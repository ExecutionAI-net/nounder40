'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// The two per-browser conveniences of a report table (School › Reports ›
// Lessons first, then HQ › Shop › Sales — Carlo, 2026-10-31): which columns
// are hidden and how wide each one has been dragged. Both are remembered in
// localStorage under the caller's key, so they survive clearing the filters
// and reloading; both fall back quietly when storage is blocked or holds
// garbage (every column shown, automatic widths).

// A column never dragged gets this width once the table is in fixed layout
export const DEFAULT_COL_WIDTH = 120
const MIN_COL_WIDTH = 48

/** The hidden columns of a table, as a stored list of keys. Hidden rather
 *  than visible: a column added later shows up by itself for everyone. */
export function useStoredHiddenColumns(storageKey: string) {
  const [hidden, setHiddenState] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(saved)) setHiddenState(saved.filter((k): k is string => typeof k === 'string'))
    } catch { /* storage blocked or garbage: every column shown */ }
  }, [storageKey])
  const setHidden = useCallback((next: string[]) => {
    setHiddenState(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* per-browser convenience only */ }
  }, [storageKey])
  return [hidden, setHidden] as const
}

/** Column widths (px) once a header's right edge has been dragged. The first
 *  drag fixes every column at its current width, so only that one moves;
 *  until then the table lays itself out. `startResize(key)` is the
 *  pointerdown handler for that column's handle. It finds the headers and
 *  the <col> elements through `data-col`, which components/ui/ResizableTable
 *  puts on them: render the table through that shell. */
export function useResizableColumns(storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const widthsRef = useRef<Record<string, number>>({})
  // the drag in progress, so unmounting mid-drag detaches its document listeners
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => { cleanupRef.current?.() }, [])

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const clean = Object.fromEntries(
          Object.entries(saved as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'),
        )
        widthsRef.current = clean
        setWidths(clean)
      }
    } catch { /* storage blocked or garbage: automatic widths */ }
  }, [storageKey])

  const save = useCallback((next: Record<string, number>) => {
    widthsRef.current = next
    setWidths(next)
    try {
      if (Object.keys(next).length) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch { /* per-browser convenience only */ }
  }, [storageKey])

  const startResize = useCallback((key: string) => (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const table = e.currentTarget.closest('table')
    if (!table) return
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th[data-col]'))
    const next = { ...widthsRef.current }
    for (const cell of headers) {
      const k = cell.dataset.col
      if (k && !next[k]) next[k] = Math.round(cell.getBoundingClientRect().width)
    }
    const startX = e.clientX
    const startW = next[key] ?? DEFAULT_COL_WIDTH
    // While the pointer moves only the DOM changes (this column's <col> and
    // <th>, the table's width): a React render per pixel would rebuild every
    // row of a long table. The state is written once, on release.
    const col = table.querySelector<HTMLTableColElement>(`colgroup col[data-col="${key}"]`)
    const th = headers.find(cell => cell.dataset.col === key)
    const paint = (w: number) => {
      if (col) col.style.width = `${w}px`
      if (th) th.style.width = `${w}px`
      const total = headers.reduce((sum, cell) => sum + (cell.dataset.col === key ? w : (next[cell.dataset.col ?? ''] ?? DEFAULT_COL_WIDTH)), 0)
      table.style.width = `${total}px`
    }
    let current = startW
    const onMove = (ev: PointerEvent) => {
      current = Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX))
      paint(current)
    }
    const detach = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      cleanupRef.current = null
    }
    const onUp = () => {
      detach()
      save({ ...next, [key]: current })
    }
    cleanupRef.current?.()
    cleanupRef.current = detach
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    // the first drag fixes every column at its measured width: one render
    widthsRef.current = next
    setWidths(next)
  }, [save])

  const sized = Object.keys(widths).length > 0
  const widthOf = useCallback((key: string) => widths[key] ?? DEFAULT_COL_WIDTH, [widths])
  const reset = useCallback(() => save({}), [save])
  return { widths, sized, widthOf, startResize, reset }
}

export type ResizableColumns = ReturnType<typeof useResizableColumns>
