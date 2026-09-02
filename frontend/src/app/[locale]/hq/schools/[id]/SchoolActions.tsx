'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import ErrorBanner from '@/components/ui/ErrorBanner'
import { apiFetch, ApiError } from '@/lib/api/client'

type EditableSchool = {
  id: string
  name: string
  city: string
  country: string | null
  email: string
  phone: string | null
  address: string | null
  address_line2: string | null
  province: string | null
  vat_number: string | null
  website: string | null
  platform_fee_percentage: number
  shop_commission_percentage?: number | null
}

type School = EditableSchool & {
  active: boolean
}

export default function SchoolActions({ school }: { school: School }) {
  const t = useTranslations('hq.schools')
  const locale = useLocale()
  const router = useRouter()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<string | null>(null)
  async function toggleActive() {
    setToggling(true)
    await apiFetch(`/hq/schools/${school.id}/`, { method: 'PATCH', body: JSON.stringify({ active: !school.active }) }).catch(() => {})
    router.refresh()
    setToggling(false)
  }

  async function resendInvite() {
    setResending(true)
    setResendMsg(null)
    try {
      await apiFetch(`/hq/schools/${school.id}/resend-invite/`, { method: 'POST' })
      setResendMsg('Invite email sent.')
    } catch {
      setResendMsg('Failed to send email.')
    }
    setResending(false)
  }

  // Two-click delete: first click fetches linked records and arms the button
  async function armDelete(): Promise<string | null> {
    setDeleteError(null)
    let cascading, blocking
    try {
      ({ cascading, blocking } = await apiFetch<{ cascading: Record<string, number>; blocking: Record<string, number> }>(`/hq/schools/${school.id}/linked/`))
    } catch {
      setDeleteError(t('errorSaveFailed')); return null
    }
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
    try {
      await apiFetch(`/hq/schools/${school.id}/`, { method: 'DELETE' })
      router.push(`/${locale}/hq/schools`)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setDeleteError(body?.error ?? t('errorSaveFailed'))
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push(`/${locale}/hq/schools/${school.id}/edit`)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
        >
          {t('buttonEdit')}
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

    </>
  )
}
