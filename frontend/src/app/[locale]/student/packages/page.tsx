'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Link } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { formatLessonDate, formatLessonTime, placeLabel } from '@/lib/lesson-format'
import { languageLabel } from '@/lib/languages'
import { formatCredits } from '@/lib/credits'

type StudentPackage = {
  id: string
  credits_total: number
  credits_remaining: number
  purchased_at: string
  starts_at: string | null
  expires_at: string | null
  status: string
  payment_method: string
  package_name: string
  package_color: string
  package_description_en: string | null
  package_is_recurring: boolean
  package_is_unlimited: boolean
  // Crediti tradotti in lezioni dal backend. Null quando il pacchetto copre
  // tipi con costi-credito diversi (un numero di lezioni non esiste) o e'
  // illimitato.
  lesson_credit_cost: string | null
  lessons_remaining: number | null
  lessons_total: number | null
  school_name: string
  school_city: string
}

type CreditTx = {
  id: string
  date: string
  lesson_date: string | null
  lesson_start_time?: string | null
  lesson_end_time?: string | null
  room_name?: string | null
  location_name?: string | null
  is_online?: boolean
  lesson_language?: string | null
  lesson_name: string
  school_name: string
  package_name: string | null
  student_package_id: string | null
  credits: number
  type: 'deducted' | 'refund' | 'no_show' | 'purchase'
  status: string
}

