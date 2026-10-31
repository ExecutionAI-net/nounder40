'use client'

import type { ReactNode } from 'react'
import ColumnResizeHandle from '@/components/ui/ColumnResizeHandle'
import type { ResizableColumns } from '@/lib/use-table-columns'

// The shell of a report table whose columns can be dragged (School › Reports
// › Lessons, HQ › Shop › Sales): the box that scrolls both ways under a
// sticky <thead>, the table in fixed layout once a column has been dragged,
// and the <colgroup> that carries the widths. Header cells go through
// ResizableTh, which owns what useResizableColumns needs from them
// (`data-col`, `relative` for the handle, clipping once sized), so a third
// table cannot forget half of the contract.
export function ResizableTable({ columns, cols, className = 'text-sm', maxHeight = 'max-h-[calc(100vh-11rem)]', children }: {
  columns: { key: string }[]   // the visible columns, in order
  cols: ResizableColumns
  className?: string           // the table's own classes
  maxHeight?: string           // the scroll box's height
  children: ReactNode          // <thead> and <tbody>
}) {
  return (
    <div className={`overflow-auto ${maxHeight}`}>
      <table
        className={`${className} ${cols.sized ? '' : 'w-full'}`}
        style={cols.sized ? { tableLayout: 'fixed', width: columns.reduce((sum, c) => sum + cols.widthOf(c.key), 0) } : undefined}
      >
        <colgroup>
          {columns.map(c => <col key={c.key} data-col={c.key} style={cols.sized ? { width: cols.widthOf(c.key) } : undefined} />)}
        </colgroup>
        {children}
      </table>
    </div>
  )
}

export function ResizableTh({ col, cols, right, className = '', onClick, children }: {
  col: string
  cols?: ResizableColumns   // none: the same header, no handle
  right?: boolean
  className?: string        // colour and cursor, the caller's
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <th
      data-col={col}
      style={cols?.sized ? { width: cols.widthOf(col) } : undefined}
      onClick={onClick}
      className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide select-none whitespace-nowrap ${cols?.sized ? 'overflow-hidden text-ellipsis' : ''} ${right ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
      {cols && <ColumnResizeHandle onPointerDown={cols.startResize(col)} />}
    </th>
  )
}
