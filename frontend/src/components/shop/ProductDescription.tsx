'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { sanitizeRichText } from '@/lib/sanitize'

// Descrizione prodotto: accetta sia HTML minimo (b/i/u) sia testo semplice
// salvato prima dell'editor. Se supera l'altezza massima mostra "Leggi tutto".
export default function ProductDescription({ text, clampClass = 'max-h-32' }: { text: string; clampClass?: string }) {
  const t = useTranslations('student.shop')
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  const looksHtml = /<\/?(b|strong|i|em|u|br|p)\b/i.test(text)
  const html = looksHtml
    ? sanitizeRichText(text)
    : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Il toggle compare solo se il testo è davvero tagliato
    setOverflows(el.scrollHeight > el.clientHeight + 4)
  }, [html])

  return (
    <div>
      <div
        ref={ref}
        className={`text-sm text-gray-600 leading-relaxed overflow-hidden ${expanded ? '' : clampClass}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(overflows || expanded) && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-1.5"
        >
          {expanded ? t('showLess') : t('readMore')}
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      )}
    </div>
  )
}