function StudentPackagesContent() {
  const t = useTranslations('student.packages')
  const uiLocale = useLocale()
  const tLayout = useTranslations('layout')
  const searchParams = useSearchParams()
  // I pacchetti sono personali: gli anonimi vedono un invito ad accedere
  const { user, loading: authLoading } = useAuth()
  const isAuthed = authLoading ? null : !!user
  const [tab, setTab] = useState<'packages' | 'history'>('packages')
  const [packages, setPackages] = useState<StudentPackage[]>([])
  const [history, setHistory] = useState<CreditTx[]>([])
  const [loading, setLoading] = useState(true)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null)

  const activePackages = packages.filter(p => p.status === 'active' && p.credits_remaining > 0)
  const totalCredits = activePackages.reduce((sum, p) => sum + p.credits_remaining, 0)

  // Il totale in lezioni si ottiene sommando le lezioni PACCHETTO PER
  // PACCHETTO, non convertendo i crediti totali: un credito non si spalma su
  // due pacchetti — la prenotazione scala da uno solo — quindi 20 crediti a 20
  // piu' 150 a 15 sono 1 + 10 = 11 lezioni, mentre 170 crediti diviso "quanto"
  // non vorrebbe dire niente.
  const convertible = activePackages.filter(p => p.lessons_remaining != null)
  const totalLessons = convertible.reduce((sum, p) => sum + (p.lessons_remaining ?? 0), 0)
  // Quello che resta fuori dal conto (pacchetti illimitati o con tipi di
  // lezione a costi diversi): si dice, invece di far tornare un totale falso.
  const leftoverCredits = activePackages
    .filter(p => p.lessons_remaining == null)
    .reduce((sum, p) => sum + p.credits_remaining, 0)
  const showLessons = convertible.length > 0

  async function load() {
    if (!user) { setLoading(false); return }
    setLoading(true)
    const [pkgs, hist] = await Promise.all([
      apiFetch<StudentPackage[]>('/student/packages/').catch(() => []),
      apiFetch<CreditTx[]>('/student/credit-history/').catch(() => []),
    ])
    setPackages(pkgs)
    setHistory(hist)
    setLoading(false)
  }

  useEffect(() => {
    if (authLoading) return
    const isSuccess = searchParams.get('payment') === 'success'
    const sessionId = searchParams.get('session_id')

    if (isSuccess && sessionId) {
      setPaymentSuccess(true)
      // Accredita subito se il webhook non e' ancora arrivato (no-op se lo e').
      apiFetch(`/stripe/verify-session/?session_id=${sessionId}`)
        .catch(() => {})
        .finally(load)
    } else {
      load()
    }

    const onCreditsChanged = () => load()
    const onVisibility = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('credits-changed', onCreditsChanged)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('credits-changed', onCreditsChanged)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user])

  // Una scadenza puo' essere assente (crediti concessi a mano senza data):
  // new Date(null) e' il 1 gennaio 1970, ed e' cosi' che in pagina compariva
  // "scade 1 gen" a fine agosto.
  function formatDate(d: string | null) {
    return d ? new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' }) : null
  }

  function formatShort(d: string | null) {
    return d ? new Date(d).toLocaleDateString(uiLocale, { day: 'numeric', month: 'short' }) : null
  }

  function progressPercent(remaining: number, total: number) {
    return total > 0 ? Math.round((remaining / total) * 100) : 0
  }

  // Riga dettagli lezione (giorno · orario, poi 📍 sede · sala) — stessa
  // informazione della card di "Le mie lezioni"
  function LessonMeta({ tx }: { tx: CreditTx }) {
    if (!tx.lesson_date) return null
    const time = formatLessonTime(tx.lesson_start_time, tx.lesson_end_time)
    const place = placeLabel(tx, t('online'))
    return (
      <>
        <p className="text-xs text-gray-500 capitalize">
          {formatLessonDate(tx.lesson_date, uiLocale)}{time ? ` · ${time}` : ''}
          {tx.lesson_language ? ` · ${languageLabel(tx.lesson_language)}` : ''}
        </p>
        {place && <p className="text-xs text-gray-400 truncate">{place}</p>}
      </>
    )
  }

  // Un solo motore: gli "abbonamenti" sono pacchetti ricorrenti, mostrati
  // nello stesso tab con il badge Abbonamento (PACKAGE_TO_SUBSCRIPTION.md).
  const tabs = [
    { key: 'packages' as const, label: t('tabPackages') },
    { key: 'history' as const, label: t('tabHistory') },
  ]

  // Visitatore anonimo: pacchetti e crediti sono legati all'account
  if (isAuthed === false) {
    return (
      <div className="max-w-md mx-auto mt-10 bg-white rounded-2xl border border-gray-100 p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        </div>
        <h2 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h2>
        <p className="text-sm text-gray-500 mt-1.5 mb-6">{t('loginPromptText')}</p>
        <div className="space-y-2">
          <Link href="/register?next=%2Fstudent%2Fpackages"
            className="block w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition">
            {tLayout('register')}
          </Link>
          <Link href="/login?next=%2Fstudent%2Fpackages"
            className="block w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition">
            {tLayout('signIn')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {paymentSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between items-center">
          {t('paymentSuccess')}
          <button onClick={() => setPaymentSuccess(false)} className="text-green-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Credit summary card */}
      <div className="bg-brand rounded-2xl p-5 mb-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wide font-medium mb-1">
              {showLessons ? t('totalLessonsAvailable') : t('totalCreditsAvailable')}
            </p>
            <p className="text-5xl font-bold leading-none">
              {loading ? '—' : showLessons ? totalLessons : totalCredits}
            </p>
            <p className="text-white/60 text-xs mt-2">
              {showLessons
                ? (leftoverCredits > 0
                  ? t('acrossAllPackagesPlusCredits', { credits: formatCredits(leftoverCredits) })
                  : t('acrossAllPackages'))
                : t('acrossAllPackages')}
            </p>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white">
              <path d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a3.752 3.752 0 0 0-2.806 3.63c0 .414.336.75.75.75h15.75a.75.75 0 0 0 0-1.5H5.378A2.25 2.25 0 0 1 7.5 15h11.218a.75.75 0 0 0 .674-.421 60.358 60.358 0 0 0 2.96-7.228.75.75 0 0 0-.525-.965A60.864 60.864 0 0 0 5.68 4.509l-.232-.867A1.875 1.875 0 0 0 3.636 2.25H2.25Z" />
              <path d="M3.75 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM16.5 20.25a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z" />
            </svg>
          </div>
        </div>

        {!loading && activePackages.length > 0 && (
          <div className="mt-4 space-y-2">
            {activePackages.map((p) => {
              const pct = progressPercent(p.credits_remaining, p.credits_total)
              return (
                <div key={p.id}>
                  <div className="flex justify-between text-xs text-white/80 mb-1">
                    <span>{p.package_name || t('packageDefault')} · {p.school_name}</span>
                    <span>
                      {p.lessons_remaining != null
                        ? t('lessonsOf', { remaining: p.lessons_remaining, total: p.lessons_total ?? 0 })
                        : `${formatCredits(p.credits_remaining)} / ${formatCredits(p.credits_total)}`}
                      {' · '}{formatShort(p.expires_at) ? `${t('expShort')} ${formatShort(p.expires_at)}` : t('noExpiry')}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/70 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-5 w-fit">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === tb.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : tab === 'packages' ? (
        packages.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center space-y-3">
            <p className="text-gray-400 text-sm">{t('noPackages')}</p>
            <Link href="/student/book" className="inline-block text-sm text-brand font-medium hover:underline">
              {t('browseClasses')}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => {
              const pct = progressPercent(pkg.credits_remaining, pkg.credits_total)
              const expired = pkg.status !== 'active'
              const isOpen = expandedPkg === pkg.id
              // Ordinati per giorno+orario della lezione, dal più recente al
              // più vecchio (l'API ordina per data di prenotazione, che non
              // coincide col giorno della lezione)
              const txSortKey = (tx: CreditTx) =>
                tx.lesson_date ? `${tx.lesson_date}T${tx.lesson_start_time ?? '00:00'}` : tx.date
              const pkgTxs = history
                .filter((tx) => tx.student_package_id === pkg.id && tx.type !== 'purchase')
                .sort((a, b) => txSortKey(b).localeCompare(txSortKey(a)))
              return (
                <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${expired ? 'opacity-60' : ''}`}>
                  <div className="h-1.5" style={{ backgroundColor: pkg.package_color ?? '#6B1F3A' }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">
                          {pkg.package_name}
                          {pkg.package_is_recurring && (
                            <span className="text-xs font-medium bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full ml-2 align-middle">{t('badgeSubscription')}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{pkg.school_name} · {pkg.school_city}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                        pkg.status === 'active' ? 'bg-green-100 text-green-600' :
                        pkg.status === 'expired' ? 'bg-gray-100 text-gray-500' :
                        'bg-red-100 text-red-500'
                      }`}>{t(`status_${pkg.status}` as Parameters<typeof t>[0])}</span>
                    </div>
                    <div className="mb-2">
                      {pkg.package_is_unlimited ? (
                        <p className="text-xs text-gray-500 mb-1">∞ {t('unlimitedCredits')}</p>
                      ) : (
                        <>
                          {/* In lezioni, coi crediti sotto in piccolo: e' la
                              stessa lettura della vetrina e del pannello
                              scuola, cosi' il numero che ha visto comprando e
                              quello che vede dopo sono lo stesso numero. */}
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            {pkg.lessons_remaining != null ? (
                              <>
                                <span>{t('lessonsRemaining', { count: pkg.lessons_remaining })}</span>
                                <span>{t('lessonsTotal', { count: pkg.lessons_total ?? 0 })}</span>
                              </>
                            ) : (
                              <>
                                <span>{t('creditsRemaining', { count: formatCredits(pkg.credits_remaining) })}</span>
                                <span>{t('creditsTotal', { count: formatCredits(pkg.credits_total) })}</span>
                              </>
                            )}
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pkg.package_color ?? '#6B1F3A' }} />
                          </div>
                          {pkg.lessons_remaining != null && (
                            <p className="text-[11px] text-gray-400 mt-1">
                              {t('creditsDetail', {
                                remaining: formatCredits(pkg.credits_remaining),
                                total: formatCredits(pkg.credits_total),
                                cost: formatCredits(pkg.lesson_credit_cost ?? 0),
                              })}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-gray-400">
                        {t('purchasedOn', { date: formatDate(pkg.purchased_at) ?? '—' })}
                        {pkg.starts_at && new Date(pkg.starts_at) > new Date() && ` · ${t('startsOn', { date: formatDate(pkg.starts_at) ?? '—' })}`}
                        {' · '}
                        {formatDate(pkg.expires_at)
                          ? t('expiresOn', { date: formatDate(pkg.expires_at)! })
                          : t('noExpiry')}
                      </p>
                      <button
                        onClick={() => setExpandedPkg(isOpen ? null : pkg.id)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition"
                      >
                        {pkgTxs.length > 0 ? t('transactions', { count: pkgTxs.length }) : t('noUsageYet')}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        >
                          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100">
                      {pkgTxs.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">{t('noCreditsUsed')}</p>
                      ) : (
                        <div className="divide-y divide-gray-50">
                          {pkgTxs.map((tx) => (
                            <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
                                tx.type === 'refund' ? 'bg-green-100' :
                                tx.type === 'no_show' ? 'bg-red-100' :
                                'bg-brand/10'
                              }`}>
                                {tx.type === 'refund' ? '↩' : tx.type === 'no_show' ? '✗' : '✓'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{tx.lesson_name}</p>
                                {tx.lesson_date ? (
                                  <LessonMeta tx={tx} />
                                ) : (
                                  <p className="text-xs text-gray-400">{formatShort(tx.date)}</p>
                                )}
                                {(tx.type === 'refund' || tx.type === 'no_show') && (
                                  <p className={`text-xs ${tx.type === 'refund' ? 'text-green-600' : 'text-red-500'}`}>
                                    {tx.type === 'refund' ? t('txRefunded') : t('txNoShow')}
                                  </p>
                                )}
                              </div>
                              <p className={`text-sm font-semibold shrink-0 ${tx.credits > 0 ? 'text-green-600' : tx.credits === 0 ? 'text-gray-400' : 'text-brand'}`}>
                                {tx.credits > 0 ? '+' : ''}{tx.credits}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : (
        /* Credits History */
        history.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-gray-400 text-sm">{t('noHistory')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="divide-y divide-gray-50">
              {history.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                    tx.type === 'purchase'
                      ? 'bg-blue-100'
                      : tx.type === 'refund'
                      ? 'bg-green-100'
                      : tx.type === 'no_show'
                      ? 'bg-red-100'
                      : 'bg-brand/10'
                  }`}>
                    {tx.type === 'purchase' ? '🛒' : tx.type === 'refund' ? '↩' : tx.type === 'no_show' ? '✗' : '✓'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.lesson_name}</p>
                    <LessonMeta tx={tx} />
                    <p className="text-xs text-gray-400">
                      {tx.school_name}
                      {tx.type === 'purchase' && ` · ${t('txPurchased')}`}
                      {tx.type === 'refund' && ` · ${t('txRefunded')}`}
                      {tx.type === 'no_show' && ` · ${t('txNoShow')}`}
                    </p>
                    {tx.package_name && (
                      <p className="text-xs text-gray-400 truncate">{tx.package_name}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${tx.credits > 0 ? 'text-green-600' : tx.credits === 0 ? 'text-gray-400' : 'text-brand'}`}>
                      {tx.credits > 0 ? '+' : ''}{t('creditsCount', { count: tx.credits })}
                    </p>
                    <p className="text-xs text-gray-400">{formatShort(tx.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

export default function StudentPackagesPage() {
  return (
    <Suspense>
      <StudentPackagesContent />
    </Suspense>
  )
}
