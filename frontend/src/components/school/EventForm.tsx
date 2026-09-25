'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import EmailInfoField from '@/components/school/EmailInfoField'
import NotesFields from '@/components/school/NotesFields'
import ScheduleFields, { type PlanOption, type RoomOption, type ScheduleValue, type TeacherOption } from '@/components/school/ScheduleFields'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import ShareLinksBox from '@/components/ui/ShareLinkField'
import VideoPreviewPlayer from '@/components/ui/VideoPreviewPlayer'
import { apiFetch } from '@/lib/api/client'
import { apiErrorMessage } from '@/lib/api/error-message'
import { slugify, slugifyWhileTyping } from '@/lib/slug'

// Special event (SPECIAL_EVENTS.md): a workshop the school titles itself,
// outside the HQ lesson-type catalog. One form for create and edit, built
// from the shared pieces every other course/lesson form already uses
// (ScheduleFields, NotesFields, EmailInfoField, ImageUploadInput): the
// school fills title, description, image and video like HQ does for a
// lesson type, plus date, time, room, teacher and the price — "free" or an
// amount in euro. Credits never appear: a paid event is bought only with
// its own ticket.

export type EventPayload = {
  id: string
  name: string
  // The tail of the shareable link (/student/book?event=<slug>), unique network-wide
  slug: string | null
  description: string
  image_url: string | null
  video_url: string | null
  date: string | null
  start_time: string | null
  duration_minutes: number
  max_capacity: number
  teacher_id: string | null
  teacher_name: string | null
  room_id: string | null
  room_name: string | null
  location_name: string | null
  compensation_plan_id: string | null
  is_online: boolean
  online_link: string
  notes: string
  internal_notes: string
  email_info: string
  language: string
  color: string
  min_booking_notice_hours: number
  is_free: boolean
  price: string | null
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'cancelled' | ''
  submitted_at: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  review_note: string
  changed_at: string | null
  created_at: string
  lesson_id: string | null
  lesson_status: string | null
  bookings: number
  paid_seats: number
  school?: { id: string; name: string; city: string }
}

type FormState = {
  name: string
  slug: string
  description: string
  video_url: string
  image_url: string | null
  schedule: ScheduleValue
  is_free: boolean
  price: string
  internal_notes: string
  email_info: string
  min_booking_notice_hours: string
}

const DEFAULT_SCHEDULE: ScheduleValue = {
  // frequency 'single': one date, so the shared editor hides "end date"
  frequency: 'single', date: '', start_time: '', duration_minutes: '90', max_capacity: '15',
  room_id: '', teacher_id: '', compensation_plan_id: '', language: '',
  is_online: false, online_link: '', notes: '', color: '#6B1F3A',
}

function fromPayload(e: EventPayload | null, schoolLang: string): FormState {
  return {
    name: e?.name ?? '',
    slug: e?.slug ?? '',
    description: e?.description ?? '',
    video_url: e?.video_url ?? '',
    image_url: e?.image_url ?? null,
    schedule: {
      ...DEFAULT_SCHEDULE,
      date: e?.date ?? '',
      start_time: e?.start_time ?? '',
      duration_minutes: String(e?.duration_minutes ?? 90),
      max_capacity: String(e?.max_capacity ?? 15),
      room_id: e?.room_id ?? '',
      teacher_id: e?.teacher_id ?? '',
      compensation_plan_id: e?.compensation_plan_id ?? '',
      language: e?.language ?? schoolLang,
      is_online: e?.is_online ?? false,
      online_link: e?.online_link ?? '',
      notes: e?.notes ?? '',
      color: e?.color ?? '#6B1F3A',
    },
    is_free: e ? e.is_free : true,
    price: e?.price ?? '',
    internal_notes: e?.internal_notes ?? '',
    email_info: e?.email_info ?? '',
    min_booking_notice_hours: String(e?.min_booking_notice_hours ?? 2),
  }
}

