'use client'

// Sedi e Città è uno SPECCHIO dei profili scuola (per Carlo): niente
// aggiunta/rimozione manuale — la lista deriva da città e paese che le
// scuole scrivono nel proprio profilo e alimenta la ricerca per città.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { countryName } from '@/lib/country-name'
import { flagOf } from '@/lib/countries'

type SchoolSite = { id: string; name: string; address: string }
type SchoolRow = { id: string; name: string; city: string; country: string | null; active: boolean; locations?: SchoolSite[] }
type NestedCountry = { id: string; name: string; code: string; cities: { id: string; name: string }[] }

export default function HQLocationsPage() {
  const t = useTranslations('hq.locations')
  const locale = useLocale()
  const [countries, setCountries] = useState<NestedCountry[]>([])
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Il link del calendario filtrato per paese: e' il codice ISO che conta
  function copyCalendarLink(code: string) {
    const url = `${window.location.origin}/${locale}/student/book?country=${code}`
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    })
  }

  useEffect(() => {
    Promise.all([
      apiFetch<NestedCountry[]>('/locations/').catch(() => [] as NestedCountry[]),
      apiFetch<SchoolRow[]>('/hq/schools/').catch(() => [] as SchoolRow[]),
    ]).then(([countryList, schoolList]) => {
      setCountries(countryList)
      setSchools(schoolList)
      setLoading(false)
    })
  }, [])

  const norm = (s: string) => s.trim().toLowerCase()
  const schoolsInCity = (city: string) => schools.filter(s => s.city && norm(s.city) === norm(city))

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        {countries.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            {t('emptyState')}
          </div>
        ) : (
          countries.map((country) => {
            const countrySchoolCount = country.cities.reduce((sum, c) => sum + schoolsInCity(c.name).length, 0)
            const isOpen = expandedCountry === country.id
            return (
              <div key={country.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <button
                  onClick={() => setExpandedCountry(isOpen ? null : country.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition"
                >
                  <span className="w-10 h-10 shrink-0 rounded-full bg-[#6B1F3A]/10 flex items-center justify-center text-xl">
                    {flagOf(country.code) || '🌍'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">
                      {countryName(country.code, locale, country.name)}
                      {country.code && <span className="ml-2 text-[10px] font-mono text-gray-400">{country.code}</span>}
                    </p>
                    <p className="text-xs text-gray-400">
                      {country.cities.length} {t('citiesLabel', { count: country.cities.length })} · {t('schoolsCount', { count: countrySchoolCount })}
                    </p>
                  </div>
                  {country.code && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); copyCalendarLink(country.code) }}
                      className="shrink-0 px-2 py-1 rounded-md border border-gray-200 text-[11px] text-gray-600 hover:bg-gray-50"
                      title={`/${locale}/student/book?country=${country.code}`}
                    >
                      {copiedCode === country.code ? t('linkCopied') : t('copyCalendarLink')}
                    </span>
                  )}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                    className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50 divide-y divide-gray-100">
                    {country.cities.map((city) => {
                      const cSchools = schoolsInCity(city.name)
                      return (
                        <div key={city.id} className="px-5 py-3">
                          <p className="text-sm font-medium text-gray-700">📍 {city.name}</p>
                          <div className="mt-1.5 space-y-2">
                            {cSchools.map(s => (
                              <div key={s.id}>
                                <Link
                                  href={`/${locale}/hq/schools/${s.id}`}
                                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#6B1F3A] transition"
                                >
                                  <span className="truncate">{s.name}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${s.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {s.active ? t('schoolActive') : t('schoolInactive')}
                                  </span>
                                </Link>
                                {(s.locations ?? []).length > 0 && (
                                  <ul className="mt-1 ml-4 space-y-0.5">
                                    {(s.locations ?? []).map(site => (
                                      <li key={site.id} className="text-xs text-gray-500">
                                        🏠 {site.name}{site.address ? <span className="text-gray-400"> — {site.address}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <p className="text-xs text-gray-400">{t('sourceNote')}</p>
    </div>
  )
}
