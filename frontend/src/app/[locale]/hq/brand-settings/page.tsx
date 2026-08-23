'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import ColorPicker from '@/components/ui/ColorPicker'
import ImageUploadInput from '@/components/ui/ImageUploadInput'
import BrandTopBar from '@/components/BrandTopBar'
import { BRAND_DEFAULTS, brandCssVars, parseBrandSettings, type BrandLink, type BrandSettings } from '@/lib/brand'
import { apiFetch, ApiError } from '@/lib/api/client'

// Palette proposte: fondi chiari per lo sfondo, neutri scuri per l'accento
const BG_COLORS = ['#FFFFFF', '#FAFAFA', '#F5F3F0', '#F9FAFB']
const ACCENT_COLORS = ['#3D3D3D', '#1F1F1F', '#6B1F3A', '#8A6A4F']

export default function BrandSettingsPage() {
  const t = useTranslations('hq.brand-settings')
  const [brand, setBrand] = useState<BrandSettings>(BRAND_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Record<string, string>>('/hq/brand-settings/')
      .then(d => { setBrand(parseBrandSettings(d)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function updateLink(index: number, patch: Partial<BrandLink>) {
    setBrand(b => ({ ...b, navLinks: b.navLinks.map((l, i) => i === index ? { ...l, ...patch } : l) }))
  }

  function moveLink(index: number, delta: number) {
    setBrand(b => {
      const next = [...b.navLinks]
      const target = index + delta
      if (target < 0 || target >= next.length) return b
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...b, navLinks: next }
    })
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const data = await apiFetch<Record<string, string>>('/hq/brand-settings/', {
        method: 'POST',
        body: JSON.stringify({
          colorBg: brand.colorBg,
          colorPrimary: brand.colorPrimary,
          navLinks: brand.navLinks.filter(l => l.label.trim() && l.url.trim()),
        }),
      })
      setBrand(parseBrandSettings(data))
      setSuccess(true)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setError(body?.error === 'invalid_url' ? t('errorUrl') : body?.error === 'invalid_color' ? t('errorColor') : t('errorFailed'))
    }
    setSaving(false)
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {success && <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg">{t('successSaved')}</div>}
        {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

        {/* Logo */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('logoTitle')}</h2>
          <p className="text-xs text-gray-500 mb-4">{t('logoHint')}</p>
          <ImageUploadInput
            endpoint="/hq/brand-settings/logo/"
            imageUrl={brand.logoUrl}
            label={t('logoLabel')}
            onChange={(url) => setBrand(b => ({ ...b, logoUrl: url ?? BRAND_DEFAULTS.logoUrl }))}
          />
        </section>

        {/* Colori */}
        <section className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('colorsTitle')}</h2>
            <p className="text-xs text-gray-500">{t('colorsHint')}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">{t('colorBgLabel')}</label>
            <ColorPicker value={brand.colorBg} colors={BG_COLORS} onChange={c => setBrand(b => ({ ...b, colorBg: c.toUpperCase() }))} />
            <p className="text-[11px] text-gray-400 mt-1.5">{brand.colorBg}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">{t('colorPrimaryLabel')}</label>
            <ColorPicker value={brand.colorPrimary} colors={ACCENT_COLORS} onChange={c => setBrand(b => ({ ...b, colorPrimary: c.toUpperCase() }))} />
            <p className="text-[11px] text-gray-400 mt-1.5">{brand.colorPrimary}</p>
          </div>
        </section>

        {/* Voci della barra */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('linksTitle')}</h2>
          <p className="text-xs text-gray-500 mb-4">{t('linksHint')}</p>

          <div className="space-y-2">
            {brand.navLinks.map((link, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={link.label}
                  onChange={e => updateLink(i, { label: e.target.value })}
                  placeholder={t('linkLabelPlaceholder')}
                  className="flex-1 min-w-[120px] sm:flex-none sm:w-40 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <input
                  value={link.url}
                  onChange={e => updateLink(i, { url: e.target.value })}
                  placeholder="https://…"
                  className="w-full sm:w-auto sm:flex-1 order-last sm:order-none px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <button type="button" onClick={() => moveLink(i, -1)} disabled={i === 0}
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition">↑</button>
                <button type="button" onClick={() => moveLink(i, 1)} disabled={i === brand.navLinks.length - 1}
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition">↓</button>
                <button type="button" onClick={() => setBrand(b => ({ ...b, navLinks: b.navLinks.filter((_, j) => j !== i) }))}
                  className="w-8 h-8 rounded-lg border border-gray-200 text-red-400 hover:text-red-600 hover:bg-red-50 transition">✕</button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setBrand(b => ({ ...b, navLinks: [...b.navLinks, { label: '', url: '' }] }))}
            className="mt-3 text-xs font-medium text-[#6B1F3A] hover:underline"
          >
            + {t('linkAdd')}
          </button>
        </section>

        {/* Anteprima */}
        <section className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">{t('previewTitle')}</h2>
          <div className="brand-theme rounded-xl overflow-hidden border border-gray-200" style={brandCssVars(brand)}>
            <BrandTopBar brand={brand} compact />
            <div className="bg-brand-bg p-6 text-center space-y-3">
              <h3 className="text-2xl text-gray-900">{t('previewHeading')}</h3>
              <p className="text-sm text-gray-500">{t('previewBody')}</p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button type="button" className="btn-pill btn-pill-solid"><span>{t('previewPrimary')}</span></button>
                <button type="button" className="btn-pill"><span>{t('previewSecondary')}</span><span>→</span></button>
              </div>
            </div>
          </div>
        </section>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
            {saving ? t('buttonSaving') : t('buttonSave')}
          </button>
          <a href="/student/shop" target="_blank" rel="noopener noreferrer"
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('buttonOpenShop')}
          </a>
        </div>
      </form>
    </div>
  )
}
