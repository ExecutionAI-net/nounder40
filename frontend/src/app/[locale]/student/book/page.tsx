'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useTranslations, useLocale } from 'next-intl'
import { videoUrlForLocale, youtubeThumbnail, imageUrlForLocale } from '@/lib/video-preview'
import { lessonTypeName } from '@/lib/lesson-type-name'
import { cityDisplayName } from '@/lib/city-names'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import VideoPreviewPlayer from '@/components/ui/VideoPreviewPlayer'
import { COURSE_LANGUAGES, languageLabel } from '@/lib/languages'
import { countryName } from '@/lib/country-name'
import { localizedName } from '@/lib/localized-name'

type Lesson = {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  school: string
  lesson_type: string | null
  teacher: string | null
  notes: string | null
  is_online: boolean
  online_link: string | null
  language: string | null   // per-lesson override; falls back to courses.language
  courses: { name: string; color: string; credit_cost: number; min_booking_notice_hours: number; language: string | null; notes: string | null; is_online: boolean; image_url: string | null } | null
  lesson_types: { id: string; code: string; level?: string | null; name_en: string; name_it: string | null; name_fr: string | null; name_es: string | null; description_it: string | null; description_en: string | null; description_fr: string | null; description_es: string | null; image_url: string | null; image_url_it: string | null; image_url_en: string | null; image_url_fr: string | null; image_url_es: string | null; video_url_it: string | null; video_url_en: string | null; video_url_fr: string | null; video_url_es: string | null } | null
  teachers: { id: string; name: string; photo_url: string | null } | null
  school_rooms: { name: string; school_locations: { name: string; address: string | null; google_maps_url: string | null } | null } | null
  schools: { name: string; city: string; cancellation_policy_hours: number | null } | null
}

type BookingInfo = {
  booking_id: string
  credits_deducted: number
  access_source: string
}

type SchoolOption = {
  id: string
  name: string
  city: string
  country?: string | null
  country_code?: string | null
}

function hoursUntil(date: string, start_time: string): number {
  return (new Date(`${date}T${start_time}`).getTime() - Date.now()) / (1000 * 60 * 60)
}

