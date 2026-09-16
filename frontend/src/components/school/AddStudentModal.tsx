'use client'

import { useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import StudentProfileFields, { type ProfileFields } from '@/components/students/StudentProfileFields'
import StudentAddressFields from '@/components/students/StudentAddressFields'

/**
 * "Add student" from the Students page: one student typed in by the school.
 *
 * Same blocks as the student's own profile and as StudentSheet
 * (StudentProfileFields + StudentAddressFields), so the school fills in the
 * very fields it will later edit. The date of birth is a plain input here:
 * BirthDateField saves on every change through the caller, which makes no
 * sense before the student exists.
 *
 * POST /api/school/students/ is one row of the import (students/services.py
 * add_student): a new account, or the enrollment of an existing one, with
 * the password e-mail sent right away when the box is ticked. The outcome
 * goes back to the page (`onDone`), which tells the school what happened and
 * selects the student when no e-mail left, so it can be sent from the list.
 */

export type AddedStudent = {
  action: 'create' | 'enroll'
  student_id: string
  name: string
  email: string
  /** which e-mail left, or null when none did (not asked, or switched off in HQ) */
  password_email: 'invite' | 'reset' | null
  emailRequested: boolean
}

const EMPTY: Omit<ProfileFields, 'language_preference'> = {
  name: '', first_name: '', last_name: '', email: '', phone: null, date_of_birth: null,
  address: null, city: null, postal_code: null, province: null, country: null,
}

// Field named by a `too_long` error -> its label in student.profile
const FIELD_LABEL: Record<string, string> = {
  first_name: 'firstName', last_name: 'lastName', phone: 'phone', address: 'address',
  city: 'city', postal_code: 'postalCode', province: 'province', country: 'country',
}

export default function AddStudentModal({ onClose, onDone }: {
  onClose: () => void
  onDone: (added: AddedStudent) => void
}) {
  const t = useTranslations('school.studentAdd')
  const tProfile = useTranslations('student.profile')
  const locale = useLocale()

  // The admin's own language is the default for the new account, like the import
  const [profile, setProfile] = useState<ProfileFields>({ ...EMPTY, language_preference: locale })
  const [showAddress, setShowAddress] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = profile.first_name.trim() !== '' && profile.email.trim() !== ''

  function errorMessage(err: unknown): string {
    const body = err instanceof ApiError && typeof err.body === 'object' && err.body
      ? (err.body as { error?: string; field?: string }) : {}
    switch (body.error) {
      case 'already_enrolled': return t('alreadyEnrolled')
      case 'missing_email':
      case 'invalid_email': return t('invalidEmail')
      case 'missing_name': return t('missingName')
      case 'invalid_date': return t('invalidDate')
      case 'too_long': return t('tooLong', { field: tProfile(FIELD_LABEL[body.field ?? ''] ?? 'firstName') })
      default: return t('genericError')
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch<Omit<AddedStudent, 'emailRequested'>>('/school/students/', {
        method: 'POST',
        body: JSON.stringify({
          email: profile.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone ?? '',
          date_of_birth: profile.date_of_birth,
          address: profile.address,
          city: profile.city,
          postal_code: profile.postal_code,
          province: profile.province,
          country: profile.country,
          language_preference: profile.language_preference,
          send_email: sendEmail,
        }),
      })
      onDone({ ...res, emailRequested: sendEmail })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <form
        className="bg-white rounded-2xl w-full max-w-2xl my-6"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{t('title')}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{t('intro')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label={t('cancel')}>&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <StudentProfileFields value={profile} onChange={setProfile} editableEmail />
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{tProfile('dateOfBirth')}</label>
              <input
                type="date"
                value={profile.date_of_birth ?? ''}
                onChange={e => setProfile(p => ({ ...p, date_of_birth: e.target.value || null }))}
                className="w-full max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button type="button" onClick={() => setShowAddress(v => !v)} className="text-sm text-[#6B1F3A] underline">
            {showAddress ? t('addressHide') : t('addressShow')}
          </button>
          {showAddress && (
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <StudentAddressFields value={profile} onChange={setProfile} />
            </div>
          )}

          <label className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={e => setSendEmail(e.target.checked)}
              className="mt-0.5 accent-[#6B1F3A]"
            />
            <span>
              <span className="block text-sm text-gray-900">{t('sendEmail')}</span>
              <span className="block text-xs text-gray-500 mt-0.5">{t('sendEmailHint')}</span>
            </span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit || saving}
            className="px-4 py-2 text-sm rounded-lg bg-[#6B1F3A] text-white hover:bg-[#581931] disabled:opacity-50 transition"
          >
            {saving ? t('submitting') : t('submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
