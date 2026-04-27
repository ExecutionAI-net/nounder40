'use client'

import { useEffect, useState } from 'react'

interface School { id: string; name: string; city: string; country: string }

interface Props {
  open: boolean
  currentSchoolId?: string | null
  onSaved: (school: School) => void
}

export default function SchoolSelectModal({ open, currentSchoolId, onSaved }: Props) {
  const [schools, setSchools] = useState<School[]>([])
  const [selected, setSelected] = useState<string>(currentSchoolId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schools/public', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setSchools(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setSelected(currentSchoolId ?? '')
  }, [currentSchoolId])

  if (!open) return null

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setError(null)
    const res = await fetch('/api/student/school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_id: selected }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'Failed to save')
      setSaving(false)
      return
    }
    const school = schools.find(s => s.id === selected)!
    onSaved(school)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-lg">
            {currentSchoolId ? 'Change School' : 'Choose Your School'}
          </h3>
          <p className="text-sm text-gray-400 mt-0.5">
            {currentSchoolId
              ? 'Select a new school. Your current school link will be removed.'
              : 'Select the school where you will be taking classes.'}
          </p>
        </div>

        <div className="px-6 py-4">
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {schools.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading schools...</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {schools.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                    selected === s.id
                      ? 'border-[#6B1F3A] bg-[#6B1F3A]/5'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    selected === s.id ? 'border-[#6B1F3A]' : 'border-gray-300'
                  }`}>
                    {selected === s.id && <div className="w-2 h-2 rounded-full bg-[#6B1F3A]" />}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${selected === s.id ? 'text-[#6B1F3A]' : 'text-gray-900'}`}>
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400">{s.city}, {s.country}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!selected || saving}
            className="mt-4 w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Confirm School'}
          </button>
        </div>
      </div>
    </div>
  )
}
