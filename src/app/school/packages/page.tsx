'use client'

import { useEffect, useState } from 'react'

type Package = {
  id: string
  name_en: string
  name_it: string | null
  description_en: string | null
  credits: number
  validity_days: number
  price: number
  color: string
  is_popular: boolean
  active: boolean
  lesson_types: { name_en: string } | null
}

const COLORS = ['#6B1F3A', '#1F3A6B', '#1F6B3A', '#6B5A1F', '#3A1F6B', '#4A4A4A']

const emptyForm = {
  name_en: '', name_it: '', description_en: '',
  credits: '10', validity_days: '90', price: '',
  color: '#6B1F3A', is_popular: false,
}

export default function SchoolPackagesPage() {
  const [packages, setPackages] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Package | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/school/packages')
    if (res.ok) setPackages(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEdit(pkg: Package) {
    setEditing(pkg)
    setForm({
      name_en: pkg.name_en,
      name_it: pkg.name_it ?? '',
      description_en: pkg.description_en ?? '',
      credits: String(pkg.credits),
      validity_days: String(pkg.validity_days),
      price: String(pkg.price),
      color: pkg.color,
      is_popular: pkg.is_popular,
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name_en || !form.credits || !form.validity_days || !form.price) {
      setError('Name, credits, validity and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    const method = editing ? 'PATCH' : 'POST'
    const url = editing ? `/api/school/packages/${editing.id}` : '/api/school/packages'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setShowForm(false)
      load()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Something went wrong')
    }
    setSaving(false)
  }

  async function handleToggle(pkg: Package) {
    await fetch(`/api/school/packages/${pkg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !pkg.active }),
    })
    load()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Packages</h1>
          <p className="text-gray-500 text-sm mt-0.5">Credit-based access packages for students</p>
        </div>
        <button onClick={openCreate} className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
          + New Package
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">{editing ? 'Edit Package' : 'New Package'}</h2>
          {error && <div className="mb-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Name (EN) *</label>
                <input value={form.name_en} onChange={(e) => setForm(f => ({ ...f, name_en: e.target.value }))} className={inputCls} placeholder="e.g. Starter Pack" />
              </div>
              <div>
                <label className={labelCls}>Name (IT)</label>
                <input value={form.name_it} onChange={(e) => setForm(f => ({ ...f, name_it: e.target.value }))} className={inputCls} placeholder="e.g. Pacchetto Base" />
              </div>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Description</label>
              <input value={form.description_en} onChange={(e) => setForm(f => ({ ...f, description_en: e.target.value }))} className={inputCls} placeholder="Short description..." />
            </div>
            <div>
              <label className={labelCls}>Credits *</label>
              <input type="number" min="1" value={form.credits} onChange={(e) => setForm(f => ({ ...f, credits: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Validity (days) *</label>
              <input type="number" min="1" value={form.validity_days} onChange={(e) => setForm(f => ({ ...f, validity_days: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Price (€) *</label>
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} className={inputCls} placeholder="0.00" />
            </div>
            <div>
              <label className={labelCls}>Color</label>
              <div className="flex gap-2 mt-1 flex-wrap items-center">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition"
                    style={{ backgroundColor: c, borderColor: form.color === c ? '#1f2937' : 'transparent' }} />
                ))}
                <label
                  className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 cursor-pointer overflow-hidden relative flex items-center justify-center hover:border-gray-400 transition"
                  title="Custom color"
                  style={!COLORS.includes(form.color) ? { borderColor: '#1f2937', borderStyle: 'solid', backgroundColor: form.color } : {}}
                >
                  <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                    className="absolute opacity-0 w-full h-full cursor-pointer" />
                  {COLORS.includes(form.color) && <span className="text-gray-400 text-xs leading-none select-none">+</span>}
                </label>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_popular} onChange={(e) => setForm(f => ({ ...f, is_popular: e.target.checked }))} className="w-4 h-4 accent-[#6B1F3A]" />
                <span className="text-sm text-gray-700">Mark as &quot;Most Popular&quot;</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition">
              {saving ? 'Saving...' : (editing ? 'Save Changes' : 'Create Package')}
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : packages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">No packages yet. Create your first package.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <div key={pkg.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden ${!pkg.active ? 'opacity-50' : ''}`}>
              <div className="h-2" style={{ backgroundColor: pkg.color }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900">{pkg.name_en}</p>
                    {pkg.name_it && <p className="text-xs text-gray-400">{pkg.name_it}</p>}
                  </div>
                  {pkg.is_popular && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Popular</span>
                  )}
                </div>
                {pkg.description_en && <p className="text-xs text-gray-500 mb-3">{pkg.description_en}</p>}
                <div className="grid grid-cols-4 gap-3 text-xs mb-4">
                  <div>
                    <p className="text-red-600 font-semibold">Credits</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.credits}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">Valid For</p>
                    <p className="font-bold text-gray-900 mt-0.5">{pkg.validity_days}d</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">Price per Credit</p>
                    <p className="font-bold text-gray-900 mt-0.5">€{(Number(pkg.price) / Number(pkg.credits)).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-red-600 font-semibold">Total Price</p>
                    <p className="font-bold text-gray-900 mt-0.5">€{Number(pkg.price).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">Edit</button>
                  <button onClick={() => handleToggle(pkg)} className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition">
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