/** The request body the API expects (catalog/events.py::parse_event_data) */
function toBody(f: FormState) {
  const s = f.schedule
  return {
    name: f.name,
    slug: f.slug,  // '' = the backend picks "<school slug>-<title>"
    description: f.description,
    video_url: f.video_url,
    date: s.date,
    start_time: s.start_time,
    duration_minutes: Number(s.duration_minutes) || 90,
    max_capacity: Number(s.max_capacity) || 15,
    teacher_id: s.teacher_id || null,
    room_id: s.room_id || null,
    compensation_plan_id: s.compensation_plan_id || null,
    is_online: Boolean(s.is_online),
    online_link: s.is_online ? (s.online_link ?? '') : '',
    notes: s.notes ?? '',
    internal_notes: f.internal_notes,
    email_info: f.email_info,
    language: s.language || 'it',
    color: s.color ?? '#6B1F3A',
    min_booking_notice_hours: Number(f.min_booking_notice_hours) || 0,
    price: f.is_free ? '' : f.price,
  }
}

function eventErrorMessage(err: unknown, t: (key: string) => string): string {
  // The API's own reason (an `error` code, or a DRF field error), translated
  // when it is one of the form's codes.
  const code = apiErrorMessage(err, '')
  const known: Record<string, string> = {
    name_required: 'errName', date_required: 'errDate', start_time_required: 'errTime',
    invalid_price: 'errPrice', date_in_past: 'errDatePast', not_editable: 'errNotEditable',
    not_submittable: 'errNotSubmittable', slug_taken: 'errSlugTaken',
  }
  if (known[code]) return t(known[code])
  return code ? `${t('errGeneric')} (${code})` : t('errGeneric')
}

