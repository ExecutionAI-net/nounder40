'use client'

import { useTranslations } from 'next-intl'
import PackagesManager from '@/components/PackagesManager'

export default function HQPackagesPage() {
  const t = useTranslations('hq.packages')
  // I pacchetti HQ non hanno una scuola: il prezzo lezione singola non si
  // applica (vedi PackagesManager).
  return <PackagesManager apiBase="/api/hq/packages" title={t('pageTitle')} subtitle={t('pageDescription')} allowDropIn={false} />
}
