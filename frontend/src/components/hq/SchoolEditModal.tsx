'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import SchoolAddressFields, { normalizeWebsite, type SchoolAddressValues } from '@/components/school/SchoolAddressFields'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'

export type EditableSchool = {
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

// Shared HQ school edit modal (used by the schools list and the detail page).
export default function SchoolEditModal({
  school,
  onClose,
  onSaved,
}: {
  school: EditableSchool
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('hq.schools')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [form, setForm] = useState({
    name: school.name,
    email: school.email,
    phone: school.phone ?? '',
    platform_fee_percentage: school.platform_fee_percentage,
    shop_commission_percentage: school.shop_commission_percentage ?? 0,
  })
  const [addr, setAddr] = useState<SchoolAddressValues>({
    address: school.address ?? '',
    address_line2: school.address_line2 ?? '',
    city: school.city ?? '',
    province: school.province ?? '',
    country: school.country ?? '',
    vat_number: school.vat_number ?? '',
    website: school.website ?? '',
  })

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      await apiFetch(`/hq/schools/${school.id}/`, {
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
      onSaved()
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setSaveError(body?.error ?? t('errorSaveFailed'))
    }
    setSaving(false)
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-xs text-gray-500 mb-1'

  const fields: { key: 'name' | 'email' | 'phone'; label: string; span2?: boolean; type?: string }[] = [
    { key: 'name', label: t('labelSchoolName'), span2: true },
    { key: 'email', label: t('labelEmail'), span2: true, type: 'email' },
    { key: 'phone', label: t('labelPhone') },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 shrink-0">
          <h3 className="font-semibold text-gray-900 text-lg">{t('modalTitle')}</h3>
          <p className="text-sm text-gray-400 mt-0.5">{school.name}</p>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map(({ key, label, span2, type }) => (
              <div key={key} className={span2 || key === 'phone' ? 'sm:col-span-2' : ''}>
                <label className={labelCls}>{label}</label>
                {key === 'phone' ? (
                  <PhoneInput value={String(form.phone ?? '')}
                    onChange={phone => setForm(f => ({ ...f, phone }))}
                    inputClassName={inputCls} />
                ) : (
                  <input type={type ?? 'text'} value={String(form[key])} onChange={set(key)} className={inputCls} />
                )}
              </div>
            ))}
            <SchoolAddressFields values={addr} onChange={setAddr} />
            <div>
              <label className={labelCls}>{t('labelPlatformFee')}</label>
              <input
                type="number" min={0} max={100}
                value={form.platform_fee_percentage}
                onChange={e => setForm(f => ({ ...f, platform_fee_percentage: Number(e.target.value) }))}
                className={inputCls}
              />
            </div>
            {/* % riconosciuta alla scuola sulle vendite shop ai suoi studenti */}
            <div>
              <label className={labelCls}>{t('labelShopCommission')}</label>
              <input
                type="number" min={0} max={100}
                value={form.shop_commission_percentage}
                onChange={e => setForm(f => ({ ...f, shop_commission_percentage: Number(e.target.value) }))}
                className={inputCls}
              />
            </div>
          </div>
          {saveError && <p className="text-xs text-red-500 mt-3">{saveError}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || !form.name}
            className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
          >
            {saving ? t('buttonSaving') : t('buttonSaveChanges')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
          >
            {t('buttonCancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
