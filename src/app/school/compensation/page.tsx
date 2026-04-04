'use client'

import { useEffect, useState } from 'react'

interface Plan {
  id: string
  name: string
  base_fee: number
  bonus_threshold: number
  bonus_per_student: number
}

const empty = { name: '', base_fee: '', bonus_threshold: '', bonus_per_student: '' }

export default function SchoolCompensationPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/school/compensation-plans')
    const data = await res.json()
    setPlans(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startEdit(plan: Plan) {
    setEditingId(plan.id)
    setForm({
      name: plan.name,
      base_fee: String(plan.base_fee),
      bonus_threshold: String(plan.bonus_threshold),
      bonus_per_student: String(plan.bonus_per_student),
    })
    setShowForm(true)
  }

  function startNew() {
    setEditingId(null)
    setForm(empty)
    setShowForm(true)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const payload = {
      name: form.name,
      base_fee: Number(form.base_fee),
      bonus_threshold: Number(form.bonus_threshold || 0),
      bonus_per_student: Number(form.bonus_per_student || 0),
    }

    const url = editingId
      ? `/api/school/compensation-plans/${editingId}`
      : '/api/school/compensation-plans'
    const method = editingId ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
      setSaving(false)
      return
    }

    await load()
    setShowForm(false)
    setForm(empty)
    setEditingId(null)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this compensation plan?')) return
    await fetch(`/api/school/compensation-plans/${id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compensation Plans</h1>
          <p className="text-gray-500 text-sm mt-0.5">Define how teachers are paid per lesson</p>
        </div>
        <button
          onClick={startNew}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + New Plan
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">{editingId ? 'Edit Plan' : 'New Plan'}</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Plan Name</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. Standard, Senior, Guest"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Base Fee (€/lesson)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.base_fee}
                  onChange={e => setForm({ ...form, base_fee: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bonus Threshold (students)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.bonus_threshold}
                  onChange={e => setForm({ ...form, bonus_threshold: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bonus per Student (€)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.bonus_per_student}
                  onChange={e => setForm({ ...form, bonus_per_student: e.target.value })}
                />
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.base_fee}
                className="bg-[#6B1F3A] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null) }}
                className="bg-gray-100 text-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-200 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse h-16 bg-gray-100 rounded-xl" />
      ) : plans.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          No compensation plans yet.
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => (
            <div key={plan.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{plan.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  €{plan.base_fee}/lesson
                  {plan.bonus_threshold > 0 && ` · +€${plan.bonus_per_student}/student above ${plan.bonus_threshold}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(plan)}
                  className="text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
