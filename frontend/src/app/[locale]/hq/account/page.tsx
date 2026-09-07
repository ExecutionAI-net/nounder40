'use client'

import { useTranslations } from 'next-intl'
import ChangePasswordCard from '@/components/account/ChangePasswordCard'
import { useAuth } from '@/lib/api/auth-context'

/**
 * L'HQ non ha una pagina profilo: gli altri tre pannelli ospitano il riquadro
 * "cambia password" dentro il loro profilo, qui serviva un posto dove metterlo.
 * Nessun permesso da controllare — riguarda solo il proprio account.
 */
export default function HQAccountPage() {
  const t = useTranslations('account')
  const { user } = useAuth()

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('pageTitle')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('pageSubtitle')}</p>
      </div>

      {user?.email && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <p className="text-xs text-gray-400 mb-1">{t('emailLabel')}</p>
          <p className="text-sm font-medium text-gray-900">{user.email}</p>
        </div>
      )}

      <ChangePasswordCard />
    </div>
  )
}
