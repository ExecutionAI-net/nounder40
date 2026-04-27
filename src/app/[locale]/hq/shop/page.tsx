'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type Product = {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  active: boolean
  created_at: string
}

const CATEGORIES = ['clothing', 'shoes', 'accessories', 'equipment', 'other']

const EMPTY_FORM = {
  name: '',
  description: '',
  category: 'clothing',
  price: '',
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

const categoryColors: Record<string, string> = {
  clothing: 'bg-purple-100 text-purple-700',
  shoes: 'bg-blue-100 text-blue-700',
  accessories: 'bg-amber-100 text-amber-700',
  equipment: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

export default function HQShopPage() {
  const t = useTranslations('hq.shop')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    setLoading(true)
    const res = await fetch('/api/hq/shop', { cache: 'no-store' })
    if (res.ok) setProducts(await res.json())
    setLoading(false)
  }

  function openNew() {
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/hq/shop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, price: Number(form.price) }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? t('errorSomethingWrong'))
    } else {
      setShowForm(false)
      await fetchProducts()
    }
    setSubmitting(false)
  }

  async function handleToggle(product: Product) {
    await fetch(`/api/hq/shop/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !product.active }),
    })
    fetchProducts()
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return
    await fetch(`/api/hq/shop/${id}`, { method: 'DELETE' })
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('pageSubtitle', { count: products.length })}</p>
        </div>
        <button
          onClick={openNew}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          + {t('buttonAdd')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{t('formTitle')}</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>{t('labelProductName')} *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderProductName')}
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelCategory')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={inputCls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('labelPrice')} *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderPrice')}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{t('labelDescription')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className={inputCls}
                placeholder={t('placeholderDescription')}
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[#5a1930] transition"
            >
              {submitting ? t('buttonSaving') : t('buttonAdd')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              {t('buttonCancel')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('emptyState')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnProduct')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnCategory')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnPrice')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnStatus')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map((product) => (
                <tr key={product.id} className={`hover:bg-gray-50 transition ${!product.active ? 'opacity-50' : ''}`}>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                    {product.description && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{product.description}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${categoryColors[product.category] ?? categoryColors.other}`}>
                      {product.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    €{Number(product.price).toFixed(2)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {product.active ? t('statusActive') : t('statusInactive')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-3">
                    <button
                      onClick={() => handleToggle(product)}
                      className="text-xs text-gray-400 hover:text-gray-700 transition"
                    >
                      {product.active ? t('buttonDeactivate') : t('buttonActivate')}
                    </button>
                    <button
                      onClick={() => handleDelete(product.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition"
                    >
                      {t('buttonDelete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
