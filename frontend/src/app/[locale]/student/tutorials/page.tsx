'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { locales } from '@/i18n/routing'
import { useRouter } from '@/navigation'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch, apiUrl } from '@/lib/api/client'
import { useStudentTutorialsEnabled } from '@/lib/brand'
import { languageDisplayName } from '@/lib/language-names'
import { getEmbedUrl, getVideoThumbnail, isEmbedUrl } from '@/lib/video-embed'

// Pagina pubblica (come Calendario e Acquista): si legge senza login.
// Backend: GET /api/tutorials/ (library/views.py, PublicTutorialsView).
type Tutorial = {
  id: string
  title: string
  description: string
  type: 'video' | 'pdf'
  language: string
  topic: string
  video_url: string
  file_url: string | null
  file_name: string
  thumbnail_url: string
}

export default function StudentTutorialsPage() {
  const t = useTranslations('student.tutorials')
  const uiLocale = useLocale()
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  // Voce spenta da HQ: la pagina resta raggiungibile dall'URL, quindi si
  // rimanda indietro come fa il Negozio (null = non ancora noto, si aspetta).
  const tutorialsEnabled = useStudentTutorialsEnabled()
  useEffect(() => {
    if (tutorialsEnabled === false) router.replace(user ? '/student/dashboard' : '/')
  }, [tutorialsEnabled, router, user])
  const [items, setItems] = useState<Tutorial[]>([])
  const [loading, setLoading] = useState(true)
  const [filterLang, setFilterLang] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string[]>([])
  const [filterTopic, setFilterTopic] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<Tutorial | null>(null)
  const [videoError, setVideoError] = useState(false)
  const defaultLanguageApplied = useRef(false)

  const langName = (code: string) => languageDisplayName(code, uiLocale)

  useEffect(() => {
    apiFetch<Tutorial[]>('/tutorials/')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // Lingua di partenza: quella del profilo (il selettore in alto la tiene
  // allineata alla UI), per chi non è loggata quella dell'URL. Una volta
  // sola: da lì in poi comanda il filtro, che si può allargare ad altre lingue.
  useEffect(() => {
    if (authLoading || defaultLanguageApplied.current) return
    defaultLanguageApplied.current = true
    const preferred = user?.language_preference || uiLocale
    setFilterLang([(locales as readonly string[]).includes(preferred) ? preferred : uiLocale])
  }, [authLoading, user?.language_preference, uiLocale])

  // Le lingue proposte sono quelle in cui esiste almeno un tutorial, più
  // quella preselezionata (così si può deselezionare anche se è vuota).
  const languageOptions = useMemo(() => {
    const codes = new Set<string>([...items.map((i) => i.language), ...filterLang])
    return [...codes]
      .map((code) => ({ value: code, label: langName(code) }))
      .sort((a, b) => a.label.localeCompare(b.label, uiLocale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filterLang, uiLocale])

  // Gli argomenti sono scritti nella lingua del tutorial: le opzioni
  // seguono le lingue selezionate.
  const topicOptions = useMemo(() => {
    const pool = filterLang.length ? items.filter((i) => filterLang.includes(i.language)) : items
    return [...new Set(pool.map((i) => i.topic).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, uiLocale))
      .map((topic) => ({ value: topic, label: topic }))
  }, [items, filterLang, uiLocale])

  const needle = query.trim().toLocaleLowerCase(uiLocale)
  const visible = items.filter(
    (i) =>
      (!filterLang.length || filterLang.includes(i.language)) &&
      (!filterType.length || filterType.includes(i.type)) &&
      (!filterTopic.length || filterTopic.includes(i.topic)) &&
      (!needle || `${i.title} ${i.description} ${i.topic}`.toLocaleLowerCase(uiLocale).includes(needle))
  )

  // Raggruppati per argomento nell'ordine in cui compaiono (sort_order di
  // HQ); i tutorial senza argomento chiudono la pagina.
  const groups = useMemo(() => {
    const map = new Map<string, Tutorial[]>()
    for (const item of visible) {
      const key = item.topic || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    const entries = [...map.entries()]
    return [...entries.filter(([k]) => k), ...entries.filter(([k]) => !k)]
  }, [visible])

  const hasFilter = !!(filterLang.length || filterType.length || filterTopic.length || query)

  function open(item: Tutorial) {
    if (item.type === 'pdf') {
      if (item.file_url) window.open(apiUrl(item.file_url), '_blank', 'noopener')
      return
    }
    setVideoError(false)
    setViewing(item)
  }

  function closeViewer() {
    setViewing(null)
    setVideoError(false)
  }

  const embedUrl = viewing ? getEmbedUrl(viewing.video_url) : null

  if (tutorialsEnabled === false) return null

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Filtri: lingua (preselezionata sul profilo), tipo, argomento, ricerca */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <MultiFilterSelect label={t('filterLanguage')} options={languageOptions} selected={filterLang} onChange={(v) => { setFilterLang(v); setFilterTopic([]) }} prominent />
        <MultiFilterSelect
          label={t('filterType')}
          options={[{ value: 'video', label: t('typeVideo') }, { value: 'pdf', label: t('typePdf') }]}
          selected={filterType}
          onChange={setFilterType}
        />
        <MultiFilterSelect label={t('filterTopic')} options={topicOptions} selected={filterTopic} onChange={setFilterTopic} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/20 min-w-[180px]"
        />
        {hasFilter && (
          <button
            type="button"
            onClick={() => { setFilterLang([]); setFilterType([]); setFilterTopic([]); setQuery('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
          >
            {t('clearFilters')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('emptyAll')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center space-y-3">
          <p className="text-gray-400 text-sm">{t('emptyFiltered')}</p>
          {filterLang.length > 0 && (
            <button
              type="button"
              onClick={() => { setFilterLang([]); setFilterTopic([]) }}
              className="text-sm text-brand font-medium hover:underline"
            >
              {t('showAllLanguages')}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([topic, list]) => (
            <section key={topic || '__none'}>
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">{topic || t('noTopic')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((item) => {
                  const thumb = item.thumbnail_url || (item.type === 'video' ? getVideoThumbnail(item.video_url) : null)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => open(item)}
                      className="bg-white rounded-xl border border-gray-100 p-4 text-left hover:border-brand/30 hover:shadow-sm transition flex flex-col gap-3"
                    >
                      {thumb ? (
                        <div className="w-full h-36 rounded-lg overflow-hidden bg-gray-100 relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb} alt="" className="w-full h-full object-cover" />
                          {item.type === 'video' && (
                            <span className="absolute inset-0 flex items-center justify-center text-white text-4xl drop-shadow">▶</span>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-36 rounded-lg bg-gray-100 flex items-center justify-center">
                          <span className="text-gray-300 text-4xl">{item.type === 'video' ? '▶' : '📄'}</span>
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.type === 'video' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                            {item.type === 'video' ? t('typeVideo') : t('typePdf')}
                          </span>
                          {filterLang.length !== 1 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{langName(item.language)}</span>
                          )}
                        </div>
                        <p className="font-medium text-gray-900 text-sm leading-snug">{item.title}</p>
                        {item.description && <p className="text-xs text-gray-500 mt-1 line-clamp-3">{item.description}</p>}
                        <p className="text-xs text-brand mt-2">{item.type === 'video' ? t('watchVideo') : t('openPdf')}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Lettore video */}
      {viewing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={closeViewer}>
          <div className="bg-white rounded-xl w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-3">
              <h3 className="font-semibold text-gray-900 truncate">{viewing.title}</h3>
              <button onClick={closeViewer} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label={t('close')}>&times;</button>
            </div>
            <div className="p-5">
              {isEmbedUrl(viewing.video_url) && embedUrl ? (
                <div className="w-full rounded-lg overflow-hidden bg-black aspect-video">
                  <iframe
                    src={embedUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={viewing.title}
                  />
                </div>
              ) : viewing.video_url && !videoError ? (
                <video controls className="w-full rounded-lg bg-black" src={viewing.video_url} style={{ maxHeight: '420px' }} onError={() => setVideoError(true)} />
              ) : (
                <div className="w-full h-48 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center px-4">
                  <p className="text-red-600 text-sm text-center">{t('videoLoadError')}</p>
                </div>
              )}
              {viewing.description && <p className="text-sm text-gray-600 mt-4 whitespace-pre-line">{viewing.description}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
