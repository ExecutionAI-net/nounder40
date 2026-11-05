'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

// The per-browser conveniences of a report table (School › Reports ›
// Lessons first, then HQ › Shop › Sales — Carlo, 2026-10-31; Bookings and
// the column order, 2026-11-05): which columns are hidden, in what order
// they stand and how wide each one has been dragged. All are remembered in
// localStorage under the caller's key, so they survive clearing the filters
// and reloading; all fall back quietly when storage is blocked or holds
// garbage (every column shown, the page's order, automatic widths).

// A column never dragged gets this width once the table is in fixed layout
export const DEFAULT_COL_WIDTH = 120
const MIN_COL_WIDTH = 48

/** A list of column keys remembered in localStorage under `storageKey`: the
 *  hidden columns (hidden rather than visible, so a column added later shows
 *  up by itself for everyone) and the column order (empty = the page's own,
 *  applied with `orderColumns`). Read once on mount; garbage, blocked
 *  storage and repeated keys are tolerated (nothing hidden, the page's own
 *  order, each key once). An empty list removes the entry. */
export function useStoredKeyList(storageKey: string) {
  const [keys, setKeysState] = useState<string[]>([])
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (Array.isArray(saved)) setKeysState(uniqueStrings(saved))
    } catch { /* storage blocked or garbage */ }
  }, [storageKey])
  const setKeys = useCallback((next: string[]) => {
    const clean = uniqueStrings(next)
    setKeysState(clean)
    try {
      if (clean.length) localStorage.setItem(storageKey, JSON.stringify(clean))
      else localStorage.removeItem(storageKey)
    } catch { /* per-browser convenience only */ }
  }, [storageKey])
  return [keys, setKeys] as const
}
function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.filter((k): k is string => typeof k === 'string')))
}

/** `columns` in the stored `order`. A key the order does not know (a column
 *  added since, or never stored) keeps its place next to the column that
 *  precedes it in the page's own list; a stored key the page no longer has
 *  is skipped. The result holds every column exactly once. */
export function orderColumns<T extends { key: string }>(columns: T[], order: string[]): T[] {
  if (!order.length) return columns
  const result: T[] = []
  const placed = new Set<string>()
  for (const k of order) {
    const c = columns.find(col => col.key === k)
    if (c && !placed.has(k)) { result.push(c); placed.add(k) }
  }
  columns.forEach((c, i) => {
    if (placed.has(c.key)) return
    // right after its nearest placed predecessor, else first
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.findIndex(r => r.key === columns[j].key)
      if (idx >= 0) { at = idx + 1; break }
    }
    result.splice(at, 0, c)
    placed.add(c.key)
  })
  return result
}

/** `keys` with the column at `from` moved by `step` places (-1 up, +1 down). */
export function moveKey(keys: string[], from: number, step: number): string[] {
  const to = from + step
  if (from < 0 || from >= keys.length || to < 0 || to >= keys.length) return keys
  const next = [...keys]
  const [k] = next.splice(from, 1)
  next.splice(to, 0, k)
  return next
}

/** Where the "Totals" label of a totals row goes, now that the reader
 *  chooses which column comes first: the first visible text column without
 *  a total of its own (`key`), and the same place among the exported cells
 *  (`exportIndex`; a column may export more than one cell). A right-aligned
 *  column is never the slot, even when it has no sum to show: a word under
 *  a money header reads as a number gone wrong. `key` is null and
 *  `exportIndex` -1 when no visible column qualifies. */
export type TotalsLabelSlot = { key: string | null; exportIndex: number }
export function totalsLabelSlot(visible: { key: string; right?: boolean; total?: unknown; exportHeaders: string[] }[]): TotalsLabelSlot {
  let index = 0
  for (const c of visible) {
    if (c.total === undefined && !c.right) return { key: c.key, exportIndex: index }
    index += c.exportHeaders.length
  }
  return { key: null, exportIndex: -1 }
}

/** The exported totals row with `label` written at the slot's position
 *  (`offset`: cells the caller put before the columns, e.g. a "Row" column). */
export function labelExportTotals(cells: (string | number)[], slot: TotalsLabelSlot, label: string, offset = 0): (string | number)[] {
  if (slot.exportIndex < 0) return cells
  return cells.map((v, i) => (i === offset + slot.exportIndex ? label : v))
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
