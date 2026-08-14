'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { videoUrlForLocale, youtubeThumbnail, toEmbedUrl, imageUrlForLocale } from '@/lib/video-preview'
import { lessonTypeName } from '@/lib/lesson-type-name'
import { formatDateObj } from '@/lib/format-date'
import { useEmbeddable } from '@/lib/use-embeddable'

type LT = {
  name_it?: string | null; name_en?: string | null; name_fr?: string | null; name_es?: string | null
  description_it?: string | null; description_en?: string | null; description_fr?: string | null; description_es?: string | null
  image_url?: string | null; image_url_it?: string | null; image_url_en?: string | null; image_url_fr?: string | null; image_url_es?: string | null
  video_url_it?: string | null; video_url_en?: string | null; video_url_fr?: string | null; video_url_es?: string | null
} | null

// Anteprima a 2 livelli "come la vede la studentessa":
// 1. la card di prenotazione (data d'esempio, insegnante, lingua, crediti)
// 2. click sull'immagine → dettaglio con descrizione e video (contenuti HQ)
export default function StudentPreviewModal({
  lessonType,
  courseName,
  courseImage,
  teacherName,
  creditCost,
  language,
  startTime,
  durationMinutes,
  onClose,
}: {
  lessonType: LT
  courseName: string | null
  courseImage: string | null
  teacherName?: string | null
  creditCost?: string | number | null
  language?: string | null
  startTime?: string | null
  durationMinutes?: string | number | null
  onClose: () => void
}) {
  const t = useTranslations('studentPreview')
  const locale = useLocale()
  const [level, setLevel] = useState<'card' | 'detail'>('card')

  const video = videoUrlForLocale(lessonType, locale)
  const embeddable = useEmbeddable(video)
  const embed = embeddable ? toEmbedUrl(video) : null
  const img = imageUrlForLocale(lessonType, locale) ?? courseImage ?? youtubeThumbnail(video)
  const desc = lessonType
    ? ({ it: lessonType.description_it, en: lessonType.description_en, fr: lessonType.description_fr, es: lessonType.description_es } as Record<string, string | null | undefined>)[locale] ?? lessonType.description_en
    : null
  const title = courseName?.trim() || lessonTypeName(lessonType, locale) || '—'

  // data di esempio: domani
  const example = new Date()
  example.setDate(example.getDate() + 1)
  const st = startTime?.slice(0, 5) ?? '19:30'
  const dur = Number(durationMinutes) || 60
  const [h, m] = st.split(':').map(Number)
  const endMin = h * 60 + m + dur
  const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
  const flag: Record<string, string> = { it: '🇮🇹 Italiano', en: '🇬🇧 English', es: '🇪🇸 Español', fr: '🇫🇷 Français' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="rounded-t-2xl overflow-hidden bg-amber-50 border border-amber-100 px-4 py-2 text-xs text-amber-700 flex items-center justify-between">
          <span>{t('banner')}</span>
          <button onClick={onClose} className="text-amber-400 hover:text-amber-600 text-lg leading-none">×</button>
        </div>

        {level === 'card' ? (
          /* ── Livello 1: la card di prenotazione ── */
          <div className="bg-gray-50 p-4 rounded-b-2xl">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-2">
              {formatDateObj(example)}
            </p>
            <div className="bg-white rounded-xl border border-gray-100 p-4 flex gap-4 items-start">
              <div className="w-1 self-stretch rounded-full shrink-0 bg-[#6B1F3A]" />
              <button type="button" onClick={() => setLevel('detail')} className="relative shrink-0 group" title={t('openDetail')}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 text-xs">—</div>
                )}
                <span className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center group-hover:bg-black/70 transition">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{title}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{lessonTypeName(lessonType, locale)}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                  {teacherName && <span>👤 {teacherName}</span>}
                  <span>{creditCost ?? 1} {t('credits')}</span>
                  {language && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{flag[language] ?? language}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-gray-900">{st}</p>
                <p className="text-xs text-gray-400">{end}</p>
                <span className="mt-2 inline-block bg-[#6B1F3A] text-white text-xs font-medium px-3 py-1.5 rounded-lg opacity-60 cursor-not-allowed">
                  {t('bookButton')}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">{t('cardHint')}</p>
          </div>
        ) : (
          /* ── Livello 2: dettaglio con video e descrizione ── */
          <div className="bg-white rounded-b-2xl overflow-hidden">
            {embed ? (
              <div className="aspect-video bg-black">
                <iframe src={embed} className="w-full h-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
              </div>
            ) : video && embeddable === false && img ? (
              <a href={video} target="_blank" rel="noreferrer" className="relative block group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img} alt="" className="w-full aspect-video object-cover" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="w-14 h-14 rounded-full bg-black/60 group-hover:bg-black/75 transition flex items-center justify-center">
                    <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.34-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z"/></svg>
                  </span>
                </span>
              </a>
            ) : img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="w-full aspect-video object-cover" />
            ) : (
              <div className="aspect-video bg-gray-50 flex items-center justify-center text-sm text-gray-300">{t('noMedia')}</div>
            )}
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
                <button onClick={() => setLevel('card')} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">← {t('backToCard')}</button>
              </div>
              {desc
                ? <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{desc}</p>
                : <p className="text-sm text-gray-300 mt-2 italic">{t('noDescription')}</p>}
              {video && (
                <a href={video} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm text-[#6B1F3A] font-medium hover:underline">
                  {t('openVideo')} ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
