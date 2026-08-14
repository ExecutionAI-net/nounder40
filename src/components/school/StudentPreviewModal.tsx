'use client'

import { useLocale, useTranslations } from 'next-intl'
import { videoUrlForLocale, youtubeThumbnail, toEmbedUrl, imageUrlForLocale } from '@/lib/video-preview'
import { lessonTypeName } from '@/lib/lesson-type-name'

type LT = {
  name_it?: string | null; name_en?: string | null; name_fr?: string | null; name_es?: string | null
  description_it?: string | null; description_en?: string | null; description_fr?: string | null; description_es?: string | null
  image_url?: string | null; image_url_it?: string | null; image_url_en?: string | null; image_url_fr?: string | null; image_url_es?: string | null
  video_url_it?: string | null; video_url_en?: string | null; video_url_fr?: string | null; video_url_es?: string | null
} | null

// Anteprima "come la vede la studentessa": immagine, video e descrizione
// del tipo di lezione nella lingua corrente (i contenuti li governa HQ).
export default function StudentPreviewModal({
  lessonType,
  courseName,
  courseImage,
  onClose,
}: {
  lessonType: LT
  courseName: string | null
  courseImage: string | null
  onClose: () => void
}) {
  const t = useTranslations('studentPreview')
  const locale = useLocale()
  const video = videoUrlForLocale(lessonType, locale)
  const embed = toEmbedUrl(video)
  const img = imageUrlForLocale(lessonType, locale) ?? courseImage ?? youtubeThumbnail(video)
  const desc = lessonType
    ? ({ it: lessonType.description_it, en: lessonType.description_en, fr: lessonType.description_fr, es: lessonType.description_es } as Record<string, string | null | undefined>)[locale] ?? lessonType.description_en
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">{t('banner')}</div>
        {embed ? (
          <div className="aspect-video bg-black">
            <iframe src={embed} className="w-full h-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          </div>
        ) : img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-full aspect-video object-cover" />
        ) : (
          <div className="aspect-video bg-gray-50 flex items-center justify-center text-sm text-gray-300">{t('noMedia')}</div>
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-gray-900 text-lg">
              {courseName?.trim() || lessonTypeName(lessonType, locale) || '—'}
            </h3>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xl leading-none">×</button>
          </div>
          {desc
            ? <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{desc}</p>
            : <p className="text-sm text-gray-300 mt-2 italic">{t('noDescription')}</p>}
        </div>
      </div>
    </div>
  )
}
