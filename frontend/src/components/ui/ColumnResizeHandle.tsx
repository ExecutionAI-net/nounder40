'use client'

import type { PointerEvent as ReactPointerEvent } from 'react'

// The drag handle on a header's right edge; the header must be `relative`.
// The pointer logic lives in useResizableColumns (lib/use-table-columns.ts).
export default function ColumnResizeHandle({ onPointerDown }: {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onClick={e => e.stopPropagation()}
      className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-gray-300/70"
    />
  )
}
