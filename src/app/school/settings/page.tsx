'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Settings = {
  cancellation_policy_hours: number
  grace_period_days: number
  free_first_lesson: boolean
  min_booking_notice_hours: number
}

export default function SchoolSettingsPage() {
  const supabase = createClient()
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({
    cancellation_policy_hours: 24,
    grace_period_days: 7,
    free_first_lesson: false,
    min_booking_notice_hours: 2,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Closure days
  const [closures, setClosures] = useState<{ id: string; date: string; notes: string | null }[]>([])
  const [newClosure, setNewClosure] = useState({ date: '', notes: '' })
  const [addingClosure, setAddingClosure] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return
      setSchoolId(profile.school_id)

      const { data: school } = await supabase
        .from('schools')
        .select('cancellation_policy_hours, grace_period_days, free_first_lesson, min_booking_notice_hours')
        .eq('id', profile.school_id)
        .single()

      if (school) {
        setSettings({
          cancellation_policy_hours: school.cancellation_policy_hours ?? 24,
          grace_period_days: school.grace_period_days ?? 7,
          free_first_lesson: school.free_first_lesson ?? false,
          min_booking_notice_hours: school.min_booking_notice_hours ?? 2,
        })
      }

      const { data: cls } = await supabase
        .from('school_closures')
        .select('id, date, notes')
        .eq('school_id', profile.school_id)
        .order('date', { ascending: true })
      setClosures(cls ?? [])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!schoolId) return
    setSaving(true)
    await supabase.from('schools').update({
      cancellation_policy_hours: settings.cancellation_policy_hours,
      grace_period_days: settings.grace_period_days,
      free_first_lesson: settings.free_first_lesson,
      min_booking_notice_hours: settings.min_booking_notice_hours,
    }).eq('id', schoolId)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function addClosure() {
    if (!schoolId || !newClosure.date) return
    setAddingClosure(true)
    const { data, error } = await supabase.from('school_closures').insert({
      school_id: schoolId,
      date: newClosure.date,
      type: 'full_day',
      notes: newClosure.notes || null,
    }).select('id, date, notes').single()
    if (!error && data) {
      setClosures((c) => [...c, data].sort((a, b) => a.date.localeCompare(b.date)))
      setNewClosure({ date: '', notes: '' })
    }
    setAddingClosure(false)
  }

  async function deleteClosure(id: string) {
    await supabase.from('school_closures').delete().eq('id', id)
    setClosures((c) => c.filter((x) => x.id !== id))
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">Configure your school&apos;s operational rules.</p>
      </div>

      {/* Operational Settings */}
      <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <h2 className="font-semibold text-gray-900">Operational Rules</h2>

        {saved && (
          <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">Settings saved.</div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cancellation Policy (hours before lesson)
            </label>
            <input
              type="number"
              min={0}
              value={settings.cancellation_policy_hours}
              onChange={(e) => setSettings((s) => ({ ...s, cancellation_policy_hours: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">Credits refunded if cancelled before this threshold.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subscription Grace Period (days)
            </label>
            <input
              type="number"
              min={0}
              max={30}
              value={settings.grace_period_days}
              onChange={(e) => setSettings((s) => ({ ...s, grace_period_days: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">Days student retains access after failed payment.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minimum Booking Notice (hours)
            </label>
            <input
              type="number"
              min={0}
              value={settings.min_booking_notice_hours}
              onChange={(e) => setSettings((s) => ({ ...s, min_booking_notice_hours: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum hours before lesson start for new bookings.</p>
          </div>

          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={settings.free_first_lesson}
                  onChange={(e) => setSettings((s) => ({ ...s, free_first_lesson: e.target.checked }))}
                />
                <div className={`w-10 h-6 rounded-full transition ${settings.free_first_lesson ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.free_first_lesson ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Free First Lesson</p>
                <p className="text-xs text-gray-400">New students get their first lesson free.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* Closure Days */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Closure Days</h2>
        <p className="text-sm text-gray-500">Mark days your school is closed (holidays, breaks, etc.).</p>

        <div className="flex gap-2">
          <input
            type="date"
            value={newClosure.date}
            onChange={(e) => setNewClosure((c) => ({ ...c, date: e.target.value }))}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={newClosure.notes}
            onChange={(e) => setNewClosure((c) => ({ ...c, notes: e.target.value }))}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <button
            onClick={addClosure}
            disabled={addingClosure || !newClosure.date}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {addingClosure ? 'Adding...' : '+ Add'}
          </button>
        </div>

        {closures.length > 0 && (
          <div className="space-y-2 mt-2">
            {closures.map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5">
                <div>
                  <span className="text-sm font-medium text-gray-800">
                    {new Date(c.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  {c.notes && <span className="text-xs text-gray-400 ml-3">{c.notes}</span>}
                </div>
                <button onClick={() => deleteClosure(c.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              </div>
            ))}
          </div>
        )}

        {!closures.length && (
          <p className="text-sm text-gray-400">No closure days set.</p>
        )}
      </div>
    </div>
  )
}
