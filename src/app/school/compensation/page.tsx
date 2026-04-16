'use client'

import { useEffect, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: string
  name: string
  base_fee: number
  bonus_threshold: number
  bonus_max_threshold: number | null
  bonus_per_student: number
}

interface PaymentRow {
  teacher_id: string
  teacher: { id: string; name: string; email: string } | null
  plan: { name: string; base_fee: number; bonus_threshold: number; bonus_max_threshold: number | null; bonus_per_student: number } | null
  lesson_count: number
  bonus_lessons: number
  total: number
  payment: { amount: number; status: string; paid_at: string | null; note: string | null } | null
}

const emptyPlan = { name: '', base_fee: '', bonus_threshold: '', bonus_max_threshold: '', bonus_per_student: '' }

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(m: string) {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-').map(Number)
  return new Date(y, mo - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' })
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SchoolCompensationPage() {
  const [tab, setTab] = useState<'plans' | 'payments'>('plans')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Compensation</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage compensation plans and teacher payments</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('plans')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'plans' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Plans
        </button>
        <button
          onClick={() => setTab('payments')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === 'payments' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Payments
        </button>
      </div>

      {tab === 'plans' ? <PlansTab /> : <PaymentsTab />}
    </div>
  )
}

// ── Plans Tab ─────────────────────────────────────────────────────────────────

function PlansTab() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyPlan)
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
      bonus_max_threshold: plan.bonus_max_threshold != null ? String(plan.bonus_max_threshold) : '',
      bonus_per_student: String(plan.bonus_per_student),
    })
    setShowForm(true)
  }

  function startNew() {
    setEditingId(null)
    setForm(emptyPlan)
    setShowForm(true)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const minThreshold = Number(form.bonus_threshold || 0)
    const maxThreshold = form.bonus_max_threshold ? Number(form.bonus_max_threshold) : null
    if (maxThreshold !== null && maxThreshold <= minThreshold) {
      setError('Bonus Max Students must be greater than Bonus Min Students')
      setSaving(false)
      return
    }

    const payload = {
      name: form.name,
      base_fee: Number(form.base_fee),
      bonus_threshold: minThreshold,
      bonus_max_threshold: maxThreshold,
      bonus_per_student: Number(form.bonus_per_student || 0),
    }
    const url = editingId ? `/api/school/compensation-plans/${editingId}` : '/api/school/compensation-plans'
    const res = await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
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
    setForm(emptyPlan)
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
      <div className="flex justify-end mb-4">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Base Fee (€/lesson)</label>
                <input type="number" min="0" step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.base_fee}
                  onChange={e => setForm({ ...form, base_fee: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bonus per Student (€)</label>
                <input type="number" min="0" step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.bonus_per_student}
                  onChange={e => setForm({ ...form, bonus_per_student: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bonus Min Students</label>
                <input type="number" min="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 5"
                  value={form.bonus_threshold}
                  onChange={e => setForm({ ...form, bonus_threshold: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-0.5">Bonus starts above this</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bonus Max Students</label>
                <input type="number" min="0"
                  className={`w-full border rounded-lg px-3 py-2 text-sm ${
                    form.bonus_max_threshold && Number(form.bonus_max_threshold) <= Number(form.bonus_threshold || 0)
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-200'
                  }`}
                  placeholder="e.g. 9 (or leave empty)"
                  value={form.bonus_max_threshold}
                  onChange={e => setForm({ ...form, bonus_max_threshold: e.target.value })}
                />
                {form.bonus_max_threshold && Number(form.bonus_max_threshold) <= Number(form.bonus_threshold || 0) ? (
                  <p className="text-xs text-red-500 mt-0.5">Must be greater than min ({form.bonus_threshold || 0})</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">Bonus stops at this number</p>
                )}
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
                  {plan.bonus_threshold > 0 && (
                    plan.bonus_max_threshold
                      ? ` · +€${plan.bonus_per_student}/student (${plan.bonus_threshold}–${plan.bonus_max_threshold} students)`
                      : ` · +€${plan.bonus_per_student}/student above ${plan.bonus_threshold}`
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(plan)}
                  className="text-xs text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition">
                  Edit
                </button>
                <button onClick={() => handleDelete(plan.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition">
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

// ── Payments Tab ──────────────────────────────────────────────────────────────

function PaymentsTab() {
  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [noteModal, setNoteModal] = useState<{ teacherId: string; name: string; total: number; currentNote: string } | null>(null)
  const [noteText, setNoteText] = useState('')

  const canGoNext = month < currentMonth()

  async function load(m: string) {
    setLoading(true)
    const res = await fetch(`/api/school/compensation-payments?month=${m}`)
    const data = await res.json()
    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load(month) }, [month])

  async function markPayment(teacherId: string, status: 'paid' | 'pending', total: number, note?: string) {
    setMarkingId(teacherId)
    await fetch('/api/school/compensation-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: teacherId, month, status, amount: total, note: note ?? null }),
    })
    await load(month)
    setMarkingId(null)
  }

  function openNoteModal(row: PaymentRow) {
    setNoteModal({
      teacherId: row.teacher_id,
      name: row.teacher?.name ?? '',
      total: row.total,
      currentNote: row.payment?.note ?? '',
    })
    setNoteText(row.payment?.note ?? '')
  }

  const totalPending = rows.filter(r => !r.payment || r.payment.status === 'pending').reduce((s, r) => s + r.total, 0)
  const totalPaid = rows.filter(r => r.payment?.status === 'paid').reduce((s, r) => s + r.total, 0)

  return (
    <div>
      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Mark as Paid</h3>
              <p className="text-xs text-gray-400 mt-0.5">{noteModal.name} · {monthLabel(month)} · €{noteModal.total.toFixed(2)}</p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Note (optional)</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Bank transfer ref #123"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={async () => {
                    await markPayment(noteModal.teacherId, 'paid', noteModal.total, noteText)
                    setNoteModal(null)
                  }}
                  disabled={markingId === noteModal.teacherId}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition disabled:opacity-50"
                >
                  {markingId === noteModal.teacherId ? 'Saving...' : 'Confirm Payment'}
                </button>
                <button
                  onClick={() => setNoteModal(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Month selector */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(prevMonth(month))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition">←</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{monthLabel(month)}</span>
          <button onClick={() => setMonth(nextMonth(month))}
            disabled={!canGoNext}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition disabled:opacity-30 disabled:cursor-not-allowed">→</button>
          {month !== currentMonth() && (
            <button onClick={() => setMonth(currentMonth())}
              className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition ml-1">
              This month
            </button>
          )}
        </div>

        {/* Summary badges */}
        {!loading && rows.length > 0 && (
          <div className="flex gap-3 text-xs">
            <span className="bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-full font-medium">
              Pending: €{totalPending.toFixed(2)}
            </span>
            <span className="bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium">
              Paid: €{totalPaid.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse h-40 bg-gray-100 rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          No teachers assigned to this school.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Teacher</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Plan</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Lessons</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Amount</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => {
                const isPaid = row.payment?.status === 'paid'
                return (
                  <tr key={row.teacher_id} className="hover:bg-gray-50 transition">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{row.teacher?.name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{row.teacher?.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      {row.plan ? (
                        <div>
                          <p className="text-gray-700">{row.plan.name}</p>
                          <p className="text-xs text-gray-400">€{row.plan.base_fee}/lesson</p>
                        </div>
                      ) : (
                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">No plan</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-gray-700">{row.lesson_count} lessons</p>
                      {row.bonus_lessons > 0 && (
                        <p className="text-xs text-green-600">{row.bonus_lessons} with bonus</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <p className="font-semibold text-gray-900">€{row.total.toFixed(2)}</p>
                      {row.payment?.note && (
                        <p className="text-xs text-gray-400 truncate max-w-[120px] ml-auto">{row.payment.note}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {isPaid ? (
                        <div>
                          <span className="text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">Paid</span>
                          {row.payment?.paid_at && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {new Date(row.payment.paid_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </div>
                      ) : row.total > 0 ? (
                        <span className="text-xs font-medium bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-full">Pending</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.total > 0 && (
                        isPaid ? (
                          <button
                            onClick={() => markPayment(row.teacher_id, 'pending', row.total)}
                            disabled={markingId === row.teacher_id}
                            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100 transition disabled:opacity-50"
                          >
                            Undo
                          </button>
                        ) : (
                          <button
                            onClick={() => openNoteModal(row)}
                            disabled={markingId === row.teacher_id}
                            className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                          >
                            Mark Paid
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