function CancelModal({
  lesson,
  bookingInfo,
  policyHours,
  onConfirm,
  onClose,
  cancelling,
}: {
  lesson: Lesson
  bookingInfo: BookingInfo
  policyHours: number
  onConfirm: () => void
  onClose: () => void
  cancelling: boolean
}) {
  const t = useTranslations('student.book')
  const locale = useLocale()
  const hours = hoursUntil(lesson.date, lesson.start_time)
  const willRefund = hours >= policyHours
  const credits = bookingInfo.credits_deducted

  const lessonDateStr = new Date(lesson.date + 'T12:00:00').toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-4 pb-20 md:pb-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-full overflow-y-auto">
        <div className="px-6 pt-6 pb-4 space-y-4">
          <h3 className="font-semibold text-gray-900 text-lg">{t('cancelModalTitle')}</h3>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">{t('lessonLabel')}</span>
              <span className="font-medium text-gray-900 text-right">{lesson.courses?.name?.trim() || lessonTypeName(lesson.lesson_types, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('dateLabel')}</span>
              <span className="font-medium text-gray-900">{lessonDateStr}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">{t('timeLabel')}</span>
              <span className="font-medium text-gray-900">{lesson.start_time.slice(0, 5)} – {lesson.end_time.slice(0, 5)}</span>
            </div>
          </div>

          {credits > 0 && (
            willRefund ? (
              <div className="flex items-start gap-2.5 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <span className="text-green-500 mt-0.5">✓</span>
                <p className="text-sm text-green-700">
                  <span className="font-semibold">{t('creditsWillBeRefunded', { count: credits })}</span>{t('cancelBeforePolicy', { policyHours })}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <span className="text-red-500 mt-0.5">⚠️</span>
                <p className="text-sm text-red-700">
                  <span className="font-semibold">{t('creditsWillBeBurned', { count: credits })}</span>{t('cancelAfterPolicy', { hoursLeft: Math.max(0, hours).toFixed(1), policyHours })}
                </p>
              </div>
            )
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onConfirm}
            disabled={cancelling}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 ${
              willRefund ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            {cancelling ? t('cancellingText') : willRefund ? t('yesCancelRefund') : t('yesCancelBurn')}
          </button>
          <button onClick={onClose} disabled={cancelling}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('goBack')}
          </button>
        </div>
      </div>
    </div>
  )
}

type PackageOption = {
  id: string
  price: string
  credits: string
  price_per_lesson?: string
  name_it: string | null
  name_en: string | null
  name_fr: string | null
  name_es: string | null
}

type PurchaseOptions = {
  credit_cost: string
  drop_in: PackageOption | null
  upsell: PackageOption | null
}

function BookPageInner() {
  const t = useTranslations('student.book')
  const locale = useLocale()
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [userCity, setUserCity] = useState('')
  // Filtri a multiselezione (regola di Carlo: i filtri sono sempre multipli)
  const [filterCities, setFilterCities] = useState<string[]>([])
  const [filterCountries, setFilterCountries] = useState<string[]>([])
  // Link condivisibile per scuola: /student/book?school_id=... precompila il filtro
  const urlSchoolId = searchParams.get('school_id') ?? searchParams.get('school') ?? ''
  // ?country=IT (o =Italia): link condivisibile gia' filtrato per paese
  const urlCountry = (searchParams.get('country') ?? '').trim().toLowerCase()
  const [filterSchoolIds, setFilterSchoolIds] = useState<string[]>(urlSchoolId ? [urlSchoolId] : [])
  // null = non ancora verificato; la pagina è pubblica, prenotare richiede login
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  // Dove tornare dopo l'accesso: la lezione da cui e' partita, non la lista
  const [loginNextUrl, setLoginNextUrl] = useState<string | null>(null)
  const [profileSchoolId, setProfileSchoolId] = useState<string | null>(null)
  // Evita il "flash" di lezioni sbagliate: la prima query parte solo DOPO che
  // i filtri predefiniti (città/scuola dal profilo) sono stati applicati.
  const [filtersReady, setFiltersReady] = useState(false)
  // Su mobile i filtri sono chiusi di default (aperti con il bottone "Filtri")
  const [showFilters, setShowFilters] = useState(false)
  const [schoolsInCity, setSchoolsInCity] = useState<SchoolOption[]>([])
  const [accessPackages, setAccessPackages] = useState<AccessPackage[]>([])
  const [subSchools, setSubSchools] = useState<Set<string>>(new Set())
  const refreshAccess = useCallback(async () => {
    const a = await fetchAccess()
    setAccessPackages(a.packages)
    setSubSchools(a.subSchools)
  }, [])
  const [hqCountries, setHqCountries] = useState<{ id: string; name: string; code: string }[]>([])
  const [hqCities, setHqCities] = useState<{ id: string; country_id: string; name: string }[]>([])

  const [bookedMap, setBookedMap] = useState<Record<string, BookingInfo>>({})

  const [booking, setBooking] = useState<string | null>(null)
  // Dopo il POST la scheda resta aperta un attimo col bottone verde "Prenotato":
  // chiuderla subito lasciava il dubbio che il click fosse andato a buon fine.
  const [justBooked, setJustBooked] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<{ [lessonId: string]: string }>({})
  const [confirmLesson, setConfirmLesson] = useState<Lesson | null>(null)
  // Cosa proporre quando i crediti non bastano: prezzo lezione singola della
  // scuola (se ne ha uno che copre questa lezione) e pacchetto piu'
  // conveniente per la riga di confronto.
  const [purchaseOptions, setPurchaseOptions] = useState<PurchaseOptions | null>(null)
  const [buyingDropIn, setBuyingDropIn] = useState(false)
  const [detailLesson, setDetailLesson] = useState<Lesson | null>(null)
  // Calendar is the default view (calendar-first, list on demand)
  const [view, setView] = useState<'list' | 'calendar'>('calendar')
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ lesson: Lesson; info: BookingInfo } | null>(null)
  const [filterLanguages, setFilterLanguages] = useState<string[]>([])
  const [filterLessonTypeIds, setFilterLessonTypeIds] = useState<string[]>([])
  const [filterTeacherIds, setFilterTeacherIds] = useState<string[]>([])
  const [filterFormats, setFilterFormats] = useState<string[]>([])
  // Badge del bottone "Filtri": conta solo i filtri nel pannello richiudibile
  // (Tipo e Formato sono sempre visibili fuori dal pannello, su mobile e PC)
  const activeFilterCount =
    filterCountries.length + filterCities.length + filterSchoolIds.length +
    filterLanguages.length + filterTeacherIds.length

  useEffect(() => {
    apiFetch<{ id: string; name: string; code: string; cities: { id: string; name: string }[] }[]>('/locations/')
      .then((countries) => {
        setHqCountries(countries)
        setHqCities(countries.flatMap((c) => c.cities.map((city) => ({ ...city, country_id: c.id }))))
        if (urlCountry) {
          const match = countries.find(c => c.code.toLowerCase() === urlCountry || c.name.toLowerCase() === urlCountry)
          if (match) setFilterCountries([match.name])
        }
      })
      .catch(() => {})
  }, [urlCountry])

  const paymentSuccess = searchParams.get('payment') === 'success'

  useEffect(() => {
    if (authLoading) return
    setIsAuthed(!!user)
    if (!user) { setFiltersReady(true); return } // anonimo: nessun default da attendere

    async function loadProfile() {
      const profile = await apiFetch<{ city: string; country: string; school: string | null }>('/student/profile/').catch(() => null)

      const c = profile?.city ?? ''
      setUserCity(c)
      if (c) setFilterCities([c])
      // il paese nel link vince sul default del profilo
      if (profile?.country && !urlCountry) setFilterCountries([profile.country])

      const schoolId = profile?.school ?? null
      setProfileSchoolId(schoolId)
      // Non sovrascrivere la scuola arrivata da un link condiviso
      if (schoolId && !urlSchoolId) setFilterSchoolIds([schoolId])
      setFiltersReady(true)

      const [access, upcomingBookings] = await Promise.all([
        fetchAccess(),
        apiFetch<{ id: string; lesson: string; credits_deducted: number; access_source: string }[]>('/student/bookings/?status=upcoming').catch(() => []),
      ])
      setAccessPackages(access.packages)
      setSubSchools(access.subSchools)

      const map: Record<string, BookingInfo> = {}
      for (const b of upcomingBookings) {
        map[b.lesson] = {
          booking_id: b.id,
          credits_deducted: b.credits_deducted,
          access_source: b.access_source,
        }
      }
      setBookedMap(map)
    }
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentSuccess, user, authLoading])

  useEffect(() => {
    apiFetch<SchoolOption[]>('/schools/public/')
      .then(setSchoolsInCity)
      .catch(() => {})
  }, [])

  // Opzioni a cascata: le città seguono i paesi selezionati, le scuole le città
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()
  const selectedCountryIds = new Set(hqCountries.filter(c => filterCountries.includes(c.name)).map(c => c.id))
  const cityOptions = filterCountries.length > 0
    ? hqCities.filter(c => selectedCountryIds.has(c.country_id))
    : hqCities
  const selectedCountryKeys = new Set(hqCountries.filter(c => filterCountries.includes(c.name)).flatMap(c => [norm(c.name), norm(c.code)]))
  const schoolOptions = schoolsInCity.filter(sc => {
    if (filterCities.length > 0) return filterCities.some(ct => norm(sc.city) === norm(ct))
    // country_code: il paese scritto dalla scuola risolto dal server ("Italia" → IT)
    if (filterCountries.length > 0) return selectedCountryKeys.has(norm(sc.country_code)) || selectedCountryKeys.has(norm(sc.country))
    return true
  })

  // cambiando paesi/città, rimuovi selezioni non più coerenti
  function handleCountriesChange(vals: string[]) {
    setFilterCountries(vals)
    if (vals.length > 0) {
      const ids = new Set(hqCountries.filter(c => vals.includes(c.name)).map(c => c.id))
      const allowed = new Set(hqCities.filter(c => ids.has(c.country_id)).map(c => norm(c.name)))
      setFilterCities(prev => prev.filter(ct => allowed.has(norm(ct))))
    }
  }
  function handleCitiesChange(vals: string[]) {
    setFilterCities(vals)
    if (vals.length > 0) {
      const allowed = new Set(vals.map(norm))
      setFilterSchoolIds(prev => prev.filter(id => {
        const sc = schoolsInCity.find(x => x.id === id)
        return sc && allowed.has(norm(sc.city))
      }))
    }
  }

  const fetchLessons = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterSchoolIds.length > 0) {
      params.set('school_id', filterSchoolIds.join(','))
    } else {
      if (filterCountries.length > 0) params.set('country', filterCountries.join(','))
      if (filterCities.length > 0) params.set('city', filterCities.join(','))
    }
    if (filterLanguages.length > 0) params.set('language', filterLanguages.join(','))
    if (filterLessonTypeIds.length > 0) params.set('lesson_type_id', filterLessonTypeIds.join(','))
    if (filterTeacherIds.length > 0) params.set('teacher_id', filterTeacherIds.join(','))
    // formato: con entrambi selezionati equivale a nessun filtro
    if (filterFormats.length === 1) params.set('is_online', filterFormats[0])
    try {
      setLessons(await apiFetch<Lesson[]>(`/student/lessons/?${params.toString()}`))
    } catch {
      setLessons([])
    }
    setLoading(false)
  }, [filterCities, filterSchoolIds, filterLanguages, filterCountries, filterLessonTypeIds, filterTeacherIds, filterFormats])

  useEffect(() => { if (filtersReady) fetchLessons() }, [fetchLessons, filtersReady])

  // Porta subito alla prima lezione utile: se il mese corrente è vuoto
  // (es. agosto senza lezioni), il calendario salta al mese della prima
  // lezione. Nessun giorno pre-selezionato: senza selezione si mostrano
  // tutte le date. Non tocca la navigazione manuale.
  useEffect(() => {
    if (loading || lessons.length === 0) return
    const dates = [...new Set(lessons.map(l => l.date))].sort()
    if (!dates.some(d => d.startsWith(calMonth))) setCalMonth(dates[0].slice(0, 7))
    setSelectedDay(prev => (prev && !dates.includes(prev) ? null : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, loading])

  // Ritorno dal flusso pacchetto (§5.3): la modale si riapre da sola sulla
  // lezione di partenza, con i crediti appena comprati. Un tap e ha finito,
  // invece di doverla ricercare in mezzo al calendario. Si arma una sola
  // volta: dopo, l'allieva e' libera di chiudere e navigare.
  const resumeLessonId = searchParams.get('resume_lesson')
  const [resumeDone, setResumeDone] = useState(false)
  useEffect(() => {
    if (!resumeLessonId || resumeDone || loading) return
    const target = lessons.find(l => l.id === resumeLessonId)
    if (lessons.length === 0) return
    setResumeDone(true)
    if (target) setConfirmLesson(target)
    else setBookingError(e => ({ ...e, [resumeLessonId]: t('lessonNoLongerAvailable') }))
  }, [resumeLessonId, resumeDone, loading, lessons, t])

  // Anonima che clicca "Prenota": la modale si apre lo stesso e mostra
  // quanto costa. Chiedere l'account prima ancora di dire il prezzo faceva
  // scappare chi stava solo valutando; il muro arriva quando sceglie di
  // pagare, che e' dove se lo aspetta.
  async function handleBookClick(lesson: Lesson) {
    setConfirmLesson(lesson)
  }

  // Ripresa dopo login/registrazione: si torna sulla stessa lezione con la
  // modale gia' riaperta (stesso meccanismo del ritorno dai pacchetti).
  function requireAuth(lesson: Lesson) {
    setConfirmLesson(null)
    // school_id: login/registrazione iscrivono l'allieva alla scuola della lezione
    setLoginNextUrl(`/student/book?resume_lesson=${lesson.id}&school_id=${lesson.school}`)
    setShowLoginPrompt(true)
  }

  // Dopo login/registrazione si torna qui, conservando il filtro scuola del link
  const nextUrl = `/student/book${filterSchoolIds.length === 1 ? `?school_id=${filterSchoolIds[0]}` : ''}`

  // Il confronto in cifre col pacchetto piu' conveniente. Si mostra solo se
  // conviene DAVVERO: se il pacchetto costa piu' del prezzo lezione singola,
  // scriverlo sotto un bottone che promette risparmio sarebbe una bugia.
  // C'e' qualcosa da comprare per questa lezione? Se no, promettere "scegli
  // come vuoi prenotare" sarebbe una presa in giro: non c'e' niente da
  // scegliere.
  const hasSomethingToBuy = Boolean(purchaseOptions?.drop_in || purchaseOptions?.upsell)

  const upsellLine = (() => {
    const up = purchaseOptions?.upsell
    if (!up?.price_per_lesson) return null
    const dropIn = purchaseOptions?.drop_in
    if (dropIn && Number(up.price_per_lesson) >= Number(dropIn.price)) return null
    return t('upsellLine', { name: localizedName(up, locale), price: up.price_per_lesson })
  })()

  // Opzione ①: si paga solo questa lezione e la prenotazione la fa il webhook
  // appena il pagamento passa — l'allieva non deve ritrovare la lezione a mano.
  async function buyDropIn() {
    if (!confirmLesson || !purchaseOptions?.drop_in) return
    if (!isAuthed) { requireAuth(confirmLesson); return }
    setBuyingDropIn(true)
    try {
      const data = await apiFetch<{ url: string }>('/stripe/checkout/', {
        method: 'POST',
        body: JSON.stringify({
          type: 'package',
          product_id: purchaseOptions.drop_in.id,
          lesson_id: confirmLesson.id,
          redirect_to: '/student/bookings',
        }),
      })
      window.location.href = data.url
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string; reason?: string }) : null
      // La lezione puo' essersi riempita mentre la modale era aperta: il
      // backend se ne accorge PRIMA di mandarla su Stripe, e nessuno paga per
      // una lezione che non potra' avere.
      const message =
        body?.error === 'school_not_connected' ? t('schoolNotConnected')
        : body?.error === 'lesson_not_bookable' ? (body.reason === 'full' ? t('full') : t('bookingFailed'))
        : t('bookingFailed')
      setBookingError(e => ({ ...e, [confirmLesson.id]: message }))
      setConfirmLesson(null)
      setBuyingDropIn(false)
    }
  }

  async function confirmBook() {
    if (!confirmLesson) return
    const lessonId = confirmLesson.id
    setBooking(lessonId)
    setBookingError(e => ({ ...e, [lessonId]: '' }))
    try {
      const data = await apiFetch<{ id: string; access_source: string }>('/bookings/', {
        method: 'POST',
        body: JSON.stringify({ lesson: lessonId }),
      })
      const creditCostUsed = confirmLesson.courses?.credit_cost ?? 1
      setBookedMap(m => ({
        ...m,
        [lessonId]: {
          booking_id: data.id,
          credits_deducted: creditCostUsed,
          access_source: data.access_source ?? 'package',
        },
      }))
      setLessons(prev => prev.map(l =>
        l.id === lessonId ? { ...l, current_bookings: l.current_bookings + 1 } : l
      ))
      // Scala subito i crediti dal primo pacchetto che copre la lezione, poi
      // riallinea col server (che sceglie il pacchetto con le sue priorita')
      setAccessPackages(prev => {
        const i = prev.findIndex(p => packageCovers(p, confirmLesson))
        return i < 0 ? prev : prev.map((p, j) => j === i ? { ...p, credits_remaining: p.credits_remaining - creditCostUsed } : p)
      })
      void refreshAccess()
      window.dispatchEvent(new Event('credits-changed'))
      setJustBooked(true)
      setTimeout(() => {
        setConfirmLesson(null)
        setJustBooked(false)
      }, 1800)
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      const errKey = errCode ? BOOKING_ERROR_KEYS[errCode] : undefined
      const message = errCode === 'documents_required'
        ? t('documentsRequired', { documents: '' })
        : errKey ? t(errKey) : t('bookingFailed')
      setBookingError(e => ({ ...e, [lessonId]: message }))
      setConfirmLesson(null)
    }
    setBooking(null)
  }

  async function handleCancel() {
    if (!cancelTarget) return
    const { lesson, info } = cancelTarget
    setCancelling(info.booking_id)
    setCancelTarget(null)
    try {
      const resData = await apiFetch<{ credit_refunded: boolean }>(`/bookings/${info.booking_id}/`, { method: 'DELETE' })
      setBookedMap(m => {
        const next = { ...m }
        delete next[lesson.id]
        return next
      })
      setLessons(prev => prev.map(l =>
        l.id === lesson.id ? { ...l, current_bookings: Math.max(0, l.current_bookings - 1) } : l
      ))
      // Il rimborso torna sul pacchetto d'origine: lo sa solo il server
      if (resData.credit_refunded && info.credits_deducted > 0) void refreshAccess()
      window.dispatchEvent(new Event('credits-changed'))
    } catch {
      // no-op: booking stays in list, user can retry
    }
    setCancelling(null)
  }

  const uniqueLessonTypes = Array.from(
    new Map(lessons.filter(l => l.lesson_type && l.lesson_types).map(l => [l.lesson_type!, { ...l.lesson_types!, id: l.lesson_type! }])).values()
  )
  const uniqueTeachers = Array.from(
    new Map(lessons.filter(l => l.teacher && l.teachers).map(l => [l.teacher!, { ...l.teachers!, id: l.teacher! }])).values()
  )

  const grouped: { [date: string]: Lesson[] } = {}
  for (const l of lessons) {
    if (!grouped[l.date]) grouped[l.date] = []
    grouped[l.date].push(l)
  }
  const sortedDates = Object.keys(grouped).sort()
  // In vista calendario: giorno selezionato → solo quello; nessuna selezione → tutte le date
  const visibleDates = view === 'calendar' && selectedDay ? sortedDates.filter(d => d === selectedDay) : sortedDates

  function formatDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
  }

  const creditCost = confirmLesson?.courses?.credit_cost ?? 1
  // `|| justBooked`: il POST scala subito i crediti locali, e se erano gli
  // ultimi la scheda saltava al ramo "crediti insufficienti" prima ancora
  // che si vedesse il bottone verde "Prenotato".
  const confirmHasCredits = justBooked || (confirmLesson
    ? subSchools.has(confirmLesson.school) || accessPackages.some(p => packageCovers(p, confirmLesson))
    : false)

  // Le opzioni si chiedono solo quando servono davvero: modale aperta e
  // crediti insufficienti. Una lezione prenotabile col portafoglio non deve
  // pagare una chiamata in piu'.
  useEffect(() => {
    if (!confirmLesson || confirmHasCredits) { setPurchaseOptions(null); return }
    let alive = true
    apiFetch<PurchaseOptions>(`/student/lessons/${confirmLesson.id}/purchase-options/`)
      .then(opts => { if (alive) setPurchaseOptions(opts) })
      .catch(() => { if (alive) setPurchaseOptions(null) })
    return () => { alive = false }
  }, [confirmLesson, confirmHasCredits])


  return (
    <div>
      {/* Login/registrazione richiesta per prenotare (utente anonimo) */}
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
                onClick={() => router.push(`/register?next=${encodeURIComponent(loginNextUrl ?? nextUrl)}`)}
                className="w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition"
              >
                {t('registerButton')}
              </button>
              <button
                onClick={() => router.push(`/login?next=${encodeURIComponent(loginNextUrl ?? nextUrl)}`)}
                className="w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition"
              >
                {t('signInButton')}
              </button>
              <button
                onClick={() => setShowLoginPrompt(false)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
              >
                {t('cancelButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm booking modal */}
      {confirmLesson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 py-4 pb-20 md:pb-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-full overflow-y-auto">
            <div className="px-6 pt-6 pb-4">
              <h3 className="font-semibold text-gray-900 text-lg mb-1">{t('confirmBookingTitle')}</h3>
              <p className="text-sm text-gray-500 mb-4">
                {confirmLesson.courses?.name?.trim() || lessonTypeName(confirmLesson.lesson_types, locale)}
              </p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('dateLabel')}</span>
                  <span className="font-medium text-gray-900">{new Date(confirmLesson.date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('timeLabel')}</span>
                  <span className="font-medium text-gray-900">{confirmLesson.start_time.slice(0, 5)} – {confirmLesson.end_time.slice(0, 5)}</span>
                </div>
                {confirmLesson.teachers && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('teacherLabel')}</span>
                    <span className="font-medium text-gray-900">{confirmLesson.teachers.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('schoolLabel')}</span>
                  <span className="font-medium text-gray-900">{confirmLesson.schools?.name}</span>
                </div>
                {/* I crediti si vedono solo a chi sta per spenderli davvero.
                    A chi non li ha (o non ha nemmeno un account) "1 credito"
                    non dice niente: quello che le serve sapere e' quanto costa
                    in euro, e lo dicono il bottone e la riga di confronto qui
                    sotto. Cosi' la scheda e' la stessa con o senza pacchetti. */}
                {isAuthed && confirmHasCredits && (
                  <div className="border-t border-gray-200 pt-2 flex justify-between">
                    <span className="text-gray-500">{t('creditsToDeduct')}</span>
                    <span className="text-gray-500 text-xs">{t('creditsCount', { count: creditCost })}</span>
                  </div>
                )}
              </div>
              {/* A un'anonima "Crediti Insufficienti" non dice niente: non ha
                  crediti perche' non ha un account. Stesso posto, messaggio e
                  tono diversi — informativo, non un avviso. */}
              {!confirmHasCredits && (isAuthed || hasSomethingToBuy) && (
                <div className={`mt-3 p-3 rounded-xl text-sm border ${
                  isAuthed
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'
                }`}>
                  {isAuthed ? t('notEnoughCredits') : t('accountNeededHint')}
                </div>
              )}
            </div>
            {confirmHasCredits ? (
              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={confirmBook}
                  disabled={!!booking || justBooked}
                  className={`flex-1 py-2.5 text-white rounded-xl text-sm font-medium transition ${
                    justBooked
                      ? 'bg-green-600 disabled:opacity-100'
                      : 'bg-brand hover:bg-brand-hover disabled:opacity-50'
                  }`}
                >
                  {justBooked ? `✓ ${t('booked')}` : booking ? t('bookingInProgress') : t('yesBookNow')}
                </button>
                <button
                  onClick={() => setConfirmLesson(null)}
                  disabled={!!booking || justBooked}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
                >
                  {t('cancelButton')}
                </button>
              </div>
            ) : (
              <div className="px-6 pb-6 flex flex-col gap-2">
                {/* ① Solo questa lezione: si paga e resta prenotata, senza dover
                    ritrovare la lezione al ritorno da Stripe. Basta che la scuola
                    abbia un prezzo lezione singola che la copre: se poi non ha
                    collegato Stripe l'errore arriva al click, esattamente come
                    per l'acquisto di un pacchetto. */}
                {purchaseOptions?.drop_in && (
                  <button
                    onClick={buyDropIn}
                    disabled={buyingDropIn}
                    className="w-full py-2.5 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover transition disabled:opacity-50"
                  >
                    {buyingDropIn
                      ? t('redirecting')
                      : t('buyThisLessonButton', { price: purchaseOptions.drop_in.price })}
                    <span className="block text-[11px] font-normal opacity-80">{t('buyThisLessonHint')}</span>
                  </button>
                )}
                {/* ② Pacchetto: stesso rosa del filtro "Tipo lezione" (#E7AFB2),
                    cosi' e' riconoscibile come l'altro punto d'ingresso della
                    pagina. Si torna qui con la modale riaperta, un tap esplicito
                    (§7.3): chi compra dieci lezioni puo' star comprando per il
                    mese, non per questa lezione.
                    Compare SOLO se esiste davvero un pacchetto che copre questa
                    lezione: mandarla a comprare in una vetrina dove nulla vale
                    per la lezione che sta guardando le farebbe spendere male. */}
                {purchaseOptions?.upsell && (
                  <>
                    <button
                      onClick={() => {
                        if (!isAuthed) { requireAuth(confirmLesson); return }
                        const lessonId = confirmLesson.id
                        setConfirmLesson(null)
                        router.push(`/student/buy?redirect=/student/book&lesson_id=${lessonId}`)
                      }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold text-gray-800 bg-[#E7AFB2] hover:bg-[#dfa0a3] shadow-sm transition"
                    >
                      {t('buyCreditsButton')}
                    </button>
                    {/* Subito sotto il bottone che spiega: il confronto in cifre
                        e' la motivazione di QUEL bottone, non un'altra scelta.
                        Nascosto se il pacchetto non conviene davvero — sotto un
                        bottone che promette risparmio sarebbe una bugia. */}
                    {upsellLine && <p className="px-1 text-xs text-gray-500">{upsellLine}</p>}
                  </>
                )}
                {/* Nessuna delle due strade: meglio dirlo che lasciare la sola
                    "Annulla" senza spiegazione. */}
                {purchaseOptions && !hasSomethingToBuy && (
                  <p className="px-1 text-xs text-gray-500">{t('noPurchaseOption')}</p>
                )}
                <button
                  onClick={() => setConfirmLesson(null)}
                  className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  {t('cancelButton')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {cancelTarget && (
        <CancelModal
          lesson={cancelTarget.lesson}
          bookingInfo={cancelTarget.info}
          policyHours={cancelTarget.lesson.schools?.cancellation_policy_hours ?? 24}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
          cancelling={!!cancelling}
        />
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Su mobile i filtri partono chiusi: prima le lezioni, i filtri a richiesta */}
      <button
        onClick={() => setShowFilters(v => !v)}
        className="md:hidden mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
        </svg>
        {t('filtersButton')}
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-brand text-white text-xs font-semibold">{activeFilterCount}</span>
        )}
        <span className="text-gray-400">{showFilters ? '▴' : '▾'}</span>
      </button>

      {/* Filters — tutti a multiselezione */}
      <div className={`mb-5 flex-wrap gap-3 items-end ${showFilters ? 'flex' : 'hidden'} md:flex`}>
        {hqCountries.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('labelCountry')}</label>
            <MultiFilterSelect label={t('allCountries')} selected={filterCountries}
              options={hqCountries.map((c) => ({ value: c.name, label: countryName(c.code, locale, c.name) }))}
              onChange={handleCountriesChange} />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('labelCity')}</label>
          <MultiFilterSelect label={t('allCities')} selected={filterCities}
            options={cityOptions.map((c) => ({ value: c.name, label: cityDisplayName(c.name, locale) }))}
            onChange={handleCitiesChange} />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('labelSchool')}</label>
          <MultiFilterSelect label={t('allSchools')} selected={filterSchoolIds}
            options={schoolOptions.map((sc) => ({ value: sc.id, label: sc.name }))}
            onChange={setFilterSchoolIds} />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('labelLanguage')}</label>
          <MultiFilterSelect label={t('allLanguages')} selected={filterLanguages}
            options={COURSE_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
            onChange={setFilterLanguages} />
        </div>

        {/* il filtro insegnante sparisce se le scuole visibili lo nascondono alle allieve */}
        {uniqueTeachers.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('labelTeacher')}</label>
            <MultiFilterSelect label={t('allTeachers')} selected={filterTeacherIds}
              options={uniqueTeachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
              onChange={setFilterTeacherIds} />
          </div>
        )}

        {userCity && !filterCities.includes(userCity) && (
          <button onClick={() => { setFilterCities([userCity]); setFilterSchoolIds(profileSchoolId ? [profileSchoolId] : []) }} className="text-xs text-brand hover:underline pb-2.5">
            {t('resetToMyCity')}
          </button>
        )}
        {(filterCities.length > 0 || filterCountries.length > 0 || filterSchoolIds.length > 0 || filterLanguages.length > 0 || filterLessonTypeIds.length > 0 || filterTeacherIds.length > 0 || filterFormats.length > 0) && (
          <button onClick={() => { setFilterCities([]); setFilterCountries([]); setFilterSchoolIds([]); setFilterLanguages([]); setFilterLessonTypeIds([]); setFilterTeacherIds([]); setFilterFormats([]) }} className="text-xs text-gray-400 hover:text-gray-600 pb-2.5">
            {t('clearFilters')}
          </button>
        )}
      </div>

      {/* Tipo e Formato: sempre visibili (mobile e PC), subito prima del calendario.
          Il Tipo è evidenziato — molte allieve partono da lì — e mostra la foto del corso. */}
      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">{t('labelType')}</label>
          <MultiFilterSelect prominent label={t('allTypes')} selected={filterLessonTypeIds}
            options={uniqueLessonTypes.map((lt) => ({
              value: lt.id,
              label: lessonTypeName(lt, locale) || lt.name_en,
              image: imageUrlForLocale(lt, locale) ?? youtubeThumbnail(videoUrlForLocale(lt, locale)),
            }))}
            onChange={setFilterLessonTypeIds} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">{t('labelFormat')}</label>
          <MultiFilterSelect prominent accent="#CCD2D5" label={t('filterAllFormats')} selected={filterFormats}
            options={[{ value: 'true', label: t('filterOnline') }, { value: 'false', label: t('filterInPerson') }]}
            onChange={setFilterFormats} />
        </div>
      </div>

      <>
      {/* Toggle vista elenco/calendario — bordo colorato per evidenziarlo */}
      <div className="inline-flex bg-white border-2 border-brand/40 rounded-xl p-1 mb-4">
        <button onClick={() => setView('calendar')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${view === 'calendar' ? 'bg-brand text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>
          {t('viewCalendar')}
        </button>
        <button onClick={() => setView('list')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${view === 'list' ? 'bg-brand text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>
          {t('viewList')}
        </button>
      </div>

      {view === 'calendar' && !loading && (
        <BookingCalendar
          lessons={lessons}
          month={calMonth}
          onMonthChange={setCalMonth}
          selectedDay={selectedDay}
          onSelectDay={(d) => setSelectedDay(prev => (prev === d ? null : d))}
        />
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loadingLessons')}</div>
      ) : lessons.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">{filterCities.length === 1 ? t('noLessonsFoundIn', { city: cityDisplayName(filterCities[0], locale) }) : t('noLessonsFound')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {visibleDates.map((date) => (
            <div key={date}>
              <p className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">{formatDate(date)}</p>
              <div className="space-y-3">
                {grouped[date].map((lesson) => {
                  const isFull = lesson.current_bookings >= lesson.max_capacity
                  const err = bookingError[lesson.id]
                  const spotsLeft = lesson.max_capacity - lesson.current_bookings
                  const bookedInfo = bookedMap[lesson.id]
                  const isBooked = !!bookedInfo
                  const isCancellingThis = cancelling === bookedInfo?.booking_id

                  const policyHours = lesson.schools?.cancellation_policy_hours ?? 24
                  const hoursLeft = hoursUntil(lesson.date, lesson.start_time)
                  const willRefund = hoursLeft >= policyHours

                  return (
                    <div
                      key={lesson.id}
                      className={`bg-white rounded-xl border p-4 flex gap-4 items-start transition ${
                        isBooked ? 'border-green-200 bg-green-50/30' : 'border-gray-100'
                      }`}
                    >
                      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: lesson.courses?.color ?? '#6B1F3A' }} />
                      {(() => {
                        const video = videoUrlForLocale(lesson.lesson_types, locale)
                        const img = imageUrlForLocale(lesson.lesson_types, locale) ?? lesson.courses?.image_url ?? youtubeThumbnail(video)
                        return (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDetailLesson(lesson) }}
                            className="relative shrink-0 block group" title={t('videoPreview')}>
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg" />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                </svg>
                              </div>
                            )}
                            <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </span>
                          </button>
                        )
                      })()}
                      <div className="flex-1 min-w-0">
                        {/* Nome a riga intera; orario/posti/azione in fondo alla card */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 text-sm">{lesson.courses?.name?.trim() || lessonTypeName(lesson.lesson_types, locale)}</p>
                          {isBooked && (
                            <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">{t('booked')}</span>
                          )}
                        </div>
                        {/* niente ripetizione: il tipo compare qui solo se il titolo è un nome corso personalizzato */}
                        <p className="text-xs text-gray-400 mt-0.5">
                          {lesson.courses?.name?.trim() ? `${lessonTypeName(lesson.lesson_types, locale)} · ` : ''}
                          {lesson.schools?.name}
                          {(() => {
                            const lvl = lesson.lesson_types?.level
                            const lvlLabel = lvl === 'entry' ? t('levelEntry') : lvl === 'intermediate' ? t('levelIntermediate') : lvl === 'advanced' ? t('levelAdvanced') : null
                            const dur = lessonDurationMin(lesson.start_time, lesson.end_time)
                            return <>{lvlLabel && ` · ${lvlLabel}`}{dur && ` · ${dur} min`}</>
                          })()}
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
                          {lesson.is_online ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded font-medium">🌐 Online</span>
                          ) : (
                            lesson.school_rooms && (
                              <span>📍 {lesson.school_rooms.school_locations?.name ?? ''} · {lesson.school_rooms.name}</span>
                            )
                          )}
                          {lesson.teachers && <span>👤 {lesson.teachers.name}</span>}
                          <span>{t('creditsCount', { count: lesson.courses?.credit_cost ?? 1 })}</span>
                          {(lesson.language || lesson.courses?.language) && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-500">
                              {languageLabel(lesson.language || lesson.courses?.language)}
                            </span>
                          )}
                        </div>
                        {(lesson.courses?.notes || lesson.notes) && (
                          <div className="mt-2 space-y-0.5">
                            {lesson.courses?.notes && <p className="text-xs text-gray-500">{lesson.courses.notes}</p>}
                            {lesson.notes && <p className="text-xs text-gray-500">{lesson.notes}</p>}
                          </div>
                        )}
                        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}

                        {/* Riga finale: orario a sinistra, posti + azione a destra.
                            Se l'allieva e' gia' prenotata la disponibilita' non la
                            riguarda piu': il posto ce l'ha, restano solo il badge
                            "Prenotato" e l'annullamento. */}
                        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                          <p className="text-sm font-bold text-gray-900">
                            {lesson.start_time.slice(0, 5)}
                            <span className="text-gray-400 font-normal"> – {lesson.end_time.slice(0, 5)}</span>
                          </p>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            {!isBooked && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isFull ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                {isFull ? t('full') : t('spotsLeft', { count: spotsLeft })}
                              </span>
                            )}

                            {isBooked ? (
                              <>
                                {/* Grigio, non verde: il verde in questa
                                    pagina vuol dire "prenotato" e "ci sono
                                    posti". "Rimborsabile" e' un'informazione
                                    neutra sulla politica di cancellazione —
                                    tre verdi accanto non si distinguono piu'.
                                    Resta ambra quando il credito si brucia,
                                    perche' li' c'e' qualcosa da sapere. */}
                                {bookedInfo.credits_deducted > 0 && (
                                  <span className={`text-[10px] font-medium ${willRefund ? 'text-gray-400' : 'text-amber-600'}`}>
                                    {willRefund ? t('refundable') : t('willBurn')}
                                  </span>
                                )}
                                {lesson.is_online && lesson.online_link && (
                                  <a
                                    href={lesson.online_link.startsWith('http') ? lesson.online_link : `https://${lesson.online_link}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition"
                                  >
                                    🌐 Join
                                  </a>
                                )}
                                <button
                                  onClick={() => setCancelTarget({ lesson, info: bookedInfo })}
                                  disabled={isCancellingThis}
                                  className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50 transition disabled:opacity-40"
                                >
                                  {isCancellingThis ? '...' : t('cancelBooking')}
                                </button>
                              </>
                            ) : booking === lesson.id ? (
                              <span className="text-xs text-gray-400">{t('bookingInProgress')}</span>
                            ) : (
                              <button
                                onClick={() => {
                                  if (isFull) return
                                  handleBookClick(lesson)
                                }}
                                disabled={isFull || !!booking}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium transition bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
                              >
                                {t('bookButton')}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}</>

      {/* Dettaglio corso: descrizione, video, sede e mappa */}
      {detailLesson && (
        <LessonDetailModal lesson={detailLesson} locale={locale} onClose={() => setDetailLesson(null)} />
      )}
    </div>
  )
}

// Durata in minuti da orario inizio/fine ("17:00","18:10" → 70)
function lessonDurationMin(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const d = (eh * 60 + em) - (sh * 60 + sm)
  return d > 0 ? d : null
}


type AccessPackage = {
  school: string
  credits_remaining: number
  status: string
  starts_at: string | null
  expires_at: string | null
  package_allowed_lesson_types: string[]
  package_lesson_type_restriction: string | null
  package_mode_filter: string | null
}

async function fetchAccess(): Promise<{ packages: AccessPackage[]; subSchools: Set<string> }> {
  const [allPkgs, allSubs] = await Promise.all([
    apiFetch<AccessPackage[]>('/student/packages/').catch(() => [] as AccessPackage[]),
    apiFetch<{ school: string; status: string }[]>('/student/subscriptions/').catch(() => [] as { school: string; status: string }[]),
  ])
  const now = new Date()
  return {
    // Number(): i crediti sono Decimal lato server; qui si confrontano col costo
    packages: allPkgs.map((p) => ({ ...p, credits_remaining: Number(p.credits_remaining) })).filter(
      (p) => p.status === 'active' && p.credits_remaining > 0 && (!p.expires_at || new Date(p.expires_at) > now)
    ),
    subSchools: new Set(allSubs.filter((s) => s.status === 'active').map((s) => s.school)),
  }
}

// Specchio di bookings/services._active_package: validita' alla data della
// lezione, crediti, tipo di lezione, modalita'. Sommare i crediti per scuola
// non bastava: con 285 crediti su pacchetti che coprono altri tipi la scheda
// diceva "20 crediti" e il server rispondeva no_valid_access. Il tetto
// settimanale resta solo lato server.
function packageCovers(p: AccessPackage, lesson: Lesson): boolean {
  if (p.school !== lesson.school) return false
  if (p.credits_remaining < (lesson.courses?.credit_cost ?? 1)) return false
  const lessonAt = new Date(`${lesson.date}T${lesson.start_time}`)
  if (p.starts_at && new Date(p.starts_at) > lessonAt) return false
  if (p.expires_at && new Date(p.expires_at) < lessonAt) return false
  const allowed = p.package_allowed_lesson_types ?? []
  if (allowed.length) {
    if (!lesson.lesson_type || !allowed.includes(lesson.lesson_type)) return false
  } else {
    const r = p.package_lesson_type_restriction
    if (r && r !== 'all' && r !== lesson.lesson_type) return false
  }
  const mode = p.package_mode_filter
  if (mode && mode !== 'all' && lesson.is_online !== (mode === 'online')) return false
  return true
}

// I codici del backend (BookingError) diventano frasi: "no_valid_access"
// nudo in rosso sotto la lezione non dice niente a un'allieva.
const BOOKING_ERROR_KEYS: Record<string, string> = {
  no_valid_access: 'errNoValidAccess',
  full: 'errFull',
  already_booked: 'errAlreadyBooked',
  min_notice: 'errMinNotice',
  lesson_not_bookable: 'errLessonNotBookable',
}

export default function BookPage() {
  return (
    <Suspense>
      <BookPageInner />
    </Suspense>
  )
}


// Modal dettaglio lezione: media (se presenti) + descrizione + sede con Google Maps
function LessonDetailModal({ lesson, locale, onClose }: { lesson: Lesson; locale: string; onClose: () => void }) {
  const t = useTranslations('student.book')
  const lt = lesson.lesson_types
  const video = videoUrlForLocale(lt, locale)
  const img = imageUrlForLocale(lt, locale) ?? lesson.courses?.image_url ?? youtubeThumbnail(video)
  const desc = lt ? ({ it: lt.description_it, en: lt.description_en, fr: lt.description_fr, es: lt.description_es } as Record<string, string | null>)[locale] ?? lt.description_en : null
  const loc = lesson.school_rooms?.school_locations
  const mapsUrl = loc?.google_maps_url || (loc?.address ? `https://maps.google.com/?q=${encodeURIComponent(loc.address)}` : null)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 pb-20 md:pb-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <VideoPreviewPlayer video={video} image={img} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-gray-900 text-lg">
              {lesson.courses?.name?.trim() || lessonTypeName(lt, locale)}
            </h3>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
          </div>
          {desc && <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{desc}</p>}

          {/* Insegnante: foto (o avatar con iniziali) + nome */}
          {lesson.teachers && (
            <div className="mt-4 flex items-center gap-3">
              {lesson.teachers.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lesson.teachers.photo_url} alt={lesson.teachers.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center text-sm font-semibold shrink-0">
                  {lesson.teachers.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{lesson.teachers.name}</p>
                <p className="text-xs text-gray-400">{t('teacherLabel')}</p>
              </div>
            </div>
          )}

          {/* Sede: indirizzo completo + Google Maps */}
          {(loc || lesson.is_online) && (
            <div className="mt-4 bg-gray-50 rounded-xl p-3">
              {lesson.is_online ? (
                <p className="text-sm text-gray-600">🌐 {t('onlineLesson')}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-800">📍 {loc?.name}{lesson.school_rooms?.name ? ` — ${lesson.school_rooms.name}` : ''}</p>
                  {loc?.address && <p className="text-xs text-gray-500 mt-0.5">{loc.address}</p>}
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 mt-2 text-sm text-brand font-medium hover:underline">
                      {t('openInMaps')} ↗
                    </a>
                  )}
                </>
              )}
            </div>
          )}

          {video && (
            <a href={video} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm text-brand font-medium hover:underline">
              {t('videoPreview')} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}


// Griglia mensile: giorni con lezioni evidenziati, click → elenco del giorno
function BookingCalendar({ lessons, month, onMonthChange, selectedDay, onSelectDay }: {
  lessons: Lesson[]
  month: string // 'YYYY-MM'
  onMonthChange: (m: string) => void
  selectedDay: string | null
  onSelectDay: (d: string | null) => void
}) {
  const t = useTranslations('student.book')
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const startOffset = (first.getDay() + 6) % 7 // lunedì = 0
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = Math.ceil((startOffset + daysInMonth) / 7) * 7

  const byDay = new Map<string, Lesson[]>()
  for (const l of lessons) {
    if (!byDay.has(l.date)) byDay.set(l.date, [])
    byDay.get(l.date)!.push(l)
  }

  function shift(delta: number) {
    const d = new Date(y, m - 1 + delta, 1)
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    onSelectDay(null)
  }

  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  // 1-7 giugno 2026 = lunedì→domenica: la griglia è a base lunedì e le
  // etichette devono esserlo (prima erano sfalsate di un giorno).
  const dayNames = [1, 2, 3, 4, 5, 6, 7].map(d => new Date(2026, 5, d).toLocaleDateString(undefined, { weekday: 'short' }))
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 mb-6 max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-700 text-lg font-bold leading-none transition" aria-label={t('previousMonth')}>‹</button>
        <p className="text-sm font-semibold text-gray-900 capitalize">{monthLabel}</p>
        <button onClick={() => shift(1)} className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-700 text-lg font-bold leading-none transition" aria-label={t('nextMonth')}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-gray-400 uppercase mb-1">
        {dayNames.map((d, i) => <div key={i}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: cells }, (_, i) => {
          const dayNum = i - startOffset + 1
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />
          const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
          const dayLessons = byDay.get(dateStr) ?? []
          const isSelected = selectedDay === dateStr
          const isPast = dateStr < today
          return (
            <button
              key={i}
              onClick={() => dayLessons.length ? onSelectDay(isSelected ? null : dateStr) : undefined}
              className={`aspect-square rounded-lg text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                isSelected ? 'bg-brand text-white'
                : dayLessons.length ? 'bg-brand/5 hover:bg-brand/10 text-gray-900 cursor-pointer'
                : 'text-gray-300'
              } ${isPast && !isSelected ? 'opacity-40' : ''}`}
            >
              <span>{dayNum}</span>
              {dayLessons.length > 0 && (
                <span className="flex gap-0.5">
                  {dayLessons.slice(0, 3).map((l, j) => (
                    <span key={j} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : ''}`}
                      style={isSelected ? {} : { backgroundColor: l.courses?.color ?? '#6B1F3A' }} />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {!selectedDay && <p className="text-xs text-gray-400 mt-3 text-center">{t('calendarHint')}</p>}
    </div>
  )
}
