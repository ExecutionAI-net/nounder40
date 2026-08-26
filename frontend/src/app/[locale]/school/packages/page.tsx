'use client'

import { useCallback, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import DiscountCodesManager from '@/components/DiscountCodesManager'
import PackagesManager from '@/components/PackagesManager'

type PackageRow = {
  id: string
  name_it: string | null
  name_en: string | null
  name_fr: string | null
  name_es: string | null
}

// I codici sconto della scuola valgono sui suoi pacchetti, quindi vivono qui
// come secondo tab invece che in una voce di menu a parte.
export default function SchoolPackagesPage() {
  const t = useTranslations('school.packages')
  const tDiscounts = useTranslations('discountCodes')
  const [tab, setTab] = useState<'packages' | 'codes'>('packages')
  const locale = useLocale()

  // Pacchetti a cui un codice sconto può essere limitato
  const loadPackageItems = useCallback(async () => {
    const rows = await apiFetch<PackageRow[]>('/school/packages/')
    return (Array.isArray(rows) ? rows : []).map(p => ({
      id: p.id,
      label: (({ it: p.name_it, en: p.name_en, fr: p.name_fr, es: p.name_es } as Record<string, string | null>)[locale])
        || p.name_it || p.name_en || '—',
    }))
  }, [locale])

  return (
    <div>
      <div className="mb-6 inline-flex bg-gray-100 rounded-xl p-1">
        <button
          onClick={() => setTab('packages')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'packages' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
        >
          {t('title')}
        </button>
        <button
          onClick={() => setTab('codes')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'codes' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
        >
          {tDiscounts('tab')}
        </button>
      </div>

      {tab === 'packages' ? (
        <PackagesManager apiBase="/school/packages" title={t('title')} subtitle={t('subtitle')} />
      ) : (
        <DiscountCodesManager apiBase="/school/discount-codes" hint={tDiscounts('schoolHint')} loadItems={loadPackageItems} />
      )}
    </div>
  )
}