export default function EventForm({
  initial,
  onSaved,
}: {
  /** null = new event */
  initial: EventPayload | null
  /** called with the saved event; `submitted` when "send to HQ" was clicked */
  onSaved: (event: EventPayload, submitted: boolean) => void
}) {
  const t = useTranslations('school.events.form')
  const tEdit = useTranslations('school.courses.edit')
  const tList = useTranslations('school.events.list')  // shareLink / copyLink / linkCopied, shared with the list
  const locale = useLocale()
  const [form, setForm] = useState<FormState>(() => fromPayload(initial, 'it'))
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [teachers, setTeachers] = useState<TeacherOption[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [saving, setSaving] = useState<'save' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The image is uploaded against the saved event (courses/<id>/image/):
  // a new event gets it right after the first save.
  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null)
  // "Saved" until the next edit: the button compares the form with the body
  // the server last received (the same one the save sends), so it can never
  // claim "saved" for a change it has not sent yet.
  const [lastSaved, setLastSaved] = useState<string | null>(() => (initial ? JSON.stringify(toBody(fromPayload(initial, 'it'))) : null))
  const savedClean = !!savedId && JSON.stringify(toBody(form)) === lastSaved
  // The link's tail: suggested from the school slug and the title, checked
  // live against the other events while the school types. Advisory only --
  // the save is what really refuses a duplicate (events.py, slug_taken).
  const [schoolSlug, setSchoolSlug] = useState('')
  const [slugCheck, setSlugCheck] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const slugCheckSeq = useRef(0)
  const suggestedSlug = [schoolSlug, slugify(form.name)].filter(Boolean).join('-')
  const effectiveSlug = slugify(form.slug) || suggestedSlug

  useEffect(() => {
    async function load() {
      type LocationRow = { id: string; name: string; rooms: { id: string; name: string; capacity: number }[] }
      type TeachersResponse = { teachers: { teachers: TeacherOption | null }[] }
      const [loc, pl, school, th] = await Promise.all([
        apiFetch<LocationRow[]>('/school/locations/').catch((): LocationRow[] => []),
        apiFetch<PlanOption[]>('/school/compensation-plans/').catch((): PlanOption[] => []),
        apiFetch<{ language?: string; slug?: string }>('/school/profile/').catch((): { language?: string; slug?: string } => ({})),
        apiFetch<TeachersResponse>('/school/teachers/').catch((): TeachersResponse => ({ teachers: [] })),
      ])
      const flat: RoomOption[] = []
      for (const location of loc ?? []) {
        for (const room of location.rooms ?? []) {
          flat.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: location.name })
        }
      }
      setRooms(flat)
      setPlans(pl ?? [])
      setTeachers((th.teachers ?? []).map(r => r.teachers).filter((r): r is TeacherOption => !!r && !!r.id))
      setSchoolSlug(school.slug ?? '')
      if (!initial && school.language) {
        setForm(f => ({ ...f, schedule: { ...f.schedule, language: school.language ?? f.schedule.language } }))
      }
    }
    load()
    // options load once per mount; a save replaces `initial` but not the school's rooms
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id])

  // Live availability of the link's tail, 400 ms after the last keystroke;
  // a late answer to an older value is dropped.
  useEffect(() => {
    if (!effectiveSlug) { setSlugCheck('idle'); return }
    const seq = ++slugCheckSeq.current
    setSlugCheck('checking')
    const handle = setTimeout(async () => {
      const q = new URLSearchParams({ slug: effectiveSlug, ...(savedId ? { exclude: savedId } : {}) })
      try {
        const r = await apiFetch<{ available: boolean }>(`/school/events/slug-available/?${q.toString()}`)
        if (seq === slugCheckSeq.current) setSlugCheck(r.available ? 'available' : 'taken')
      } catch {
        if (seq === slugCheckSeq.current) setSlugCheck('idle')
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [effectiveSlug, savedId])

  function patchSchedule(patch: Partial<ScheduleValue>) {
    setForm(f => ({ ...f, schedule: { ...f.schedule, ...patch } }))
  }

  function validate(): string | null {
    if (!form.name.trim()) return t('errName')
    if (!form.schedule.date) return t('errDate')
    if (!form.schedule.start_time) return t('errTime')
    if (!form.is_free) {
      const n = Number(form.price)
      if (form.price.trim() === '' || Number.isNaN(n) || n <= 0) return t('errPrice')
    }
    return null
  }

  async function save(submit: boolean) {
    const v = validate()
    if (v) { setError(v); return }
    setSaving(submit ? 'submit' : 'save')
    setError(null)
    try {
      let saved: EventPayload
      if (savedId) {
        saved = await apiFetch<EventPayload>(`/school/events/${savedId}/`, { method: 'PATCH', body: JSON.stringify(toBody(form)) })
        if (submit) {
          saved = await apiFetch<EventPayload>(`/school/events/${savedId}/submit/`, { method: 'POST', body: '{}' })
        }
      } else {
        saved = await apiFetch<EventPayload>('/school/events/', {
          method: 'POST', body: JSON.stringify({ ...toBody(form), submit }),
        })
        setSavedId(saved.id)
      }
      // An empty field means "the suggested one": show what the server chose
      setForm(f => ({ ...f, slug: saved.slug ?? f.slug }))
      // What went out is what is saved; a keystroke during the request keeps the form dirty
      setLastSaved(JSON.stringify(toBody({ ...form, slug: saved.slug ?? form.slug })))
      onSaved(saved, submit)
    } catch (err) {
      setError(eventErrorMessage(err, t))
    }
    setSaving(null)
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
  const approved = initial?.status === 'approved'
  const canSubmit = !initial || ['draft', 'rejected', 'suspended'].includes(initial.status)

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {approved && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
          {t('approvedEditHint')}
        </div>
      )}

      {/* Presentation: what the students see, like an HQ lesson type */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('sectionPresentation')}</h2>
        <div>
          <label className={labelCls}>{t('labelName')}</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls} placeholder={t('placeholderName')} maxLength={255} />
        </div>
        {/* The shareable link's tail (same normalisation as the HQ school slug) */}
        <div>
          <label className={labelCls}>{t('labelSlug')}</label>
          <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: slugifyWhileTyping(e.target.value) }))}
            className={inputCls} placeholder={suggestedSlug || t('placeholderSlug')} maxLength={255} />
          <p className="text-xs text-gray-400 mt-1">
            {t('slugHint')}
            {slugCheck !== 'idle' && (
              <span className={`ml-1 font-medium ${slugCheck === 'taken' ? 'text-red-600' : slugCheck === 'available' ? 'text-green-600' : 'text-gray-400'}`}>
                {t(slugCheck === 'taken' ? 'slugTaken' : slugCheck === 'available' ? 'slugAvailable' : 'slugChecking')}
              </span>
            )}
          </p>
          {approved && <p className="text-xs text-amber-700 mt-1">{t('slugChangeWarning')}</p>}
        </div>
        {/* The full link, in the same "links to share" box as the school profile's calendar links */}
        {effectiveSlug && (
          <ShareLinksBox
            title={tList('shareLink')} hint={t('shareLinkHint')}
            links={[{ key: 'event', label: t('shareLinkLabel'), url: `${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/student/book?event=${effectiveSlug}` }]}
            copyLabel={tList('copyLink')} copiedLabel={tList('linkCopied')} />
        )}
        <div>
          <label className={labelCls}>{t('labelDescription')}</label>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            rows={4} className={`${inputCls} resize-none`} placeholder={t('placeholderDescription')} />
          <p className="text-xs text-gray-400 mt-1">{t('descriptionHint')}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{t('labelVideoUrl')}</label>
            <input type="url" value={form.video_url} onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))}
              className={inputCls} placeholder="https://youtube.com/…" />
            <p className="text-xs text-gray-400 mt-1">{t('videoHint')}</p>
          </div>
          <div>
            {savedId ? (
              <ImageUploadInput
                endpoint={`/school/events/${savedId}/image/`}
                imageUrl={form.image_url}
                onChange={url => setForm(f => ({ ...f, image_url: url }))}
                label={t('labelImage')}
              />
            ) : (
              <>
                <label className={labelCls}>{t('labelImage')}</label>
                <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg p-3">{t('imageAfterSaveHint')}</p>
              </>
            )}
          </div>
        </div>
        {(form.video_url || form.image_url) && (
          <div className="max-w-sm rounded-xl overflow-hidden border border-gray-100">
            <VideoPreviewPlayer video={form.video_url || null} image={form.image_url} />
          </div>
        )}
      </section>

      {/* When and where: the same schedule editor as every lesson */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('sectionWhenWhere')}</h2>
        <ScheduleFields
          mode="lesson"
          value={form.schedule}
          onChange={patchSchedule}
          rooms={rooms}
          teachers={teachers}
          plans={plans}
          showDates
          standalone
          showOnline
          showColor
        />
        <div className="max-w-xs">
          <label className={labelCls}>{tEdit('labelMinNotice')}</label>
          <input type="number" min="0" value={form.min_booking_notice_hours}
            onChange={e => setForm(f => ({ ...f, min_booking_notice_hours: e.target.value }))} className={inputCls} />
        </div>
      </section>

      {/* Price: free, or a ticket in euro. No credits (SPECIAL_EVENTS.md). */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">{t('sectionPrice')}</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm(f => ({ ...f, is_free: true }))}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${form.is_free ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
            {t('priceFree')}
          </button>
          <button type="button" onClick={() => setForm(f => ({ ...f, is_free: false }))}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${!form.is_free ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
            {t('pricePaid')}
          </button>
        </div>
        {form.is_free ? (
          <p className="text-xs text-gray-500">{t('freeHint')}</p>
        ) : (
          <div className="max-w-xs">
            <label className={labelCls}>{t('labelPrice')}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
              <input type="number" min="0.5" step="0.5" value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className={`${inputCls} pl-7`} />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('paidHint')}</p>
          </div>
        )}
      </section>

      {/* Notes and email info: the shared blocks */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('sectionNotes')}</h2>
        <NotesFields
          notes={form.schedule.notes ?? ''}
          internalNotes={form.internal_notes}
          onNotesChange={v => patchSchedule({ notes: v })}
          onInternalChange={v => setForm(f => ({ ...f, internal_notes: v }))}
        />
        <EmailInfoField
          label={tEdit('labelEmailInfo')}
          placeholder={tEdit('emailInfoPlaceholder')}
          hint={tEdit('emailInfoHint')}
          value={form.email_info}
          onChange={v => setForm(f => ({ ...f, email_info: v }))}
        />
      </section>

      <div className="flex flex-wrap gap-3 justify-end">
        <button type="button" onClick={() => save(false)} disabled={!!saving || savedClean}
          className={`px-5 py-2.5 rounded-xl border text-sm font-medium transition ${
            savedClean ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
          }`}>
          {saving === 'save' ? t('saving') : savedClean ? t('saved') : approved ? t('saveLive') : t('saveDraft')}
        </button>
        {canSubmit && (
          <button type="button" onClick={() => save(true)} disabled={!!saving}
            className="px-5 py-2.5 rounded-xl bg-[#6B1F3A] text-white text-sm font-medium hover:bg-[#5a1a31] transition disabled:opacity-50">
            {saving === 'submit' ? t('submitting') : t('submitToHQ')}
          </button>
        )}
      </div>
    </div>
  )
}
