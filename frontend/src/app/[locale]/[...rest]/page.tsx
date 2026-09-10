import { notFound } from 'next/navigation'

/**
 * I18N-R3-03 / X-R3-13: without this, an unknown path under a locale prefix
 * fell through to the ROOT not-found.tsx, which lives outside `[locale]`,
 * has no NextIntlClientProvider and therefore no language — so `/es/nope`
 * rendered `<html lang="it">` and the bilingual "Pagina non trovata · Page
 * not found" for every locale.
 *
 * A catch-all is the lowest-priority match in the App Router, so every real
 * route still wins; `notFound()` keeps the status at 404 and renders
 * `[locale]/not-found.tsx`, which does have the locale.
 */
export default function LocaleCatchAll() {
  notFound()
}
