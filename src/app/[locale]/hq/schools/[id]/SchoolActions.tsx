'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'

type School = {
  id: string
  active: boolean
  name: string
  city: string
  country: string
  email: string
  phone: string | null
  address: string | null
  platform_fee_percentage: number
}

export default function SchoolActions({ school }: { school: School }) {
  const t = useTranslations('hq.schools')
  const locale = useLocale()
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: school.name,
    city: school.city,
    country: school.country ?? '',
    email: school.email,
    phone: school.phone ?? '',
    address: school.address ?? '',
    platform_fee_percentage: school.platform_fee_percentage,
  })

  async function toggleActive() {
    setToggling(true)
    await fetch(`/api/hq/schools/${school.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !school.active }),
    })
    router.refresh()
    setToggling(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const res = await fetch(`/api/hq/schools/${school.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        city: form.city,
        country: form.country,
        email: form.email,
        phone: form.phone || null,
        address: form.address || null,
        platform_fee_percentage: Number(form.platform_fee_percentage),
      }),
    })
    if (res.ok) {
      setEditing(false)
      router.refresh()
    } else {
      const d = await res.json()
      setSaveError(d.error ?? 'Save failed')
    }
    setSaving(false)
  }

  async function resendInvite() {
    setResending(true)
    setResendMsg(null)
    const res = await fetch(`/api/hq/schools/${school.id}/resend-invite`, { method: 'POST' })
    setResendMsg(res.ok ? 'Invite email sent.' : 'Failed to send email.')
    setResending(false)
  }

  // Two-click delete: first click fetches linked records and arms the button
  async function armDelete(): Promise<string | null> {
    setDeleteError(null)
    const res = await fetch(`/api/hq/schools/${school.id}`, { cache: 'no-store' })
    if (!res.ok) { setDeleteError(t('errorSaveFailed')); return null }
    const { cascading, blocking } = await res.json()
    if (blocking.transactions > 0 || blocking.shopOrders > 0) {
      setDeleteError(t('deleteBlockedFinancial', { name: school.name, count: blocking.transactions + blocking.shopOrders }))
      return null
    }
    const parts = [
      cascading.students > 0 && t('linkedStudents', { count: cascading.students }),
      cascading.teachers > 0 && t('linkedTeachers', { count: cascading.teachers }),
      cascading.courses > 0 && t('linkedCourses', { count: cascading.courses }),
      cascading.lessons > 0 && t('linkedLessons', { count: cascading.lessons }),
    ].filter(Boolean)
    return parts.length
      ? t('deleteArmedLinked', { linked: parts.join(', ') })
      : t('deleteArmedClean')
  }

  async function handleDelete() {
    const res = await fetch(`/api/hq/schools/${school.id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push(`/${locale}/hq/schools`)
    } else {
      const d = await res.json().catch(() => ({}))
      setDeleteError(d.error ?? t('errorSaveFailed'))
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setEditing(true); setSaveError('') }}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
        >
          Edit
        </button>
        <button
          onClick={resendInvite}
          disabled={resending}
          className="px-3 py-1.5 border border-[#6B1F3A]/30 text-[#6B1F3A] rounded-lg text-sm font-medium hover:bg-[#6B1F3A]/5 transition disabled:opacity-50"
        >
          {resending ? 'Sending...' : 'Resend Invite'}
        </button>
        <button
          onClick={toggleActive}
          disabled={toggling}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${
            school.active
              ? 'border border-red-200 text-red-600 hover:bg-red-50'
              : 'border border-green-200 text-green-700 hover:bg-green-50'
          }`}
        >
          {toggling ? '...' : school.active ? 'Deactivate' : 'Activate'}
        </button>
        <ConfirmDeleteButton
          label={t('buttonDelete')}
          armedLabel={t('deleteArmedClean')}
          onArm={armDelete}
          onDelete={handleDelete}
          className="border border-red-200 text-red-500 hover:bg-red-50 text-sm px-3 py-1.5"
        />
      </div>
      {resendMsg && (
        <p className={`text-xs mt-1 ${resendMsg.includes('sent') ? 'text-green-600' : 'text-red-500'}`}>
          {resendMsg}
        </p>
      )}
      <div className="mt-2">
        <ErrorBanner message={deleteError} onDismiss={() => setDeleteError(null)} />
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">Edit School</h3>
              <p className="text-sm text-gray-400 mt-0.5">{school.name}</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">School Name</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">City</label>
                  <input
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Country</label>
                  <input
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Platform Fee %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.platform_fee_percentage}
                    onChange={e => setForm(f => ({ ...f, platform_fee_percentage: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Address</label>
                  <input
                    value={form.address}
                    onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  />
                </div>
              </div>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
