'use client'

// Modifica scuola come PAGINA normale (niente modal incastrato: su mobile i
// modal con scroll interno si bloccavano — la pagina scorre naturalmente).
import { useEffect, useState, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import SchoolAddressFields, { normalizeWebsite, type SchoolAddressValues } from '@/components/school/SchoolAddressFields'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'

type SchoolDetail = {
  id: string
  name: string
  city: string
  country: string | null
  email: string
  phone: string | null
  address: string | null
  address_line2: string | null
  province: string | null
  vat_number: string | null
  website: string | null
  platform_fee_percentage: number
  shop_commission_percentage?: number | null
}

export default function HQSchoolEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('hq.schools')
  const router = useRouter()
  const searchParams = useSearchParams()
  // Salva/Annulla tornano da dove sei arrivato: lista Scuole o dettaglio
  const backHref = searchParams.get('from') === 'list' ? '/hq/schools' : `/hq/schools/${id}`

  const [school, setSchool] = useState<SchoolDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    platform_fee_percentage: 0, shop_commission_percentage: 0,
  })
  const [addr, setAddr] = useState<SchoolAddressValues>({
    address: '', address_line2: '', city: '', province: '', country: '', vat_number: '', website: '',
  })

  useEffect(() => {
    apiFetch<SchoolDetail>(`/hq/schools/${id}/`)
      .then(s => {
        setSchool(s)
        setForm({
          name: s.name, email: s.email, phone: s.phone ?? '',
          platform_fee_percentage: s.platform_fee_percentage,
          shop_commission_percentage: s.shop_commission_percentage ?? 0,
        })
        setAddr({
          address: s.address ?? '', address_line2: s.address_line2 ?? '',
          city: s.city ?? '', province: s.province ?? '', country: s.country ?? '',
          vat_number: s.vat_number ?? '', website: s.website ?? '',
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  function set(field: 'name' | 'email') {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      await apiFetch(`/hq/schools/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || '',
          address: addr.address || '',
          address_line2: addr.address_line2 || '',
          city: addr.city,
          province: addr.province || '',
          country: addr.country,
          vat_number: addr.vat_number || '',
          website: normalizeWebsite(addr.website) || '',
          platform_fee_percentage: Number(form.platform_fee_percentage),
          shop_commission_percentage: Number(form.shop_commission_percentage),
        }),
      })
      router.push(backHref)
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setSaveError(body?.error ?? t('errorSaveFailed'))
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs text-gray-500 mb-1'

  if (loading) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }
  if (!school) {
    return <p className="text-gray-400 text-sm">{t('errorSaveFailed')}</p>
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('modalTitle')}</h1>
        <p className="text-gray-500 text-sm mt-1">{school.name}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 sm:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>{t('labelSchoolName')}</label>
            <input value={form.name} onChange={set('name')} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t('labelEmail')}</label>
            <input type="email" value={form.email} onChange={set('email')} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>{t('labelPhone')}</label>
            <PhoneInput
              value={form.phone}
              onChange={phone => setForm(f => ({ ...f, phone }))}
              inputClassName={inputCls}
            />
          </div>
          <SchoolAddressFields values={addr} onChange={setAddr} />
          <div>
            <label className={labelCls}>{t('labelPlatformFee')}</label>
            <input
              type="number" min={0} max={100}
              value={form.platform_fee_percentage}
              onChange={e => setForm(f => ({ ...f, platform_fee_percentage: Number(e.target.value) }))}
              className={inputCls}
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('helpPlatformFee')}</p>
          </div>
          <div>
            <label className={labelCls}>{t('labelShopCommission')}</label>
            <input
              type="number" min={0} max={100}
              value={form.shop_commission_percentage}
              onChange={e => setForm(f => ({ ...f, shop_commission_percentage: Number(e.target.value) }))}
              className={inputCls}
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('helpShopCommission')}</p>
          </div>
        </div>
        {saveError && <p className="text-xs text-red-500 mt-3">{saveError}</p>}

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="flex-1 sm:flex-none sm:px-8 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {saving ? t('buttonSaving') : t('buttonSaveChanges')}
          </button>
          <button
            onClick={() => router.push(backHref)}
            className="px-6 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
          >
            {t('buttonCancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
