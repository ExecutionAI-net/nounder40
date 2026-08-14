'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

// Course image uploader — the image is shown to students on the booking page.
export default function CourseImageInput({
  courseId,
  imageUrl,
  onChange,
}: {
  courseId: string
  imageUrl: string | null
  onChange: (url: string | null) => void
}) {
  const t = useTranslations('courseImage')
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/school/courses/${courseId}/image`, { method: 'POST', body: form })
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      onChange(d.image_url)
    } else {
      setError(d.error === 'too_large' ? t('errorTooLarge') : d.error === 'invalid_type' ? t('errorType') : d.error ?? t('errorGeneric'))
    }
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/school/courses/${courseId}/image`, { method: 'DELETE' })
    if (res.ok) onChange(null)
    setBusy(false)
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{t('label')}</label>
      <div className="flex items-center gap-4">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-24 h-16 object-cover rounded-lg border border-gray-100" />
        ) : (
          <div className="w-24 h-16 rounded-lg bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">
            {t('empty')}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            {busy ? '…' : imageUrl ? t('replace') : t('upload')}
          </button>
          {imageUrl && (
            <button type="button" disabled={busy} onClick={handleRemove}
              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50">
              {t('remove')}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      </div>
      <p className="text-xs text-gray-400 mt-1">{t('hint')}</p>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
