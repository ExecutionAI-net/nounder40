'use client'

import { useEffect, useState } from 'react'

type Country = { id: string; name: string; code: string }
type City = { id: string; country_id: string; name: string }

export default function HQLocationsPage() {
  const [countries, setCountries] = useState<Country[]>([])
  const [cities, setCities] = useState<City[]>([])
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
    const res = await fetch('/api/locations')
    if (res.ok) {
      const d = await res.json()
      setCountries(d.countries ?? [])
      setCities(d.cities ?? [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addCountry() {
    if (!newCountry.name || !newCountry.code) return
    setAddingCountry(true)
    setCountryError('')
    const res = await fetch('/api/hq/locations/countries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCountry),
    })
    const data = await res.json()
    if (!res.ok) { setCountryError(data.error ?? 'Error'); setAddingCountry(false); return }
    setCountries((c) => [...c, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewCountry({ name: '', code: '' })
    setAddingCountry(false)
  }

  async function deleteCountry(id: string) {
    await fetch(`/api/hq/locations/countries/${id}`, { method: 'DELETE' })
    setCountries((c) => c.filter((x) => x.id !== id))
    setCities((c) => c.filter((x) => x.country_id !== id))
    if (expandedCountry === id) setExpandedCountry(null)
  }

  async function addCity() {
    if (!selectedCountryId || !newCityName) return
    setAddingCity(true)
    setCityError('')
    const res = await fetch('/api/hq/locations/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country_id: selectedCountryId, name: newCityName }),
    })
    const data = await res.json()
    if (!res.ok) { setCityError(data.error ?? 'Error'); setAddingCity(false); return }
    setCities((c) => [...c, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewCityName('')
    setExpandedCountry(selectedCountryId)
    setAddingCity(false)
  }

  async function deleteCity(id: string) {
    await fetch(`/api/hq/locations/cities/${id}`, { method: 'DELETE' })
    setCities((c) => c.filter((x) => x.id !== id))
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
        <p className="text-gray-500 text-sm mt-1">Manage the countries and cities available across the platform.</p>
      </div>

      {/* Add Country */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Add Country</h2>
        {countryError && <p className="text-sm text-red-500">{countryError}</p>}
        <div className="flex gap-3">
          <input
            placeholder="Country name (e.g. Italy)"
            value={newCountry.name}
            onChange={(e) => setNewCountry((f) => ({ ...f, name: e.target.value }))}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <input
            placeholder="Code (e.g. IT)"
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
            {addingCountry ? 'Adding...' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Add City */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Add City</h2>
        {cityError && <p className="text-sm text-red-500">{cityError}</p>}
        <div className="flex gap-3">
          <select
            value={selectedCountryId}
            onChange={(e) => setSelectedCountryId(e.target.value)}
            className="w-44 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 bg-white"
          >
            <option value="">Select country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            placeholder="City name (e.g. Milano)"
            value={newCityName}
            onChange={(e) => setNewCityName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCity()}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          />
          <button
            onClick={addCity}
            disabled={addingCity || !selectedCountryId || !newCityName}
            className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
          >
            {addingCity ? 'Adding...' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Countries & Cities list */}
      <div className="space-y-3">
        {countries.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            No countries added yet.
          </div>
        ) : (
          countries.map((country) => {
            const countryCities = cities.filter((c) => c.country_id === country.id)
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
                    <p className="text-xs text-gray-400">{countryCities.length} {countryCities.length === 1 ? 'city' : 'cities'}</p>
                  </div>
                  <button
                    onClick={() => setExpandedCountry(isOpen ? null : country.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mr-2"
                  >
                    {isOpen ? 'Hide' : 'Show'} cities
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                      className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteCountry(country.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>

                {/* Cities list */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {countryCities.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No cities yet for {country.name}.</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {countryCities.map((city) => (
                          <div key={city.id} className="flex items-center justify-between px-5 py-2.5">
                            <span className="text-sm text-gray-700">📍 {city.name}</span>
                            <button
                              onClick={() => deleteCity(city.id)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
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
