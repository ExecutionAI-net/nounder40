'use client'

import { useEffect, useRef, useState } from 'react'
import { sanitizeRichText } from '@/lib/sanitize'

// Editor minimo (grassetto, corsivo, sottolineato) per i testi brevi come la
// descrizione prodotto. Salva HTML già ripulito: solo b/i/u/br/p, zero attributi.
export default function RichTextMini({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  rows?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // L'HTML si scrive nel DOM solo quando cambia dall'esterno (apertura form),
  // altrimenti ogni battuta riporterebbe il cursore a inizio testo.
  const lastValue = useRef<string | null>(null)
  const [empty, setEmpty] = useState(!value)

  useEffect(() => {
    if (!ref.current || value === lastValue.current) return
    ref.current.innerHTML = value
    lastValue.current = value
    setEmpty(!value)
  }, [value])

  function exec(command: 'bold' | 'italic' | 'underline') {
    ref.current?.focus()
    document.execCommand(command)
    handleInput()
  }

  function handleInput() {
    if (!ref.current) return
    const html = sanitizeRichText(ref.current.innerHTML)
    lastValue.current = html
    setEmpty(!ref.current.textContent?.trim())
    onChange(html)
  }

  const buttons = [
    { cmd: 'bold' as const, label: 'B', cls: 'font-bold' },
    { cmd: 'italic' as const, label: 'I', cls: 'italic font-serif' },
    { cmd: 'underline' as const, label: 'U', cls: 'underline' },
  ]

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden bg-white focus-within:ring-2 focus-within:ring-[#6B1F3A]/20">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        {buttons.map(b => (
          <button
            key={b.cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(b.cmd)}
            className={`w-7 h-7 rounded text-sm text-gray-600 hover:bg-white hover:text-gray-900 transition ${b.cls}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleInput}
          className="px-3 py-2 text-sm text-gray-800 leading-relaxed outline-none overflow-y-auto"
          style={{ minHeight: `${rows * 1.5}rem`, maxHeight: '16rem' }}
        />
        {empty && placeholder && (
          <span className="absolute top-2 left-3 text-sm text-gray-300 pointer-events-none">{placeholder}</span>
        )}
      </div>
    </div>
  )
}
