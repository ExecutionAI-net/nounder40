'use client'

// Fixed platform palette — same tones Svolgo uses (Tailwind 600 accents):
// clean and vivid without being heavy. White check + dark ring on selection.
export const PALETTE = [
  '#dc2626', // red
  '#ea580c', // orange
  '#b45309', // amber
  '#16a34a', // green
  '#0d9488', // teal
  '#0891b2', // cyan
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
  '#64748b', // slate
] as const

export default function ColorPicker({
  value,
  onChange,
  colors = PALETTE as readonly string[],
  allowCustom = true,
}: {
  value: string
  onChange: (color: string) => void
  colors?: readonly string[]
  allowCustom?: boolean
}) {
  const isCustom = !colors.some(c => c.toLowerCase() === value.toLowerCase())
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
      {allowCustom && (
        <label
          title="Custom color"
          className={`w-8 h-8 rounded-full cursor-pointer overflow-hidden relative flex items-center justify-center transition transform ${
            isCustom ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : 'border-2 border-dashed border-gray-300 hover:border-gray-400'
          }`}
          style={isCustom ? { backgroundColor: value } : {}}
        >
          <input
            type="color"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="absolute opacity-0 w-full h-full cursor-pointer"
          />
          {isCustom ? (
            <svg className="w-4 h-4 text-white drop-shadow" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          ) : (
            <span className="text-gray-400 text-xs leading-none select-none">+</span>
          )}
        </label>
      )}
    </div>
  )
}
