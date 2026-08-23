'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

type Country = { id: string; name: string; code: string }
type City = { id: string; country_id: string; name: string }
type SchoolRow = { id: string; name: string; city: string; active: boolean }

export default function HQLocationsPage() {
  const t = useTranslations('hq.locations')
  const [countries, setCountries] = useState<Country[]>([])
  const [cities, setCities] = useState<City[]>([])
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [loading, setLoading] = useState(true)

  // Add country form
  const [newCountry, setNewCountry] = useState({ name: '', code: '' })
  const [addingCountry, setAddingCountry] = useState(false)
  const [countryError, setCountryError] = useState('')

  // Add city form
  const [selectedCountryId, setSelectedCountryId] = useState('')
  const [newCityName, setNewCityName] = useState('')
  const [addingCity, setAddingCity] = useState(false)
  const [cityError, setCityError] = useState('')

  // Expand state: which country's cities are shown
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null)

  async function load() {
    try {
      type NestedCountry = { id: string; name: string; code: string; cities: { id: string; name: string }[] }
      const [data, schoolList] = await Promise.all([
        apiFetch<NestedCountry[]>('/locations/'),
        apiFetch<SchoolRow[]>('/hq/schools/').catch(() => [] as SchoolRow[]),
      ])
      setCountries(data.map(c => ({ id: c.id, name: c.name, code: c.code })))
      setCities(data.flatMap(c => c.cities.map(city => ({ id: city.id, name: city.name, country_id: c.id }))))
      setSchools(schoolList)
    } catch { /* no-op */ }
    setLoading(false)
  }

  // Scuole per città (nome normalizzato): mostra quante scuole reali
  // ci sono dietro ogni voce del registro
  const norm = (s: string) => s.trim().toLowerCase()
  const schoolsByCity = new Map<string, number>()
  for (const s of schools) {
    if (!s.city) continue
    const k = norm(s.city)
    schoolsByCity.set(k, (schoolsByCity.get(k) ?? 0) + 1)
  }
  const cityNames = new Set(cities.map(c => norm(c.name)))
  // Scuole la cui città non è nel registro: invisibili nella ricerca per città
  const unlistedSchools = schools.filter(s => s.city && !cityNames.has(norm(s.city)))

  useEffect(() => { load() }, [])

  async function addCountry() {
    if (!newCountry.name || !newCountry.code) return
    setAddingCountry(true)
    setCountryError('')
    try {
      const data = await apiFetch<Country>('/hq/locations/countries/', { method: 'POST', body: JSON.stringify(newCountry) })
      setCountries((c) => [...c, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewCountry({ name: '', code: '' })
    } catch (err) {
      setCountryError(errMsg(err, t('errorFailed')))
    }
    setAddingCountry(false)
  }

  async function deleteCountry(id: string) {
    await apiFetch(`/hq/locations/countries/${id}/`, { method: 'DELETE' }).catch(() => {})
    setCountries((c) => c.filter((x) => x.id !== id))
    setCities((c) => c.filter((x) => x.country_id !== id))
    if (expandedCountry === id) setExpandedCountry(null)
  }

  async function addCity() {
    if (!selectedCountryId || !newCityName) return
    setAddingCity(true)
    setCityError('')
    try {
      const data = await apiFetch<{ id: string; name: string; country: string }>('/hq/locations/cities/', {
        method: 'POST',
        body: JSON.stringify({ country: selectedCountryId, name: newCityName }),
      })
      setCities((c) => [...c, { id: data.id, name: data.name, country_id: data.country }].sort((a, b) => a.name.localeCompare(b.name)))
      setNewCityName('')
      setExpandedCountry(selectedCountryId)
    } catch (err) {
      setCityError(errMsg(err, t('errorFailed')))
    }
    setAddingCity(false)
  }

  async function deleteCity(id: string) {
    await apiFetch(`/hq/locations/cities/${id}/`, { method: 'DELETE' }).catch(() => {})
    setCities((c) => c.filter((x) => x.id !== id))
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Add Country */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('sectionAddCountry')}</h2>
        {countryError && <p className="text-sm text-red-500">{countryError}</p>}
        <div className="flex flex-wrap gap-3">
          <input
            placeholder={t('placeholderCountryName')}
            value={newCountry.name}
            onChange={(e) => setNewCountry((f) => ({ ...f, name: e.target.value }))}
            className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <input
            placeholder={t('placeholderCode')}
            value={newCountry.code}
            onChange={(e) => setNewCountry((f) => ({ ...f, code: e.target.value }))}
            className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 uppercase"
            maxLength={3}
          />
          <button
            onClick={addCountry}
            disabled={addingCountry || !newCountry.name || !newCountry.code}
            className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {addingCountry ? t('buttonAdding') : t('buttonAddCountry')}
          </button>
        </div>
      </div>

      {/* Add City */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">{t('sectionAddCity')}</h2>
        {cityError && <p className="text-sm text-red-500">{cityError}</p>}
        <div className="flex flex-wrap gap-3">
          <select
            value={selectedCountryId}
            onChange={(e) => setSelectedCountryId(e.target.value)}
            className="w-44 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
          >
            <option value="">{t('selectCountry')}</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            placeholder={t('placeholderCityName')}
            value={newCityName}
            onChange={(e) => setNewCityName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCity()}
            className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <button
            onClick={addCity}
            disabled={addingCity || !selectedCountryId || !newCityName}
            className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {addingCity ? t('buttonAdding') : t('buttonAddCity')}
          </button>
        </div>
      </div>

      {/* Scuole con città fuori registro: non compaiono nella ricerca per città */}
      {unlistedSchools.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-medium text-amber-800">{t('warningUnlistedTitle')}</p>
          <p className="text-xs text-amber-700 mt-1">{t('warningUnlistedHint')}</p>
          <ul className="mt-2 space-y-0.5">
            {unlistedSchools.map(s => (
              <li key={s.id} className="text-xs text-amber-800">• {s.name} — {s.city}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Countries & Cities list */}
      <div className="space-y-3">
        {countries.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            {t('emptyState')}
          </div>
        ) : (
          countries.map((country) => {
            const countryCities = cities.filter((c) => c.country_id === country.id)
            const countrySchools = countryCities.reduce((sum, c) => sum + (schoolsByCity.get(norm(c.name)) ?? 0), 0)
            const isOpen = expandedCountry === country.id
            return (
              <div key={country.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Country row */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <span className="w-10 h-10 rounded-full bg-[#6B1F3A]/10 flex items-center justify-center text-xs font-bold text-[#6B1F3A]">
                    {country.code}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{country.name}</p>
                    <p className="text-xs text-gray-400">
                      {countryCities.length} {t('citiesLabel', { count: countryCities.length })} · {t('schoolsCount', { count: countrySchools })}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpandedCountry(isOpen ? null : country.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mr-2"
                  >
                    {isOpen ? t('buttonHide') : t('buttonShow')}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                      className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteCountry(country.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    {t('buttonRemove')}
                  </button>
                </div>

                {/* Cities list */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {countryCities.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">{t('noCitiesYet', { country: country.name })}</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {countryCities.map((city) => {
                          const cityCount = schoolsByCity.get(norm(city.name)) ?? 0
                          return (
                            <div key={city.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                              <span className="text-sm text-gray-700 whitespace-nowrap">📍 {city.name}</span>
                              <span className={`flex-1 text-xs ${cityCount > 0 ? 'text-gray-400' : 'text-amber-600'}`}>
                                {t('schoolsCount', { count: cityCount })}
                              </span>
                              <button
                                onClick={() => deleteCity(city.id)}
                                className="text-xs text-red-400 hover:text-red-600 whitespace-nowrap"
                              >
                                {t('buttonRemove')}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
