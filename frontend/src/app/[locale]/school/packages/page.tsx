'use client'

import { useTranslations } from 'next-intl'
import PackagesManager from '@/components/PackagesManager'

export default function SchoolPackagesPage() {
  const t = useTranslations('school.packages')
  return <PackagesManager apiBase="/school/packages" title={t('title')} subtitle={t('subtitle')} />
}
