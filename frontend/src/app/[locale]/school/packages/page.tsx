'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import DiscountCodesManager from '@/components/DiscountCodesManager'
import PackagesManager from '@/components/PackagesManager'

// I codici sconto della scuola valgono sui suoi pacchetti, quindi vivono qui
// come secondo tab invece che in una voce di menu a parte.
export default function SchoolPackagesPage() {
  const t = useTranslations('school.packages')
  const tDiscounts = useTranslations('discountCodes')
  const [tab, setTab] = useState<'packages' | 'codes'>('packages')

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
        <DiscountCodesManager apiBase="/school/discount-codes" hint={tDiscounts('schoolHint')} />
      )}
    </div>
  )
}
