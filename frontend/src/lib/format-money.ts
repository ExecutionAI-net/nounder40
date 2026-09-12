// I18N-R4-10: money was rendered as `€{n.toFixed(2)}` everywhere except the
// student subscription block — dot decimal and a leading symbol in every
// locale. One formatter, bound to the UI locale (it → "185,00 €", en → "€185.00").
const cache = new Map<string, Intl.NumberFormat>()

export function formatMoney(amount: number | string | null | undefined, locale: string, opts: { decimals?: number } = {}): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0)
  if (!Number.isFinite(n)) return '—'
  const decimals = opts.decimals ?? 2
  const key = `${locale}:${decimals}`
  let f = cache.get(key)
  if (!f) {
    const options = { style: 'currency' as const, currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals }
    try { f = new Intl.NumberFormat(locale, options) } catch { f = new Intl.NumberFormat('en', options) }
    cache.set(key, f)
  }
  return f.format(n)
}
