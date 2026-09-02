// Allowlist minima per i testi formattati scritti da HQ (es. descrizione
// prodotto): grassetto, corsivo, sottolineato e a capo. Tutti gli attributi
// vengono rimossi, quindi niente href/onclick/style. Funziona anche a server
// (non dipende da DOMPurify, che richiede window).
const RICH_TEXT_TAGS = ['b', 'strong', 'i', 'em', 'u', 'br', 'p']

export function sanitizeRichText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\/?)([a-zA-Z0-9-]+)(?:\s[^>]*)?\/?>/g, (_full, slash: string, tag: string) => {
      const name = tag.toLowerCase()
      if (!RICH_TEXT_TAGS.includes(name)) return ''
      return name === 'br' ? '<br>' : `<${slash}${name}>`
    })
    .trim()
}

/** Versione a testo semplice, per anteprime e troncamenti. */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<\/(p|div)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
