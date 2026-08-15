'use client'

import { useTranslations } from 'next-intl'
import PackagesManager from '@/components/PackagesManager'

export default function HQPackagesPage() {
  const t = useTranslations('hq.packages')
  return <PackagesManager apiBase="/api/hq/packages" title={t('pageTitle')} subtitle={t('pageDescription')} />
}
