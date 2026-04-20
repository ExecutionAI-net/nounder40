'use client'

import { useEffect, useState } from 'react'

const COLORS = ['#6B1F3A', '#1F3A6B', '#2D6B1F', '#6B5F1F', '#4B1F6B', '#1F5F6B']

type Package = {
  id: string
  name_en: string
  name_it: string
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  is_popular: boolean
  active: boolean
  created_at: string
}

const emptyForm = {
  name_en: '',
  name_it: '',
  description_en: '',
  credits: 10,
  validity_days: 90,
  price: '',
  color: '#6B1F3A',
  is_popular: false,
}

export default function HQPackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => { fetchPackages() }, [])

  async function fetchPackages() {
    const res = await fetch('/api/hq/packages')
    if (res.ok) setPackages(await res.json())
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm({ ...emptyForm })
    setError(null)
    setShowForm(true)
  }

  function openEdit(pkg: Package) {
    setEditing(pkg)
    setForm({
      name_en: pkg.name_en,
      name_it: pkg.name_it ?? '',
      description_en: pkg.description_en ?? '',
      credits: pkg.credits,
      validity_days: pkg.validity_days,
      price: String(pkg.price),
      color: pkg.color,
      is_popular: pkg.is_popular,
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name_en || !form.credits || !form.validity_days || form.price === '') {
      setError('Name, credits, validity and price are required.')
      return
    }
    setSaving(true)
    setError(null)

    const payload = {
      name_en: form.name_en,
      name_it: form.name_it || form.name_en,
      description_en: form.description_en || null,
      credits: Number(form.credits),
      validity_days: Number(form.validity_days),
      price: Number(form.price),
      color: form.color,
      is_popular: form.is_popular,
    }

    const res = editing
      ? await fetch(`/api/hq/packages/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await fetch('/api/hq/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save'); setSaving(false); return }

    setSuccess(editing ? 'Package updated.' : 'Package created.')
    setShowForm(false)
    await fetchPackages()
    setSaving(false)
  }

  async function toggleActive(pkg: Package) {
    await fetch(`/api/hq/packages/${pkg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !pkg.active }),
    })
    await fetchPackages()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Packages</h1>
          <p className="text-gray-500 text-sm mt-0.5">Global packages sold to students — payment goes to their school</p>
        </div>
        <button onClick={openNew} className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          + New Package
        </button>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between">
          {success}
          <button onClick={() => setSuccess(null)} className="text-green-500 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{editing ? 'Edit Package' : 'New Package'}</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (EN) *</label>
              <input value={form.name_en} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} className={inputCls} placeholder="e.g. Starter Pack" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (IT)</label>
              <input value={form.name_it} onChange={e => setForm(f => ({ ...f, name_it: e.target.value }))} className={inputCls} placeholder="e.g. Pacchetto Base" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input value={form.description_en} onChange={e => setForm(f => ({ ...f, description_en: e.target.value }))} className={inputCls} placeholder="Short description (optional)" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Credits *</label>
              <input type="number" min={1} value={form.credits} onChange={e => setForm(f => ({ ...f, credits: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Validity (days) *</label>
              <input type="number" min={1} value={form.validity_days} onChange={e => setForm(f => ({ ...f, validity_days: Number(e.target.value) }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price (€) *</label>
              <input type="number" min={0} step={0.01} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} className={inputCls} placeholder="0.00" />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`w-7 h-7 rounded-full border-2 transition ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer mt-4">
              <input type="checkbox" checked={form.is_popular} onChange={e => setForm(f => ({ ...f, is_popular: e.target.checked }))}
                className="w-4 h-4 rounded accent-[#6B1F3A]" />
              <span className="text-gray-700">Mark as Popular</span>
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[#5a1930] transition">
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Package'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(null) }} className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Packages list */}
      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">No packages yet. Create your first credit package.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map(pkg => (
            <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${!pkg.active ? 'opacity-50' : ''}`}>
              <div className="h-1.5" style={{ backgroundColor: pkg.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900">{pkg.name_en}</p>
                      {pkg.is_popular && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Popular</span>}
                    </div>
                    {pkg.description_en && <p className="text-xs text-gray-400 mt-0.5">{pkg.description_en}</p>}
                  </div>
                </div>

                <div className="flex items-end justify-between mb-4">
                  <div>
                    <p className="text-3xl font-bold text-gray-900">€{Number(pkg.price).toFixed(0)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{pkg.credits} credits · {pkg.validity_days}d validity</p>
                  </div>
                  <p className="text-xs text-gray-400">€{(pkg.price / pkg.credits).toFixed(2)}/credit</p>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => openEdit(pkg)}
                    className="flex-1 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition font-medium">
                    Edit
                  </button>
                  <button onClick={() => toggleActive(pkg)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${pkg.active ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                    {pkg.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
