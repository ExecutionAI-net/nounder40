'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from 'next-intl'

type HQCountry = { id: string; name: string; code: string }
type HQCity = { id: string; country_id: string; name: string }

export default function SchoolProfilePage() {
  const t = useTranslations('school.profile')
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [schoolId, setSchoolId] = useState<string | null>(null)

  const [countries, setCountries] = useState<HQCountry[]>([])
  const [cities, setCities] = useState<HQCity[]>([])

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    country: '',
    city: '',
    language: 'it',
  })

  // Cities filtered by selected country
  const filteredCities = cities.filter((c) => {
    const match = countries.find((co) => co.name === form.country || co.code === form.country)
    return match ? c.country_id === match.id : false
  })

  useEffect(() => {
    async function load() {
      const [{ data: { user } }, locRes] = await Promise.all([
        supabase.auth.getUser(),
        fetch('/api/locations', { cache: 'no-store' }),
      ])
      if (!user) return

      if (locRes.ok) {
        const loc = await locRes.json()
        setCountries(loc.countries ?? [])
        setCities(loc.cities ?? [])
      }

      const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', user.id).single()
      if (!profile?.school_id) return

      setSchoolId(profile.school_id)
      const { data: school } = await supabase
        .from('schools')
        .select('name, email, phone, address, city, country, language')
        .eq('id', profile.school_id)
        .single()

      if (school) {
        setForm({
          name: school.name ?? '',
          email: school.email ?? '',
          phone: school.phone ?? '',
          address: school.address ?? '',
          country: school.country ?? '',
          city: school.city ?? '',
          language: school.language ?? 'it',
        })
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    if (name === 'country') {
      // Reset city when country changes
      setForm((f) => ({ ...f, country: value, city: '' }))
    } else {
      setForm((f) => ({ ...f, [name]: value }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!schoolId) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { error } = await supabase.from('schools').update(form).eq('id', schoolId)
    if (error) setError(error.message)
    else setSuccess(true)
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
          <input name="phone" value={form.phone} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="+39 06 1234567" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelAddress')}</label>
          <input name="address" value={form.address} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="Via Roma 1" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelCountry')}</label>
            {countries.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">{t('noCountriesConfigured')}</p>
            ) : (
              <select name="country" required value={form.country} onChange={handleChange}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A] bg-white">
                <option value="">{t('selectCountry')}</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelCity')}</label>
            <select name="city" required value={form.city} onChange={handleChange}
              disabled={!form.country || filteredCities.length === 0}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A] bg-white disabled:opacity-50 disabled:cursor-not-allowed">
              {!form.country ? (
                <option value="">{t('selectCountryFirst')}</option>
              ) : filteredCities.length === 0 ? (
                <option value="">{t('noCitiesForCountry')}</option>
              ) : (
                <>
                  <option value="">{t('selectCity')}</option>
                  {filteredCities.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelSchoolLanguage')}</label>
          <select name="language" value={form.language} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]">
            <option value="it">Italiano</option>
            <option value="en">English</option>
            <option value="es">Español</option>
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
