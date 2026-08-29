'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch, ApiError } from '@/lib/api/client'
import DiscountCodeField from '@/components/DiscountCodeField'

type Package = {
  id: string
  name_en: string
  name_it?: string | null
  name_fr?: string | null
  name_es?: string | null
  description_en: string | null
  description_it?: string | null
  description_fr?: string | null
  description_es?: string | null
  credits: number
  validity_days: number
  validity_unit?: string | null
  price: number
  color: string
  language?: string | null
  image_url?: string | null
  is_popular: boolean
  is_vip?: boolean
  is_recurring?: boolean
  recurring_interval?: string | null
  credits_rollover?: boolean
  is_unlimited?: boolean
  weekly_booking_cap?: number | null
  school: string
  schools?: { id: string; name: string; city: string } | null
}

type StudentPackage = {
  id: string
  credits_remaining: number
  credits_total: number
  expires_at: string
  next_renewal_at: string | null
  stripe_subscription_id: string | null
  status: string
  package_name: string
  package_color: string
  package_is_recurring: boolean
  package_recurring_interval: string | null
  school: string
  school_name: string
}

type Invoice = {
  id: string
  amount_paid: number
  currency: string
  status: string | null
  created: number
  invoice_pdf: string | null
  hosted_invoice_url: string | null
}

type SubscriptionDetail = {
  subscription_id: string
  next_payment_at: number | null
  next_payment_amount: number | null
  cancel_at: number | null
  cancelled_at: number | null
  currency: string
  status: string
}

