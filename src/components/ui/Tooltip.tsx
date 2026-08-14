import type { ReactNode } from 'react'

// Shared hover tooltip. `align` controls which edge the bubble anchors to.
export default function Tooltip({
  text,
  children,
  align = 'center',
}: {
  text: string
  children: ReactNode
  align?: 'center' | 'right'
}) {
  const bubblePos = align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  const arrowPos = align === 'right' ? 'right-3' : 'left-1/2 -translate-x-1/2'
  return (
    <div className="relative group/tip inline-block">
      {children}
      <div className={`pointer-events-none absolute bottom-full mb-1.5 hidden group-hover/tip:block z-50 ${bubblePos}`}>
        <div className="bg-gray-800 text-white text-xs rounded-md px-2.5 py-1.5 whitespace-nowrap shadow-lg">
          {text}
          <div className={`absolute top-full border-4 border-transparent border-t-gray-800 ${arrowPos}`} />
        </div>
      </div>
    </div>
  )
}
