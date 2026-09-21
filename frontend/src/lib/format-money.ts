// I18N-R4-10: money was rendered as `€{n.toFixed(2)}` everywhere except the
// student subscription block — dot decimal and a leading symbol in every
// locale. One formatter, bound to the UI locale (it → "185,00 €", en → "€185.00").
//
// Thousands separator, always — even on four digits: "1.657,55 €", not
// "1657,55 €". CLDR leaves the separator out below 10 000 for it and es
// (minimumGroupingDigits = 2), so `useGrouping: 'always'` is spelled out;
// the same rule for plain numbers goes through formatNumber (Carlo, 2026-09-21).
type Grouping = { useGrouping: 'always' }
const ALWAYS: Grouping = { useGrouping: 'always' }

const money = new Map<string, Formatter>()
const numbers = new Map<string, Formatter>()

type Formatter = { format: (n: number) => string }

// Engines before NumberFormat v3 (Chrome < 106, Safari < 15.4, Firefox < 116)
// coerce useGrouping: 'always' to plain true and keep CLDR's lazy grouping, so
// it/es would still render "1657,55 €". There, the group separator is put in
// by hand from the parts of a number the engine does group.
function build(locale: string, options: Intl.NumberFormatOptions): Formatter {
  let f: Intl.NumberFormat
  try { f = new Intl.NumberFormat(locale, options) } catch { f = new Intl.NumberFormat('en', options) }
  if (String(f.resolvedOptions().useGrouping) === 'always') return f
  const group = f.formatToParts(1234567).find((p) => p.type === 'group')?.value ?? ''
  if (!group) return f
  return {
    format: (n: number) => f.formatToParts(n).map((p) => (
      p.type === 'integer' && p.value.length > 3 ? p.value.replace(/\B(?=(\d{3})+(?!\d))/g, group) : p.value
    )).join(''),
  }
}

export function formatMoney(
  amount: number | string | null | undefined,
  locale: string,
  opts: { decimals?: number; currency?: string } = {},
): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount ?? 0)
  if (!Number.isFinite(n)) return '—'
  const decimals = opts.decimals ?? 2
  const currency = (opts.currency ?? 'EUR').toUpperCase()
  const key = `${locale}:${currency}:${decimals}`
  let f = money.get(key)
  if (!f) {
    f = build(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals, ...ALWAYS })
    money.set(key, f)
  }
  return f.format(n)
}

/** A plain number (credits, counts, sizes) in the UI locale, thousands separator always. */
export function formatNumber(
  value: number | string | null | undefined,
  locale: string,
  opts: { decimals?: number; maxDecimals?: number } = {},
): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return '—'
  const min = opts.decimals ?? 0
  const max = opts.maxDecimals ?? Math.max(min, opts.decimals ?? 2)
  const key = `${locale}:${min}:${max}`
  let f = numbers.get(key)
  if (!f) {
    f = build(locale, { minimumFractionDigits: min, maximumFractionDigits: max, ...ALWAYS })
    numbers.set(key, f)
  }
  return f.format(n)
}
