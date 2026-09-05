'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import SchoolAddressFields, { normalizeWebsite, type SchoolAddressValues, EMPTY_SCHOOL_ADDRESS } from '@/components/school/SchoolAddressFields'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import { COURSE_LANGUAGES as LANGUAGES } from '@/lib/languages'

type SchoolProfile = {
  id: string
  slug: string
  name: string; email: string; phone: string; language: string
  address: string | null; address_line2: string | null; city: string | null
  province: string | null; country: string | null; vat_number: string | null; website: string | null
}

export default function SchoolProfilePage() {
  const t = useTranslations('school.profile')
  const locale = useLocale()
  const [schoolId, setSchoolId] = useState<string | null>(null)
  const [schoolSlug, setSchoolSlug] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    language: 'it',
  })
  const [addr, setAddr] = useState<SchoolAddressValues>(EMPTY_SCHOOL_ADDRESS)

  useEffect(() => {
    apiFetch<SchoolProfile>('/school/profile/').then((school) => {
      setSchoolId(school.id)
      setSchoolSlug(school.slug ?? '')
      setForm({
        name: school.name ?? '',
        email: school.email ?? '',
        phone: school.phone ?? '',
        language: school.language ?? 'it',
      })
      setAddr({
        address: school.address ?? '',
        address_line2: school.address_line2 ?? '',
        city: school.city ?? '',
        province: school.province ?? '',
        country: school.country ?? '',
        vat_number: school.vat_number ?? '',
        website: school.website ?? '',
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      await apiFetch('/school/profile/', {
        method: 'PATCH',
        body: JSON.stringify({
          ...form,
          ...addr,
          address: addr.address || '',
          address_line2: addr.address_line2 || '',
          province: addr.province || '',
          vat_number: addr.vat_number || '',
          website: normalizeWebsite(addr.website) || '',
        }),
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    }
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
        {success && <div className="p-3 rounded-lg bg-green-50 text-green-700 text-sm">{t('savedSuccessfully')}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchoolName')}</label>
          <input name="name" required value={form.name} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelEmail')}</label>
          <input name="email" type="email" required value={form.email} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelPhone')}</label>
          <PhoneInput value={form.phone} onChange={phone => setForm(f => ({ ...f, phone }))}
            inputClassName="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SchoolAddressFields
            values={addr}
            onChange={setAddr}
            inputClassName="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            labelClassName="block text-sm font-medium text-gray-700 mb-1"
          />
        </div>

        {/* Link pronti da condividere (sito, social): il calendario si apre
            gia' filtrato sul paese o sulla scuola. Il paese e' il codice ISO
            scelto qui sopra — finche' non e' scelto, il primo link non c'e'. */}
        {schoolId && (() => {
          const origin = typeof window !== 'undefined' ? window.location.origin : ''
          const code = /^[A-Za-z]{2}$/.test(addr.country) ? addr.country.toUpperCase() : ''
          const links = [
            ...(code ? [{ key: 'country', label: t('calendarLinkCountry'), url: `${origin}/${locale}/student/book?country=${code}` }] : []),
            // Slug leggibile al posto dell'uuid: piu' pulito da girare via chat
            { key: 'school', label: t('calendarLinkSchool'), url: schoolSlug ? `${origin}/${locale}/student/book?school=${schoolSlug}` : `${origin}/${locale}/student/book?school_id=${schoolId}` },
          ]
          const copy = (key: string, url: string) => {
            navigator.clipboard?.writeText(url).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000) })
          }
          return (
            <div className="rounded-xl border border-[#6B1F3A]/20 bg-[#6B1F3A]/5 p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-[#6B1F3A]">{t('calendarLinksTitle')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t('calendarLinksHint')}</p>
              </div>
              {links.map(l => (
                <div key={l.key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{l.label}</label>
                  <div className="flex gap-2">
                    <input readOnly value={l.url} onFocus={e => e.currentTarget.select()}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-mono text-gray-700" />
                    <button type="button" onClick={() => copy(l.key, l.url)}
                      className="shrink-0 px-3 py-2 rounded-lg bg-[#6B1F3A] text-white text-xs font-medium hover:bg-[#5a1930] transition">
                      {copied === l.key ? t('linkCopied') : t('copyLink')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchoolLanguage')}</label>
          <select name="language" value={form.language} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]">
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">{t('schoolLanguageHelp')}</p>
        </div>

        <div className="pt-2">
          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
            {saving ? t('saving') : t('saveProfile')}
          </button>
        </div>
      </form>
    </div>
  )
}
