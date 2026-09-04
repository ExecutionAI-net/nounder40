import { locales } from '@/i18n/routing'

export const LOCALE_COOKIE = 'user_locale'

/**
 * middleware.ts reindirizza ogni URL con prefisso di lingua verso la lingua
 * preferita del visitatore: prima il cookie `user_locale`, poi l'header
 * Accept-Language. Quindi un semplice <Link href="/it"> rimbalza subito su
 * /en per un browser inglese — cambiare lingua vuol dire scrivere prima
 * questo cookie. Chi tocca un selettore di lingua passa di qui.
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
