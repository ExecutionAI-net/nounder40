'use client'

// Fixed platform palette (calendar-friendly, clearly distinguishable).
// Selected swatch shows a white check + dark ring — no ambiguity.
export const PALETTE = [
  '#6B1F3A', // brand burgundy
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // yellow
  '#16A34A', // green
  '#0D9488', // teal
  '#2563EB', // blue
  '#7C3AED', // violet
  '#DB2777', // pink
  '#4B5563', // gray
] as const

export default function ColorPicker({
  value,
  onChange,
  colors = PALETTE as readonly string[],
}: {
  value: string
  onChange: (color: string) => void
  colors?: readonly string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c) => {
        const selected = value.toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-pressed={selected}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition transform ${
              selected ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : 'hover:scale-105'
            }`}
            style={{ backgroundColor: c }}
          >
            {selected && (
              <svg className="w-4 h-4 text-white drop-shadow" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
