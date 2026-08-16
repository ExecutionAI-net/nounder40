import { sanitizeRichText } from '@/lib/sanitize'

// Normalizzazione dei campi prodotto scritti da HQ, condivisa fra POST e PATCH.

const HEX = /^#[0-9a-fA-F]{6}$/
const MAX_BADGES = 4

export function normalizeBadges(input: unknown): { label: string; color: string }[] {
  if (!Array.isArray(input)) return []
  return input
    .map((b) => ({
      label: String((b as { label?: unknown })?.label ?? '').trim().slice(0, 24),
      color: String((b as { color?: unknown })?.color ?? '').trim(),
    }))
    .filter(b => b.label)
    .map(b => ({ label: b.label, color: HEX.test(b.color) ? b.color.toUpperCase() : '#3D3D3D' }))
    .slice(0, MAX_BADGES)
}

/** La descrizione accetta solo grassetto/corsivo/sottolineato/a capo. */
export function normalizeDescription(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const clean = sanitizeRichText(input)
  return clean || null
}
