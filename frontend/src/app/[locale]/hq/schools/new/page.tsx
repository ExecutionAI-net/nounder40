'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import BackButton from '@/components/ui/BackButton'
import { apiFetch, ApiError } from '@/lib/api/client'

export default function NewSchoolPage() {
  const t = useTranslations('hq.schools.new')
  const locale = useLocale()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    address: '',
    address_line2: '',
    city: '',
    province: '',
    country: 'IT',
    vat_number: '',
    platform_fee_percentage: '15',
    free_trial_days: '30',
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const data = await apiFetch<{ id: string }>('/hq/schools/', { method: 'POST', body: JSON.stringify(form) })
      router.push(`/${locale}/hq/schools/${data.id}?new=1`)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setError(body?.error ?? t('errorSomethingWrong'))
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <BackButton href={`/${locale}/hq/schools`} label={t('linkBack')} />
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('pageTitle')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('pageDescription')}</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchoolName')} *</label>
          <input
            name="name"
            required
            value={form.name}
            onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder={t('placeholderSchoolName')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchoolEmail')} *</label>
          <input
            name="email"
            type="email"
            required
            value={form.email}
            onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder={t('placeholderEmail')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelAddress')}</label>
          <input
            name="address"
            value={form.address}
            onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder={t('placeholderAddress')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelAddressLine2')}</label>
          <input
            name="address_line2"
            value={form.address_line2}
            onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder={t('placeholderAddressLine2')}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelCity')} *</label>
            <input
              name="city"
              required
              value={form.city}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('placeholderCity')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelCountry')}</label>
            <select
              name="country"
              value={form.country}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            >
              <option value="IT">{t('countryIT')}</option>
              <option value="FR">{t('countryFR')}</option>
              <option value="ES">{t('countryES')}</option>
              <option value="DE">{t('countryDE')}</option>
              <option value="GB">{t('countryGB')}</option>
              <option value="TR">{t('countryTR')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelProvince')}</label>
            <input
              name="province"
              value={form.province}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('placeholderProvince')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelVat')}</label>
            <input
              name="vat_number"
              value={form.vat_number}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
              placeholder={t('placeholderVat')}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelPlatformFee')}</label>
            <input
              name="platform_fee_percentage"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.platform_fee_percentage}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('helpPlatformFee')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelFreeTrial')}</label>
            <input
              name="free_trial_days"
              type="number"
              min="0"
              value={form.free_trial_days}
              onChange={handleChange}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            />
          </div>
        </div>

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {loading ? t('buttonCreating') : t('buttonCreateAndSend')}
          </button>
          <Link
            href={`/${locale}/hq/schools`}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
          >
            {t('buttonCancel')}
          </Link>
        </div>
      </form>
    </div>
  )
}