function BuyPage() {
  const t = useTranslations('student.buy')
  const uiLocale = useLocale()
  const tLayout = useTranslations('layout')
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [packages, setPackages] = useState<Package[]>([])
  const [activePackages, setActivePackages] = useState<StudentPackage[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [subDetails, setSubDetails] = useState<SubscriptionDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<string | null>(null)
  const [startChoice, setStartChoice] = useState<{ packageId: string; currentExpiry: string | null } | null>(null)
  // Codice sconto applicato al pacchetto in acquisto (si azzera a ogni acquisto)
  const [discount, setDiscount] = useState<{ code: string; amount_off: number } | null>(null)
  const [customStartDate, setCustomStartDate] = useState('')
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Catalogo pubblico: gli anonimi vedono tutti i pacchetti della rete con
  // filtri (scuola, lingua, tipo); l'acquisto chiede login/registrazione
  const isAuthed = authLoading ? null : !!user
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [schools, setSchools] = useState<{ id: string; name: string; city: string }[]>([])
  const [selectedSchoolId, setSelectedSchoolId] = useState(searchParams.get('school_id') ?? '')
  const [filterType, setFilterType] = useState('') // '' | 'one_time' | 'recurring'

  // Un pacchetto, quattro lingue: si mostra la lingua dell'utente con fallback
  function pkgName(pkg: Package) {
    const by: Record<string, string | null | undefined> = {
      it: pkg.name_it, en: pkg.name_en, fr: pkg.name_fr, es: pkg.name_es,
    }
    return by[uiLocale] || pkg.name_en || pkg.name_it || pkg.name_fr || pkg.name_es || ''
  }

  function pkgDescription(pkg: Package) {
    const by: Record<string, string | null | undefined> = {
      it: pkg.description_it, en: pkg.description_en, fr: pkg.description_fr, es: pkg.description_es,
    }
    return by[uiLocale] || pkg.description_en || pkg.description_it || ''
  }

  const redirectTo = searchParams.get('redirect') ?? ''
  const hasRecurring = activePackages.some(p => p.stripe_subscription_id && p.package_is_recurring)

  useEffect(() => {
    const payment = searchParams.get('payment')

    // Arrivo sulla pagina: si RISCRIVE il ricordo, non si accumula. Senza il
    // ramo `else` un abbandono lasciava la destinazione (e la lezione) in
    // localStorage per sempre, e il prossimo acquisto — magari partito dal
    // menu, senza nessuna lezione — rimbalzava su una lezione vecchia.
    if (payment !== 'success') {
      // La lezione di partenza viaggia col redirect: senza, al ritorno
      // l'allieva si ritrova sulla pagina Prenota e deve ricercarla a mano.
      const fromLesson = searchParams.get('lesson_id')
      if (redirectTo) localStorage.setItem('buy_redirect', redirectTo)
      else localStorage.removeItem('buy_redirect')
      if (fromLesson) localStorage.setItem('buy_lesson', fromLesson)
      else localStorage.removeItem('buy_lesson')
    }

    if (payment === 'cancelled') {
      setNotice(t('paymentCancelled'))
    }

    if (payment === 'success') {
      const dest = localStorage.getItem('buy_redirect')
      const lessonId = localStorage.getItem('buy_lesson')
      localStorage.removeItem('buy_redirect')
      localStorage.removeItem('buy_lesson')
      if (dest) {
        const sep = dest.includes('?') ? '&' : '?'
        window.location.replace(lessonId ? `${dest}${sep}resume_lesson=${lessonId}` : dest)
        return
      }
    }
  }, [searchParams, redirectTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      // Anonimo: elenco scuole per scegliere quale catalogo vedere
      apiFetch<{ id: string; name: string; city: string }[]>('/schools/public/')
        .then(setSchools)
        .catch(() => {})
      setLoading(false)
      return
    }
    ;(async () => {
      const profile = await apiFetch<{ school: string | null }>('/student/profile/').catch(() => null)
      if (profile?.school && !searchParams.get('school_id')) setSelectedSchoolId(profile.school)
      const schoolId = profile?.school ?? selectedSchoolId

      const [pkgs, activePkgs, invData] = await Promise.all([
        apiFetch<Package[]>(`/student/school-packages/${schoolId ? `?school_id=${schoolId}` : ''}`).catch(() => []),
        apiFetch<StudentPackage[]>('/student/packages/').catch(() => []),
        apiFetch<{ invoices: Invoice[]; subscriptions: SubscriptionDetail[] }>('/stripe/invoices/').catch(() => ({ invoices: [], subscriptions: [] })),
      ])
      setPackages(pkgs)
      setActivePackages(activePkgs)
      setInvoices(invData.invoices ?? [])
      setSubDetails(invData.subscriptions ?? [])
      setLoading(false)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  // Anonimo: carica il catalogo (tutte le scuole, o quella selezionata)
  useEffect(() => {
    if (isAuthed !== false) return
    setLoading(true)
    apiFetch<Package[]>(`/student/school-packages/${selectedSchoolId ? `?school_id=${selectedSchoolId}` : ''}`)
      .then(setPackages)
      .catch(() => setPackages([]))
      .finally(() => setLoading(false))
  }, [isAuthed, selectedSchoolId])

  async function handleBuy(packageId: string) {
    // Acquisto da anonimo: prima registrati o accedi
    if (!isAuthed) { setShowLoginPrompt(true); return }
    // La decorrenza dei crediti si sceglie SEMPRE: oggi, la scadenza del
    // pacchetto attuale (se c'è), o una data libera. Il pagamento è subito.
    const pkg = packages.find(p => p.id === packageId)
    const current = pkg && activePackages
      .filter(ap => ap.status === 'active' && ap.school === pkg.school && new Date(ap.expires_at) > new Date())
      .sort((a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime())[0]
    setCustomStartDate('')
    setDiscount(null)
    setStartChoice({ packageId, currentExpiry: current ? current.expires_at : null })
  }

  async function proceedBuy(packageId: string, opts?: { start?: 'after_current'; startDate?: string }) {
    setStartChoice(null)
    setBuying(packageId)
    setError(null)
    try {
      const data = await apiFetch<{ url: string }>('/stripe/checkout/', {
        method: 'POST',
        body: JSON.stringify({
          type: 'package', product_id: packageId, redirect_to: redirectTo || undefined,
          start: opts?.start, start_date: opts?.startDate,
          discount_code: discount?.code,
        }),
      })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('somethingWentWrong'))
      setBuying(null)
    }
  }

  async function handleManageBilling() {
    setOpeningPortal(true)
    setError(null)
    try {
      const data = await apiFetch<{ url: string }>('/stripe/portal/', { method: 'POST' })
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotOpenPortal'))
      setOpeningPortal(false)
    }
  }

  const recurringActive = activePackages.filter(p => p.stripe_subscription_id && p.package_is_recurring)

  function getSubDetail(subId: string | null) {
    if (!subId) return null
    return subDetails.find(s => s.subscription_id === subId) ?? null
  }

  function intervalLabel(interval: string | null | undefined) {
    const key = interval ?? 'month'
    const map: Record<string, string> = {
      week: t('intervalWeek'),
      month: t('intervalMonth'),
      '3month': t('interval3Month'),
      '6month': t('interval6Month'),
      year: t('intervalYear'),
    }
    return map[key] ?? key
  }

  const nextUrl = `/student/buy${selectedSchoolId ? `?school_id=${selectedSchoolId}` : ''}`

  // Filtri client-side (lingua, tipo) — usati dal catalogo pubblico
  const visiblePackages = packages.filter(pkg => {
    if (filterType === 'one_time' && pkg.is_recurring) return false
    if (filterType === 'recurring' && !pkg.is_recurring) return false
    return true
  })

  return (
    <div>
      {/* Decorrenza crediti: oggi, scadenza dell'attuale, o data libera. Si paga sempre subito.
          z-[60] + spazio sotto fino a md: la bottom nav mobile (z-50) copriva Conferma/Annulla. */}
      {startChoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-4 pb-20 md:pb-4" onClick={() => setStartChoice(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4">
              <h3 className="font-semibold text-gray-900 text-lg text-center">{t('startChoiceTitle')}</h3>
              <p className="text-sm text-gray-500 mt-2 text-center">
                {startChoice.currentExpiry
                  ? t('startChoiceBody', { date: new Date(startChoice.currentExpiry).toLocaleDateString(uiLocale) })
                  : t('startChoiceHint')}
              </p>
            </div>
            <div className="px-6 pb-6 flex flex-col gap-2">
              {/* Codice sconto: verificato prima di pagare, così l'importo mostrato è quello addebitato */}
              {(() => {
                const pkg = packages.find(p => p.id === startChoice.packageId)
                return (
                  <div className="mb-1">
                    <DiscountCodeField
                      scope="packages"
                      schoolId={pkg?.school}
                      lines={pkg ? [{ id: pkg.id, amount: Number(pkg.price) }] : []}
                      applied={discount}
                      onApply={setDiscount}
                    />
                    {discount && pkg && (
                      <p className="mt-1.5 text-xs text-gray-500 text-center">
                        {t('discountedTotal', { total: Math.max(0, Number(pkg.price) - discount.amount_off).toFixed(2) })}
                      </p>
                    )}
                  </div>
                )
              })()}
              <button
                onClick={() => proceedBuy(startChoice.packageId)}
                className="w-full py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:opacity-90 transition"
              >
                {t('startNow')}
              </button>
              {startChoice.currentExpiry && (
                <button
                  onClick={() => proceedBuy(startChoice.packageId, { start: 'after_current' })}
                  className="w-full py-2.5 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition"
                >
                  {t('startAfter', { date: new Date(startChoice.currentExpiry).toLocaleDateString(uiLocale) })}
                </button>
              )}
              <div className="flex gap-2">
                <input
                  type="date"
                  value={customStartDate}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/20"
                  aria-label={t('startPickDate')}
                />
                <button
                  onClick={() => customStartDate && proceedBuy(startChoice.packageId, { startDate: customStartDate })}
                  disabled={!customStartDate}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 transition"
                >
                  {t('startConfirmDate')}
                </button>
              </div>
              <button onClick={() => setStartChoice(null)} className="w-full py-2 text-gray-400 text-sm hover:text-gray-600 transition">
                {t('startChoiceCancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Login/registrazione richiesta per acquistare (utente anonimo) */}
      {showLoginPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-4 pb-20 md:pb-4" onClick={() => setShowLoginPrompt(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h3>
              <p className="text-sm text-gray-500 mt-1.5">{t('loginPromptText')}</p>
            </div>
            <div className="px-6 pb-6 space-y-2">
              <button
                onClick={() => router.push(`/register?next=${encodeURIComponent(nextUrl)}`)}
                className="w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition"
              >
                {tLayout('register')}
              </button>
              <button
                onClick={() => router.push(`/login?next=${encodeURIComponent(nextUrl)}`)}
                className="w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition"
              >
                {tLayout('signIn')}
              </button>
              <button
                onClick={() => setShowLoginPrompt(false)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Anonimo: filtri per sfogliare il catalogo di tutta la rete */}
      {isAuthed === false && (
        <div className="mb-5 flex flex-wrap gap-3 items-center">
          <select
            value={selectedSchoolId}
            onChange={(e) => setSelectedSchoolId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 bg-white"
          >
            <option value="">{t('allSchools')}</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 bg-white"
          >
            <option value="">{t('allTypes')}</option>
            <option value="one_time">{t('typeOneTime')}</option>
            <option value="recurring">{t('typeRecurring')}</option>
          </select>
          {(selectedSchoolId || filterType) && (
            <button
              onClick={() => { setSelectedSchoolId(''); setFilterType('') }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {t('clearFilters')}
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex justify-between">
          {notice}<button onClick={() => setNotice(null)} className="text-amber-500 text-xs ml-4">✕</button>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex justify-between">
          {error}<button onClick={() => setError(null)} className="text-red-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Active recurring subscriptions */}
      {!loading && recurringActive.length > 0 && (
        <div className="mb-8 bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">{t('activeSubscriptions')}</h2>
            <button
              onClick={handleManageBilling}
              disabled={openingPortal}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {openingPortal ? t('opening') : t('manageSubscription')}
            </button>
          </div>

          <div className="space-y-4">
            {recurringActive.map(sp => {
              const detail = getSubDetail(sp.stripe_subscription_id)
              const color = sp.package_color ?? '#6B1F3A'
              const creditsUsed = sp.credits_total - sp.credits_remaining
              const creditPct = sp.credits_total > 0 ? Math.round((creditsUsed / sp.credits_total) * 100) : 0

              const refTs = detail?.cancel_at ?? detail?.next_payment_at ?? null
              const daysLeft = refTs ? Math.max(0, Math.ceil((refTs * 1000 - Date.now()) / 86400000)) : null

              return (
                <div key={sp.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{sp.package_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {intervalLabel(sp.package_recurring_interval)}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${
                      sp.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                    }`}>
                      {sp.status === 'active' ? t('statusActive') : t('statusPastDue')}
                    </span>
                  </div>

                  {/* Credit usage progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">{t('creditsUsed')}</span>
                      <span className="text-xs font-medium text-gray-700">
                        {creditsUsed} / {sp.credits_total}
                        <span className="text-gray-400 ml-1">({creditPct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${creditPct}%`, backgroundColor: color }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('creditsRemaining', { count: sp.credits_remaining })}
                    </p>
                  </div>

                  {/* Days left countdown + next payment */}
                  <div className="flex items-center justify-between text-xs">
                    {detail?.cancel_at ? (
                      <span className="text-amber-600 font-medium">
                        ⚠ {t('cancelsOn', { date: new Date(detail.cancel_at * 1000).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' }) })}
                        {daysLeft !== null && <> · {t('daysLeft', { count: daysLeft })}</>}
                      </span>
                    ) : detail?.next_payment_at ? (
                      <span className="text-gray-500">
                        {t('nextPayment')} <span className="font-medium text-gray-700">
                          {new Date(detail.next_payment_at * 1000).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </span>
                    ) : <span />}

                    <div className="flex items-center gap-3">
                      {daysLeft !== null && !detail?.cancel_at && (
                        <span className={`font-semibold ${daysLeft <= 3 ? 'text-red-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-gray-500'}`}>
                          {t('daysLeft', { count: daysLeft })}
                        </span>
                      )}
                      {detail?.next_payment_amount != null && !detail?.cancel_at && (
                        <span className="font-semibold text-gray-700">
                          {new Intl.NumberFormat('en-EU', { style: 'currency', currency: detail.currency.toUpperCase() }).format(detail.next_payment_amount / 100)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Invoice history */}
          {invoices.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('paymentHistory')}</h3>
              <div className="space-y-2">
                {invoices.slice(0, 8).map(inv => (
                  <div key={inv.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs w-24 flex-shrink-0">
                        {new Date(inv.created * 1000).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="text-gray-700 font-medium">
                        {new Intl.NumberFormat('en-EU', { style: 'currency', currency: inv.currency.toUpperCase() }).format(inv.amount_paid / 100)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        inv.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {inv.status === 'paid' ? t('invoiceStatusPaid') : inv.status}
                      </span>
                    </div>
                    {inv.invoice_pdf && (
                      <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-brand hover:underline flex-shrink-0">
                        {t('downloadPdf')}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Package catalog */}
      {loading ? (
        <div className="text-sm text-gray-400">{t('loadingPackages')}</div>
      ) : visiblePackages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('noPackages')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visiblePackages.map(pkg => (
            <div key={pkg.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col relative">
              {pkg.is_popular && (
                <div className="absolute top-3 right-3 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  {t('mostPopular')}
                </div>
              )}
              {pkg.is_recurring && (
                <div className={`absolute ${pkg.is_popular ? 'top-9' : 'top-3'} right-3 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium`}>
                  ↻ {intervalLabel(pkg.recurring_interval)}
                </div>
              )}
              <div className="h-1.5" style={{ backgroundColor: pkg.color }} />
              {pkg.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pkg.image_url} alt="" className="w-full aspect-video object-cover" />
              )}
              <div className="p-6 flex flex-col flex-1">
                <p className="font-bold text-gray-900 text-lg mb-1">
                  {pkgName(pkg)}
                  {pkg.is_vip && <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full ml-2 align-middle">VIP</span>}
                  {pkg.is_recurring && <span className="text-xs font-medium bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full ml-2 align-middle">{t('typeRecurring')}</span>}
                </p>
                {pkgDescription(pkg) && <p className="text-sm text-gray-400 mb-4">{pkgDescription(pkg)}</p>}
                {isAuthed === false && pkg.schools && (
                  <p className="text-xs text-gray-500 mb-3 -mt-2">
                    🏫 {pkg.schools.name}{pkg.schools.city ? ` — ${pkg.schools.city}` : ''}
                  </p>
                )}

                <div className="mb-4">
                  <p className="text-4xl font-bold text-gray-900">€{Number(pkg.price).toFixed(0)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {pkg.is_recurring
                      ? t('perInterval', { interval: intervalLabel(pkg.recurring_interval).toLowerCase() })
                      : t('oneTimePayment')}
                  </p>
                </div>

                <div className="space-y-2 mb-6 flex-1">
                  {/* Illimitato: niente numero crediti in vetrina (limite reale = scadenza + tetto settimanale) */}
                  {pkg.is_unlimited ? (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-brand font-bold text-base">∞</span>
                      <span>{t('unlimitedEntries')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-brand font-bold text-base">{pkg.credits}</span>
                      <span>{t('creditsIncluded')}</span>
                    </div>
                  )}
                  {pkg.weekly_booking_cap != null && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{t('upToPerWeek', { cap: pkg.weekly_booking_cap })}</span>
                    </div>
                  )}
                  {pkg.is_recurring ? (
                    <>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="text-gray-400">{t('renews')}</span>
                        <span className="font-medium">{intervalLabel(pkg.recurring_interval)}</span>
                      </div>
                      {pkg.credits_rollover && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <span>{t('creditsRollOver')}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-gray-400">{t('validFor')}</span>
                      <span className="font-medium">
                        {pkg.validity_unit === 'months'
                          ? (pkg.validity_days % 12 === 0
                            ? t('durationYears', { count: pkg.validity_days / 12 })
                            : t('durationMonths', { count: pkg.validity_days }))
                          : pkg.validity_days > 0 && pkg.validity_days % 365 === 0
                          ? t('durationYears', { count: pkg.validity_days / 365 })
                          : t('durationDays', { count: pkg.validity_days })}
                      </span>
                    </div>
                  )}
                  {!pkg.is_unlimited && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span>€{(pkg.price / pkg.credits).toFixed(2)} {t('perCredit')}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleBuy(pkg.id)}
                  disabled={buying === pkg.id}
                  className="w-full py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50"
                  style={{ backgroundColor: pkg.color, color: '#ffffff' }}
                >
                  {buying === pkg.id ? t('redirecting') : (pkg.is_recurring ? t('subscribe') : t('buyNow'))}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasRecurring && (
        <p className="mt-4 text-xs text-gray-400 text-center">
          {t('recurringDisclaimer')}
        </p>
      )}

      <p className="mt-6 text-xs text-gray-400 text-center">{t('securePayment')}</p>
    </div>
  )
}

export default function StudentBuyPage() {
  return <Suspense><BuyPage /></Suspense>
}
