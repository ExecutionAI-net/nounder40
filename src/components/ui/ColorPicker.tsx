'use client'

// Fixed platform palette — light/pastel tones (Svolgo style), still
// distinguishable on the calendar. Selected swatch shows a check + dark ring.
export const PALETTE = [
  '#C4809A', // rosa brand (tinta chiara del bordeaux)
  '#F19999', // rosso chiaro
  '#F5B97F', // arancio chiaro
  '#F2DC8B', // giallo chiaro
  '#93D8A5', // verde chiaro
  '#87D6CB', // teal chiaro
  '#92BDF2', // azzurro
  '#BCA8F0', // lilla
  '#F2A7CD', // rosa
  '#B9C1CC', // grigio chiaro
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
              <svg className="w-4 h-4 text-gray-800" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
