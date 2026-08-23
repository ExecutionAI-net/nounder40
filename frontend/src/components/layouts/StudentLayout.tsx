'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/navigation'
import { useCallback, useEffect, useState } from 'react'
import InstallPWAPrompt from '@/components/InstallPWAPrompt'
import RoleSwitcher from '@/components/RoleSwitcher'
import LocaleSwitcher from '@/components/LocaleSwitcher'
import BackButton from '@/components/ui/BackButton'
import BrandTopBar from '@/components/BrandTopBar'
import NavIcon, { UnreadBadge } from '@/components/layouts/NavIcon'
import { useUnreadMessages } from '@/lib/use-unread'
import { useDrawerNav } from '@/lib/use-drawer-nav'
import { BRAND_DEFAULTS, brandCssVars, parseBrandSettings, sidebarCssVars, type BrandSettings } from '@/lib/brand'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { useCart } from '@/lib/shop-cart'

// Public panel — visitors browse anonymously (calendar, catalogs); booking/
// buying prompts login client-side. No useRequireRole() here on purpose.
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('layout')
  const tNav = useTranslations('nav.student')
  const pathname = usePathname()
  // Global back arrow (hidden on the landing dashboard of each panel)
  const showBack = !pathname.endsWith('/dashboard')
  const router = useRouter()
  const { user, loading: authLoading, logout } = useAuth()
  const isAuthenticated = !!user
  const [totalCredits, setTotalCredits] = useState<number | null>(null)
  const [open, setOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { pendingHref, navigate } = useDrawerNav(() => setMobileMenuOpen(false))
  const { cart } = useCart()
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0)
  const [brand, setBrand] = useState<BrandSettings>(BRAND_DEFAULTS)
  const unread = useUnreadMessages('student')
  // Colori barra dal fetch brand già in corso (niente seconda GET /platform-stats/)
  const sidebarColors = brand.sidebars.student
  // Nome del profilo STUDENTESSA (un account può avere più ruoli con nomi diversi)
  const [profileName, setProfileName] = useState<string | null>(null)
  useEffect(() => {
    if (!isAuthenticated) return
    apiFetch<{ name?: string }>('/student/profile/')
      .then(p => setProfileName(p.name || null))
      .catch(() => {})
  }, [isAuthenticated])

  useEffect(() => {
    apiFetch<Record<string, string>>('/platform-stats/')
      .then((raw) => setBrand(parseBrandSettings(raw)))
      .catch(() => {})
  }, [])

  const userName = profileName || user?.full_name || null
  const userEmail = user?.email || null

  // Anonimi: Home porta alla homepage pubblica; le voci personali
  // (lezioni, assistenza, notifiche, profilo) sono visibili solo da loggati.
  const navItems = [
    { href: isAuthenticated ? '/student/dashboard' : '/', key: 'home', label: tNav('home') },
    { href: '/student/book', key: 'book', label: tNav('book') },
    ...(isAuthenticated ? [{ href: '/student/bookings', key: 'myLessons', label: tNav('myLessons') }] : []),
    { href: '/student/buy', key: 'buyCredits', label: tNav('buyCredits') },
    ...(isAuthenticated ? [{ href: '/student/packages', key: 'packages', label: tNav('packages') }] : []),
    { href: '/student/shop', key: 'shop', label: tNav('shop') },
    ...(isAuthenticated
      ? [
          { href: '/student/support', key: 'support', label: tNav('support') },
          // '/student/notifications' rimosso: il Centro Notifiche (spec 9.10)
          // non è ancora costruito — né pagina né API. Riaggiungere qui quando c'è.
          { href: '/student/profile', key: 'profile', label: tNav('profile') },
        ]
      : []),
  ]

  const bottomNavItems = [
    {
      href: isAuthenticated ? '/student/dashboard' : '/',
      label: tNav('home'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z" />
          <path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z" />
        </svg>
      ),
    },
    {
      href: '/student/book',
      label: tNav('book'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M12.75 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM7.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM8.25 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM9.75 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM10.5 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM12.75 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM14.25 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 17.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 15.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM15 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM16.5 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
          <path fillRule="evenodd" d="M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/student/bookings',
      label: tNav('myLessons'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M6.32 2.577a49.255 49.255 0 0 1 11.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 0 1-1.085.67L12 18.089l-7.165 3.583A.75.75 0 0 1 3.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93Z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/student/packages',
      label: tNav('packages'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M4.5 3.75a3 3 0 0 0-3 3v.75h21v-.75a3 3 0 0 0-3-3h-15Z" />
          <path fillRule="evenodd" d="M22.5 9.75h-21v7.5a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-7.5Zm-18 3.75a.75.75 0 0 1 .75-.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75Zm.75 2.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-3Z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/student/shop',
      label: tNav('shop'),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M7.5 6v.75H5.513c-.96 0-1.764.724-1.865 1.679l-1.263 12A1.875 1.875 0 0 0 4.25 22.5h15.5a1.875 1.875 0 0 0 1.865-2.071l-1.263-12a1.875 1.875 0 0 0-1.865-1.679H16.5V6a4.5 4.5 0 1 0-9 0ZM12 3a3 3 0 0 0-3 3v.75h6V6a3 3 0 0 0-3-3Zm-3 8.25a3 3 0 1 0 6 0v-.75a.75.75 0 0 1 1.5 0v.75a4.5 4.5 0 1 1-9 0v-.75a.75.75 0 0 1 1.5 0v.75Z" clipRule="evenodd" />
        </svg>
      ),
    },
  ]

  const refreshCredits = useCallback(() => {
    if (!isAuthenticated) return
    // /api/student/credits/ returns a per-school breakdown: [{school_id, credits}, ...]
    apiFetch<Array<{ credits?: number }>>('/student/credits/')
      .then((rows) => setTotalCredits(rows.reduce((sum, r) => sum + (r.credits || 0), 0)))
      .catch(() => {})
  }, [isAuthenticated])

  useEffect(() => {
    refreshCredits()

    const onCreditsChanged = () => refreshCredits()
    const onVisibility = () => { if (document.visibilityState === 'visible') refreshCredits() }

    window.addEventListener('credits-changed', onCreditsChanged)
    document.addEventListener('visibilitychange', onVisibility)
    const interval = setInterval(refreshCredits, 60_000)

    return () => {
      window.removeEventListener('credits-changed', onCreditsChanged)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(interval)
    }
  }, [refreshCredits])

  async function handleSignOut() {
    await logout()
    router.push('/')
  }

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50" />
  }

  return (
    <div
      className="brand-theme min-h-screen flex flex-col bg-brand-bg"
      style={{ ...brandCssVars(brand), ...sidebarCssVars(sidebarColors) }}
    >
      <InstallPWAPrompt />

      {/* Barra del sito vetrina: logo + voci configurate da HQ (solo desktop:
          su mobile c'è la riga compatta logo + carrello + burger qui sotto) */}
      <div className="hidden md:block">
        <BrandTopBar brand={brand} />
      </div>

      <div className="flex-1 pb-20 md:pb-0 md:flex">
      {/* Desktop sidebar — hidden when closed */}
      <aside className={`hidden md:flex ${open ? 'md:w-60' : 'md:w-12'} bg-[var(--sb-bg)] border-r border-gray-100 flex-col shrink-0 overflow-hidden transition-all duration-200 sticky top-0 h-screen`}>
        {/* Rail compatto a sidebar chiusa: apri + esci nel proprio spazio */}
        {!open && (
          <div className="flex flex-col items-center gap-1.5 pt-3">
            <button onClick={() => setOpen(true)} title={t('openSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg></button>
            {isAuthenticated && <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>}
          </div>
        )}
        <div className={`w-60 flex-col h-full overflow-hidden ${open ? 'flex' : 'hidden'}`}>
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-center justify-end gap-2">
              {/* Logo e nome del pannello stanno nella barra in alto */}
              <div className="flex gap-1 shrink-0">
              <button onClick={() => setOpen(false)} title={t('closeSidebar')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" /></svg></button>
              {isAuthenticated && <button onClick={handleSignOut} title={t('signOut')} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 15l3-3m0 0-3-3m3 3H9" /></svg></button>}
              </div>
            </div>
            {(userName || userEmail) && (
              <div className="mt-2 pt-2 border-t border-gray-100">
                {userName && <span className="block text-gray-800 text-xs font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-400 text-xs truncate">{userEmail}</span>}
              </div>
            )}
          </div>

          <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition whitespace-nowrap ${
                  pathname === item.href
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <NavIcon name={item.key} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.key === 'support' && <UnreadBadge count={unread.total} />}
              </Link>
            ))}
          </nav>

          <RoleSwitcher currentRole="student" variant="light" />

          <div className="px-3 py-3 border-t border-gray-100">
            <LocaleSwitcher variant="light" />
          </div>

          <div className="px-3 py-4 border-t border-gray-100">
            {isAuthenticated ? (
              <button
                onClick={handleSignOut}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition whitespace-nowrap"
              >
                {t('signOut')}
              </button>
            ) : (
              <Link
                href={`/login?next=${encodeURIComponent(pathname)}`}
                className="block px-3 py-2.5 rounded-lg text-sm text-brand font-medium hover:bg-brand/5 transition whitespace-nowrap"
              >
                {t('signIn')}
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top header bar */}
        <div className="sticky top-0 z-40 bg-[var(--sb-bg)] border-b border-gray-100 px-4 md:px-8 py-3 flex items-center justify-between">
          {/* Mobile: logo piccolo cliccabile → sito vetrina (es. alinaquintana.com) */}
          <a
            href={brand.navLinks[0]?.url ?? 'https://www.alinaquintana.com'}
            target="_blank"
            rel="noopener noreferrer"
            className="md:hidden shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logoUrl} alt="No Under 40" className="h-8 w-auto object-contain" />
          </a>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                {/* Credits chip */}
                <Link
                  href="/student/packages"
                  className="flex items-center gap-1.5 bg-brand/8 hover:bg-brand/15 transition px-3 py-1.5 rounded-full"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-brand">
                    <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM11 3V1.7c0-.268.14-.526.395-.607A2 2 0 0 1 14 3c0 .995-.182 1.948-.514 2.826-.204.54.166 1.174.744 1.174h2.52c1.243 0 2.261 1.01 2.146 2.247a23.864 23.864 0 0 1-1.341 5.974C17.153 16.323 16.072 17 14.9 17H9c-1.381 0-2.5-1.12-2.5-2.5V8c0-.656.26-1.286.728-1.75L9.5 3.5C9.872 3.127 10.5 3 11 3Z" />
                  </svg>
                  <span className="text-sm font-semibold text-brand">
                    {totalCredits === null ? '—' : totalCredits}
                  </span>
                  <span className="text-xs text-brand/70 font-medium">{t('credits')}</span>
                </Link>
                {/* L'uscita sta nella barra laterale (in alto e in fondo):
                    una sola icona di logout, niente doppione qui */}
              </>
            ) : (
              <>
                {/* Visitatore anonimo: accedi o registrati (torna qui dopo il login) */}
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-brand border border-brand/30 hover:bg-brand/5 transition"
                >
                  {t('signIn')}
                </Link>
                <Link
                  href={`/register?next=${encodeURIComponent(pathname)}`}
                  className="px-3 py-1.5 rounded-full text-sm font-medium bg-brand text-white hover:bg-brand-hover transition"
                >
                  {t('register')}
                </Link>
              </>
            )}

            {/* Mobile: carrello con conteggio articoli + burger */}
            <Link
              href="/student/shop?cart=1"
              className="md:hidden relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition"
              aria-label={tNav('shop')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 rounded-full bg-brand text-white text-[10px] font-semibold flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </Link>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition"
              aria-label={t('openSidebar')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5.25A.75.75 0 0 1 2.75 9.25h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Su mobile la freccia sparisce: navigazione via burger + bottom nav */}
        <div className="p-4 md:p-8 pb-20 md:pb-8">{showBack && <div className="hidden md:block"><BackButton href={isAuthenticated ? undefined : '/'} /></div>}{children}</div>
      </main>
      </div>

      {/* Drawer mobile: tutte le sezioni, lingua e uscita */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60]" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="min-w-0">
                {userName && <span className="block text-gray-800 text-sm font-medium truncate">{userName}</span>}
                {userEmail && <span className="block text-gray-400 text-xs truncate">{userEmail}</span>}
                {!userName && !userEmail && <span className="text-sm text-gray-500">{t('signIn')}</span>}
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100" aria-label={t('closeSidebar')}>
                ✕
              </button>
            </div>
            <nav className="flex-1 min-h-0 px-3 py-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => { e.preventDefault(); navigate(item.href) }}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition ${
                    pathname === item.href
                      ? 'bg-brand/10 text-brand font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <NavIcon name={item.key} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {pendingHref === item.href && (
                    <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-brand rounded-full animate-spin shrink-0" />
                  )}
                  {item.key === 'support' && <UnreadBadge count={unread.total} />}
                </Link>
              ))}
            </nav>
            <RoleSwitcher currentRole="student" variant="light" />
            <div className="px-3 py-3 border-t border-gray-100">
              <LocaleSwitcher variant="light" />
            </div>
            <div className="px-3 py-3 border-t border-gray-100">
              {isAuthenticated ? (
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition"
                >
                  {t('signOut')}
                </button>
              ) : (
                <Link
                  href={`/login?next=${encodeURIComponent(pathname)}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2.5 rounded-lg text-sm text-brand font-medium hover:bg-brand/5 transition"
                >
                  {t('signIn')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex">
        {bottomNavItems.filter((item) => isAuthenticated || (item.href !== '/student/bookings' && item.href !== '/student/packages')).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center gap-1 py-2 text-[10px] transition ${
              pathname === item.href
                ? 'text-brand font-medium'
                : 'text-gray-400'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
