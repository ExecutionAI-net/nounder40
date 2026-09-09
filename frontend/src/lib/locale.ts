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

/**
 * Scrive il cookie e ricarica: il redirect del middleware ora concorda.
 *
 * I18N-R3-07: query string e hash vanno portati dietro. Il selettore vive
 * ora anche su `/setup-account?uid=...&token=...`, dove perdere i parametri
 * significa perdere l'invito; e sui pannelli conserva i filtri della pagina
 * invece di riportare l'utente a una lista vuota.
 */
export function switchLocale(locale: string) {
  persistLocale(locale)
  const { pathname, search, hash } = window.location
  window.location.href = localeHref(locale, pathname) + search + hash
}
