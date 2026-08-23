'use client'

import { useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'

// One reusable schedule editor for the whole platform (Carlo's rule):
// - mode="schedule": course schedule (wizard + edit course) — includes the
//   course-level fields (credits, VIP window, reserve spots, color, waitlist)
// - mode="lesson": single class (Add Lesson) — only the per-lesson fields
// The shared fields (time, duration, capacity, room with capacity autofill,
// teacher override, compensation plan) render identically in both.

export type ScheduleValue = {
  date?: string
  end_date?: string
  first_date?: string
  frequency?: string
  weekday?: string
  start_time: string
  duration_minutes: string
  max_capacity: string
  credit_cost?: string
  vip_booking_hours_before?: string
  min_booking_notice_hours?: string
  room_id: string
  teacher_id: string
  compensation_plan_id?: string
  reserve_spots?: string
  waitlist_enabled?: boolean
  color?: string
  notes?: string
  is_online?: boolean
  online_link?: string
}

export type RoomOption = { id: string; name: string; capacity: number; location_name: string }
export type TeacherOption = { id: string; name: string }
export type PlanOption = { id: string; name: string }

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

export default function ScheduleFields({
  mode,
  value,
  onChange,
  rooms,
  teachers,
  plans = [],
  showDates = false,
  startDateReadOnly = false,
  showFrequency = false,
  showWeekday = false,
  showNotes = false,
}: {
  mode: 'schedule' | 'lesson'
  value: ScheduleValue
  onChange: (patch: Partial<ScheduleValue>) => void
  rooms: RoomOption[]
  teachers: TeacherOption[]
  plans?: PlanOption[]
  showDates?: boolean
  startDateReadOnly?: boolean
  showFrequency?: boolean
  showWeekday?: boolean
  showNotes?: boolean
}) {
  const t = useTranslations('scheduleFields')
  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="space-y-4">
      {(showFrequency || showDates) && (
        <div className="grid grid-cols-2 gap-3">
          {showFrequency && (
            <div>
              <label className={labelCls}>{t('labelFrequency')}</label>
              <select value={value.frequency ?? 'single'} onChange={e => onChange({ frequency: e.target.value })} className={inputCls}>
                <option value="single">{t('freqSingle')}</option>
                <option value="weekly">{t('freqWeekly')}</option>
                <option value="biweekly">{t('freqBiweekly')}</option>
              </select>
            </div>
          )}

          {showDates && (
            <>
              <div>
                <label className={labelCls}>{t('labelStartDate')}</label>
                <input type="date" value={value.first_date ?? value.date ?? ''} disabled={startDateReadOnly}
                  onChange={e => onChange(startDateReadOnly ? {} : { date: e.target.value, first_date: e.target.value })}
                  className={`${inputCls} ${startDateReadOnly ? 'disabled:bg-gray-50 disabled:text-gray-400' : ''}`} />
                {startDateReadOnly && <p className="text-xs text-gray-400 mt-1">{t('startDateHint')}</p>}
              </div>
              {(value.frequency !== 'single' || mode === 'schedule') && (
                <div>
                  <label className={labelCls}>{t('labelEndDate')}</label>
                  <input type="date" value={value.end_date ?? ''} onChange={e => onChange({ end_date: e.target.value })} className={inputCls} />
                  {mode === 'schedule' && <p className="text-xs text-gray-400 mt-1">{t('endDateHint')}</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Giorno della settimana PRIMA dell'ora di inizio (richiesta di Carlo) */}
      {showWeekday && (
        <div>
          <label className={labelCls}>{t('labelWeekday')}</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {WEEKDAY_KEYS.map(day => (
              <button key={day} type="button"
                onClick={() => onChange({ weekday: day })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${
                  value.weekday === day
                    ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}>
                {t(day)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{t('labelStartTime')}</label>
          <input type="time" value={value.start_time} onChange={e => onChange({ start_time: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>{t('labelDuration')}</label>
          <input type="number" min="5" value={value.duration_minutes} onChange={e => onChange({ duration_minutes: e.target.value })} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>{t('labelRoom')}</label>
          <select
            value={value.room_id}
            onChange={e => {
              const room = rooms.find(r => r.id === e.target.value)
              // selezionare un'aula porta con sé la sua capienza
              onChange(room ? { room_id: e.target.value, max_capacity: String(room.capacity) } : { room_id: e.target.value })
            }}
            className={inputCls}
          >
            <option value="">{t('noRoom')}</option>
            {rooms.map(r => (
              <option key={r.id} value={r.id}>{r.location_name} — {r.name} ({t('cap')} {r.capacity})</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>{t('labelMaxCapacity')}</label>
          <input type="number" min="1" value={value.max_capacity} onChange={e => onChange({ max_capacity: e.target.value })} className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>{t('labelTeacherOverride')}</label>
          <select value={value.teacher_id} onChange={e => onChange({ teacher_id: e.target.value })} className={inputCls}>
            <option value="">{t('useCourseDefault')}</option>
            {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
          </select>
        </div>
        {plans.length > 0 && (
          <div>
            <label className={labelCls}>{t('labelCompPlan')}</label>
            <select value={value.compensation_plan_id ?? ''} onChange={e => onChange({ compensation_plan_id: e.target.value })} className={inputCls}>
              <option value="">{t('noPlan')}</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {mode === 'schedule' && (
          <>
            <div>
              <label className={labelCls}>{t('labelCreditCost')}</label>
              <input type="number" min="0.5" step="0.5" value={value.credit_cost ?? '1'} onChange={e => onChange({ credit_cost: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('labelVipBooking')}</label>
              <input type="number" min="0" value={value.vip_booking_hours_before ?? '0'} onChange={e => onChange({ vip_booking_hours_before: e.target.value })} className={inputCls} />
              <p className="text-xs text-gray-400 mt-1">{t('vipBookingHint')}</p>
            </div>
            <div>
              <label className={labelCls}>{t('labelMinNotice')}</label>
              <input type="number" min="0" value={value.min_booking_notice_hours ?? '2'} onChange={e => onChange({ min_booking_notice_hours: e.target.value })} className={inputCls} />
              <p className="text-xs text-gray-400 mt-1">{t('minNoticeHint')}</p>
            </div>
            <div>
              <label className={labelCls}>{t('labelReserveSpots')}</label>
              <input type="number" min="0" value={value.reserve_spots ?? '0'} onChange={e => onChange({ reserve_spots: e.target.value })} className={inputCls} />
              <p className="text-xs text-gray-400 mt-1">{t('reserveSpotsHint')}</p>
            </div>
          </>
        )}
      </div>

      {mode === 'schedule' && (
        <>
          {/* Online o in presenza — per singolo orario */}
          <div>
            <label className={labelCls}>{t('labelOnline')}</label>
            <div className="flex gap-2 mt-1">
              <button type="button"
                onClick={() => onChange({ is_online: false, online_link: '' })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${!value.is_online ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {t('inPerson')}
              </button>
              <button type="button"
                onClick={() => onChange({ is_online: true })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${value.is_online ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                {t('online')}
              </button>
            </div>
            {value.is_online && (
              <input type="url" value={value.online_link ?? ''}
                onChange={e => onChange({ online_link: e.target.value })}
                placeholder={t('onlineLinkPlaceholder')} className={`${inputCls} mt-2`} />
            )}
          </div>

          <div>
            <label className={labelCls}>{t('labelCalendarColor')}</label>
            <div className="mt-1">
              <ColorPicker value={value.color ?? '#2563eb'} onChange={c => onChange({ color: c })} />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" className="sr-only"
                checked={value.waitlist_enabled ?? false}
                onChange={e => onChange({ waitlist_enabled: e.target.checked })} />
              <div className={`w-10 h-6 rounded-full transition ${value.waitlist_enabled ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${value.waitlist_enabled ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{t('enableWaitlist')}</p>
              <p className="text-xs text-gray-400">{t('waitlistHint')}</p>
            </div>
          </label>
        </>
      )}

      {showNotes && (
        <div>
          <label className={labelCls}>{t('labelNotes')}</label>
          <textarea value={value.notes ?? ''} onChange={e => onChange({ notes: e.target.value })}
            rows={3} placeholder={t('notesPlaceholder')} className={`${inputCls} resize-none`} />
        </div>
      )}
    </div>
  )
}
