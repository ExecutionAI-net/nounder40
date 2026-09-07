import { locales } from '@/i18n/routing'

export const LOCALE_COOKIE = 'user_locale'

/**
 * Un prefisso di lingua esplicito nell'URL vince sempre — middleware.ts non
 * lo riscrive mai in base a questo cookie (era il bug QA M-7: un /it/...
 * condiviso veniva rimbalzato sulla lingua salvata nel cookie). Il cookie
 * serve solo a rendere "sticky" la scelta per i link/redirect successivi
 * senza prefisso esplicito. Chi tocca un selettore di lingua passa di qui.
 */
export function persistLocale(locale: string) {
  document.cookie =
    `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
}

/** Stesso percorso, altro prefisso di lingua. */
export function localeHref(locale: string, pathname: string) {
  const match = pathname.match(new RegExp(`^/(?:${locales.join('|')})(/.*)?$`))
  return `/${locale}${match?.[1] ?? ''}`
}

/** Scrive il cookie e ricarica: il redirect del middleware ora concorda. */
export function switchLocale(locale: string) {
  persistLocale(locale)
  window.location.href = localeHref(locale, window.location.pathname)
}
