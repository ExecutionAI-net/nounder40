'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

interface AttendanceStatus {
  id: string
  name: string
  color: string
  burns_credit: boolean
  is_default: boolean
  sort_order: number
}

const PRESET_COLORS = [
  '#22c55e', '#ef4444', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#6b7280', '#ec4899', '#14b8a6',
  '#f97316', '#0ea5e9', '#84cc16', '#a855f7',
]

const DEFAULT_STATUSES = [
  { name: 'Present', color: '#22c55e', burns_credit: true, is_default: true, sort_order: 0 },
  { name: 'No Show', color: '#ef4444', burns_credit: false, is_default: false, sort_order: 1 },
  { name: 'Late', color: '#f59e0b', burns_credit: false, is_default: false, sort_order: 2 },
  { name: 'Cancelled', color: '#6b7280', burns_credit: false, is_default: false, sort_order: 3 },
  { name: 'Reserved', color: '#3b82f6', burns_credit: false, is_default: false, sort_order: 4 },
  { name: 'Medical', color: '#8b5cf6', burns_credit: false, is_default: false, sort_order: 5 },
]

export default function AttendanceStatusesPage() {
  const t = useTranslations('school.statuses')
  const [statuses, setStatuses] = useState<AttendanceStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', color: '#22c55e', burns_credit: false, is_default: false })

  // New status form
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', color: '#22c55e', burns_credit: false, is_default: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStatuses()
  }, [])

  async function loadStatuses() {
    setLoading(true)
    const res = await fetch('/api/school/attendance-statuses', { cache: 'no-store' })
    const data = await res.json()
    setStatuses(data.statuses ?? [])
    setLoading(false)
  }

  async function seedDefaults() {
    setSeeding(true)
    setError(null)
    for (const s of DEFAULT_STATUSES) {
      await fetch('/api/school/attendance-statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      })
    }
    await loadStatuses()
    setSeeding(false)
  }

  async function handleCreate() {
    if (!newForm.name.trim()) return
    setSaving(true)
    setError(null)
    const res = await fetch('/api/school/attendance-statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newForm, sort_order: statuses.length }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      setSaving(false)
      return
    }
    setStatuses(prev => [...prev, data.status])
    setNewForm({ name: '', color: '#22c55e', burns_credit: false, is_default: false })
    setShowNew(false)
    setSaving(false)
  }

  function startEdit(s: AttendanceStatus) {
    setEditingId(s.id)
    setEditForm({ name: s.name, color: s.color, burns_credit: s.burns_credit, is_default: s.is_default })
  }

  async function handleUpdate(id: string) {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/school/attendance-statuses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      setSaving(false)
      return
    }
    setStatuses(prev => prev.map(s => s.id === id ? data.status : s))
    setEditingId(null)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this status?')) return
    setError(null)
    const res = await fetch(`/api/school/attendance-statuses/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      return
    }
    setStatuses(prev => prev.filter(s => s.id !== id))
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('newStatus')}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* Empty state with seed button */}
      {statuses.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-500 text-sm mb-4">{t('noStatuses')}</p>
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
          >
            {seeding ? t('creating') : t('createDefaults')}
          </button>
        </div>
      )}

      {/* Status List */}
      {statuses.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {statuses.map(s => (
            <div key={s.id}>
              {editingId === s.id ? (
                <div className="p-4 space-y-4">
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      placeholder={t('statusNamePlaceholder')}
                    />
                  </div>

                  {/* Color picker */}
                  <div>
                    <p className="text-xs text-gray-500 mb-2">{t('color')}</p>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setEditForm(f => ({ ...f, color: c }))}
                          className="w-7 h-7 rounded-full border-2 transition"
                          style={{
                            backgroundColor: c,
                            borderColor: editForm.color === c ? '#1f2937' : 'transparent',
                          }}
                        />
                      ))}
                      <label
                        className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 cursor-pointer overflow-hidden relative flex items-center justify-center hover:border-gray-400 transition"
                        title="Custom color"
                        style={!PRESET_COLORS.includes(editForm.color) ? { borderColor: '#1f2937', borderStyle: 'solid', backgroundColor: editForm.color } : {}}
                      >
                        <input type="color" value={editForm.color} onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                          className="absolute opacity-0 w-full h-full cursor-pointer" />
                        {PRESET_COLORS.includes(editForm.color) && <span className="text-gray-400 text-xs leading-none select-none">+</span>}
                      </label>
                    </div>
                  </div>

                  {/* Burns credit toggle */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <div className="relative mt-0.5 flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={editForm.burns_credit}
                        onChange={e => setEditForm(f => ({ ...f, burns_credit: e.target.checked }))}
                      />
                      <div className={`w-10 h-6 rounded-full transition ${editForm.burns_credit ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${editForm.burns_credit ? 'left-5' : 'left-1'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">{t('burnsCredit')}</p>
                      <p className="text-xs text-gray-400">{t('burnsCreditDesc')}</p>
                    </div>
                  </label>

                  {/* Default toggle */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={editForm.is_default}
                        onChange={e => setEditForm(f => ({ ...f, is_default: e.target.checked }))}
                      />
                      <div className={`w-10 h-6 rounded-full transition ${editForm.is_default ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${editForm.is_default ? 'left-5' : 'left-1'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">{t('defaultStatus')}</p>
                      <p className="text-xs text-gray-400">{t('defaultStatusDesc')}</p>
                    </div>
                  </label>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleUpdate(s.id)}
                      disabled={saving}
                      className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? t('saving') : t('save')}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-4 py-2 text-gray-500 rounded-lg text-sm hover:bg-gray-50"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3.5 flex items-center gap-4">
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: s.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{s.name}</span>
                      {s.is_default && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{t('defaultBadge')}</span>
                      )}
                      {s.burns_credit && (
                        <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">{t('burnsCreditBadge')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => startEdit(s)}
                      className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Status Form */}
      {showNew && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">{t('newStatusTitle')}</h3>

          <input
            type="text"
            value={newForm.name}
            onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            placeholder={t('statusNamePlaceholder')}
            autoFocus
          />

          {/* Color picker */}
          <div>
            <p className="text-xs text-gray-500 mb-2">{t('color')}</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNewForm(f => ({ ...f, color: c }))}
                  className="w-7 h-7 rounded-full border-2 transition"
                  style={{
                    backgroundColor: c,
                    borderColor: newForm.color === c ? '#1f2937' : 'transparent',
                  }}
                />
              ))}
              <label
                className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 cursor-pointer overflow-hidden relative flex items-center justify-center hover:border-gray-400 transition"
                title="Custom color"
                style={!PRESET_COLORS.includes(newForm.color) ? { borderColor: '#1f2937', borderStyle: 'solid', backgroundColor: newForm.color } : {}}
              >
                <input type="color" value={newForm.color} onChange={e => setNewForm(f => ({ ...f, color: e.target.value }))}
                  className="absolute opacity-0 w-full h-full cursor-pointer" />
                {PRESET_COLORS.includes(newForm.color) && <span className="text-gray-400 text-xs leading-none select-none">+</span>}
              </label>
            </div>
          </div>

          {/* Burns credit toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={newForm.burns_credit}
                onChange={e => setNewForm(f => ({ ...f, burns_credit: e.target.checked }))}
              />
              <div className={`w-10 h-6 rounded-full transition ${newForm.burns_credit ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${newForm.burns_credit ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{t('burnsCredit')}</p>
              <p className="text-xs text-gray-400">{t('burnsCreditDesc')}</p>
            </div>
          </label>

          {/* Default toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={newForm.is_default}
                onChange={e => setNewForm(f => ({ ...f, is_default: e.target.checked }))}
              />
              <div className={`w-10 h-6 rounded-full transition ${newForm.is_default ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${newForm.is_default ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{t('defaultStatus')}</p>
              <p className="text-xs text-gray-400">{t('defaultStatusDesc')}</p>
            </div>
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={saving || !newForm.name.trim()}
              className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? t('creating') : t('createStatus')}
            </button>
            <button
              onClick={() => { setShowNew(false); setNewForm({ name: '', color: '#22c55e', burns_credit: false, is_default: false }) }}
              className="px-4 py-2 text-gray-500 rounded-lg text-sm hover:bg-gray-50"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
