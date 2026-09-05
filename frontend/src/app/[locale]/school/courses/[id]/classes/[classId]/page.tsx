'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import EmailInfoField from '@/components/school/EmailInfoField'
import ScheduleFields, { type ScheduleValue } from '@/components/school/ScheduleFields'
import { apiFetch, ApiError } from '@/lib/api/client'

function errMsg(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

interface Enrollment {
  id: string
  student_id: string
  access_source: string
  status: string
  student: { name: string; email: string } | null
}

interface ClassDetail {
  id: string
  date: string
  start_time: string
  end_time: string
  max_capacity: number
  current_bookings: number
  status: string
  course_id: string
  compensation_plan_id: string | null
  notes: string | null
  is_online: boolean | null
  online_link: string | null
  language: string | null
  email_info: string | null
  courses: { id: string; name: string; color: string; language: string | null; email_info: string | null; credit_cost: string | null } | null
  teachers: { id: string; name: string } | null
  school_rooms: { id: string; name: string; school_locations: { id: string; name: string } | null } | null
  enrollments: Enrollment[]
}

export default function ClassEditPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id: courseId, classId } = use(params)
  const t = useTranslations('school.classes.edit')
  const tStatus = useTranslations('attendanceStatusNames')
  // 'package' → 'Pacchetto' ecc.; nomi non noti restano come sono
  const accessLabel = (src: string) =>
    src === 'package' ? tStatus('accessPackage')
    : src === 'subscription' ? tStatus('accessSubscription')
    : src === 'free_lesson' ? tStatus('accessFreeLesson')
    : src
  const searchParams = useSearchParams()
  // Salva/Annulla riportano da dove sei arrivato: calendario, elenco Lezioni,
  // oppure (default) il dettaglio del corso
  const from = searchParams.get('from')
  const backHref =
    from === 'calendar' ? '/school/calendar'
    : from === 'lessons' ? '/school/lessons'
    : `/school/courses/${courseId}`
  const uiLocale = useLocale()
  const router = useRouter()

  const [cls, setCls] = useState<ClassDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string; capacity: number; location_name: string }[]>([])
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([])
  const [schoolStudents, setSchoolStudents] = useState<{ id: string; name: string; email: string }[]>([])

  const [form, setForm] = useState({
    date: '', start_time: '', duration_minutes: '60',
    teacher_id: '', room_id: '',
    max_capacity: '', credit_cost: '', compensation_plan_id: '',
    notes: '',
    is_online: false,
    online_link: '',
    language: '',
    email_info: '',
  })

  // Add student state
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [addStudentId, setAddStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [addStudentError, setAddStudentError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId])

  async function loadAll() {
    setLoading(true)

    type TeachersResponse = { teachers: { teachers: { id: string; name: string; active: boolean } | null }[] }
    type LocationRow = { id: string; name: string; rooms: { id: string; name: string; capacity: number }[] }
    type StudentRow = { students: { id: string; name: string; email: string } }

    const [clsRes, teachersRes, locRes, studentsRes, plansRes] = await Promise.all([
      apiFetch<ClassDetail>(`/school/classes/${classId}/`).catch(() => null),
      apiFetch<TeachersResponse>('/school/teachers/'),
      apiFetch<LocationRow[]>('/school/locations/'),
      apiFetch<StudentRow[]>('/school/students/'),
      apiFetch<{ id: string; name: string }[]>('/school/compensation-plans/'),
    ])

    if (clsRes?.id) {
      setCls(clsRes)
      const [sh, sm] = (clsRes.start_time ?? '').split(':').map(Number)
      const [eh, em] = (clsRes.end_time ?? '').split(':').map(Number)
      const dur = (eh * 60 + em) - (sh * 60 + sm)
      setForm({
        date: clsRes.date ?? '',
        start_time: clsRes.start_time?.slice(0, 5) ?? '',
        duration_minutes: String(dur > 0 ? dur : 60),
        teacher_id: clsRes.teachers?.id ?? '',
        room_id: clsRes.school_rooms?.id ?? '',
        max_capacity: String(clsRes.max_capacity ?? 15),
        credit_cost: '',
        compensation_plan_id: clsRes.compensation_plan_id ?? '',
        notes: clsRes.notes ?? '',
        is_online: clsRes.is_online ?? false,
        online_link: clsRes.online_link ?? '',
        language: clsRes.language ?? '',
        // parte dal testo ereditato dal corso; se resta identico si continua a ereditare
        email_info: clsRes.email_info || clsRes.courses?.email_info || '',
      })
    }

    setTeachers(
      (teachersRes.teachers ?? [])
        .map(r => r.teachers)
        .filter((x): x is { id: string; name: string; active: boolean } => !!x && x.active)
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setPlans(Array.isArray(plansRes) ? plansRes : [])

    const flatRooms: { id: string; name: string; capacity: number; location_name: string }[] = []
    for (const loc of locRes ?? []) {
      for (const room of loc.rooms ?? []) {
        flatRooms.push({ id: room.id, name: room.name, capacity: room.capacity, location_name: loc.name })
      }
    }
    setRooms(flatRooms)

    setSchoolStudents(
      (studentsRes ?? []).map(r => r.students).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
    )
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/school/classes/${classId}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: form.date,
          start_time: form.start_time,
          duration_minutes: form.duration_minutes,
          teacher_id: form.teacher_id || null,
          room_id: form.room_id || null,
          max_capacity: form.max_capacity,
          compensation_plan_id: form.compensation_plan_id || null,
          notes: form.notes || null,
          is_online: form.is_online,
          online_link: form.online_link || null,
          language: form.language || '',
          // identico al testo del corso = nessun override: la lezione continua
          // a ereditare le modifiche future fatte a livello di corso
          email_info: form.email_info.trim() === (cls?.courses?.email_info ?? '').trim() ? '' : form.email_info,
        }),
      })
    } catch (err) {
      setError(errMsg(err))
      setSaving(false)
      return
    }
    setSaved(true)
    setSaving(false)
    setTimeout(() => router.push(backHref), 1500)
  }

  async function handleAddStudent() {
    if (!addStudentId) return
    setAddingStudent(true)
    setAddStudentError(null)
    try {
      await apiFetch(`/school/classes/${classId}/students/`, { method: 'POST', body: JSON.stringify({ student_id: addStudentId }) })
    } catch (err) {
      setAddStudentError(errMsg(err))
      setAddingStudent(false)
      return
    }
    setShowAddStudent(false)
    setAddStudentId('')
    setAddingStudent(false)
    loadAll()
  }

  async function handleRemoveStudent(studentId: string) {
    if (!confirm(t('confirmRemove'))) return
    setRemovingId(studentId)
    try {
      await apiFetch(`/school/classes/${classId}/students/?student_id=${studentId}`, { method: 'DELETE' })
      loadAll()
    } catch (err) {
      setError(errMsg(err))
    }
    setRemovingId(null)
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>
  if (!cls) return <div className="text-sm text-gray-400">{t('notFound')}</div>

  const enrolledIds = cls.enrollments.map(e => e.student_id)
  const availableToAdd = schoolStudents.filter(s => !enrolledIds.includes(s.id))

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/school/courses" className="hover:text-gray-700">{t('breadcrumbCourses')}</Link>
        <span>/</span>
        <Link href={`/school/courses/${courseId}`} className="hover:text-gray-700">
          {cls.courses?.name ?? 'Course'}
        </Link>
        <span>/</span>
        <span className="text-gray-700">
          {new Date(cls.date + 'T12:00:00').toLocaleDateString(uiLocale, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date(cls.date + 'T12:00:00').toLocaleDateString(uiLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}{cls.start_time?.slice(0, 5)} – {cls.end_time?.slice(0, 5)}
          </p>
        </div>
        {cls.status === 'cancelled' && (
          <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-medium rounded-full">{t('cancelled')}</span>
        )}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
      {saved && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">{t('saved')}</div>}

      {/* Edit fields */}
      {cls.status !== 'cancelled' && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 text-sm">{t('classDetails')}</h2>
          <ScheduleFields
            mode="lesson"
            value={{ ...form, frequency: 'single' } as unknown as ScheduleValue}
            onChange={(patch) => setForm(f => ({ ...f, ...patch, ...(patch.date !== undefined ? { date: patch.date } : {}) }))}
            rooms={rooms}
            teachers={teachers}
            plans={plans}
            showDates
            showNotes
          />
          {/* Crediti: vivono sul corso (valgono per tutte le sue lezioni) —
              qui si vedono, si modificano dalla pagina del corso */}
          {cls.courses?.credit_cost != null && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelCreditCost')}</label>
              <p className="text-sm font-semibold text-gray-900">{Number(cls.courses.credit_cost).toLocaleString(uiLocale)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('creditCostFromCourse')}{' '}
                <Link href={`/school/courses/${courseId}/edit`} className="underline hover:text-gray-600">
                  {t('creditCostEditOnCourse')}
                </Link>
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelOnline')}</label>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, is_online: !f.is_online, online_link: !f.is_online ? f.online_link : '' }))}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${form.is_online ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                {form.is_online ? '🌐 Online' : '📍 In-Person'}
              </button>
              {form.is_online && (
                <input
                  type="url"
                  value={form.online_link}
                  onChange={e => setForm(f => ({ ...f, online_link: e.target.value }))}
                  placeholder="https://zoom.us/j/..."
                  className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20"
                />
              )}
            </div>
          </div>
          {/* Informazioni in email di conferma e reminder — eredita dal corso, modificabile per questa lezione */}
          <EmailInfoField label={t('labelEmailInfo')} placeholder={t('emailInfoPlaceholder')} hint={t('emailInfoHint')}
            value={form.email_info} onChange={v => setForm(f => ({ ...f, email_info: v }))} />
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition">
              {saving ? t('saving') : t('saveChanges')}
            </button>
            {/* Uscita senza salvare: torna da dove sei arrivato */}
            <button onClick={() => router.push(backHref)}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Enrolled Students */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">
            {t('enrolledTitle', { enrolled: cls.enrollments.length, capacity: cls.max_capacity })}
          </h2>
          {cls.status !== 'cancelled' && (
            <button
              onClick={() => setShowAddStudent(s => !s)}
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition"
            >
              {t('addStudent')}
            </button>
          )}
        </div>

        {/* Add student form */}
        {showAddStudent && (
          <div className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50">
            {/* Search input */}
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={studentSearch}
              onChange={e => { setStudentSearch(e.target.value); setAddStudentId('') }}
              autoFocus
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/20 bg-white"
            />
            {/* Filtered list */}
            {studentSearch.trim() !== '' && (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-50">
                {availableToAdd
                  .filter(s =>
                    s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
                    s.email.toLowerCase().includes(studentSearch.toLowerCase())
                  )
                  .map(s => (
                    <button
                      key={s.id}
                      onClick={() => { setAddStudentId(s.id); setStudentSearch(`${s.name} — ${s.email}`) }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition ${addStudentId === s.id ? 'bg-gray-100 font-medium' : ''}`}
                    >
                      <span className="font-medium text-gray-800">{s.name}</span>
                      <span className="text-gray-400 ml-2">{s.email}</span>
                    </button>
                  ))}
                {availableToAdd.filter(s =>
                  s.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
                  s.email.toLowerCase().includes(studentSearch.toLowerCase())
                ).length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400">{t('noStudentsFound')}</p>
                )}
              </div>
            )}
            {addStudentError && <p className="text-xs text-red-600">{addStudentError}</p>}
            <div className="flex gap-2">
              <button onClick={handleAddStudent} disabled={addingStudent || !addStudentId}
                className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs disabled:opacity-50">
                {addingStudent ? t('adding') : t('addToClass')}
              </button>
              <button onClick={() => { setShowAddStudent(false); setAddStudentId(''); setStudentSearch('') }}
                className="px-3 py-1.5 text-gray-500 rounded-lg text-xs hover:bg-gray-100">
                {t('cancel')}
              </button>
            </div>
          </div>
        )}

        {cls.enrollments.length === 0 ? (
          <p className="text-sm text-gray-400">{t('noStudentsEnrolled')}</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {cls.enrollments.map(e => (
              <div key={e.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{e.student?.name ?? '—'}</p>
                  <p className="text-xs text-gray-400">{e.student?.email} · {accessLabel(e.access_source)}</p>
                </div>
                {cls.status !== 'cancelled' && e.status === 'confirmed' && (
                  <button
                    onClick={() => handleRemoveStudent(e.student_id)}
                    disabled={removingId === e.student_id}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
                  >
                    {removingId === e.student_id ? t('removing') : t('remove')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
