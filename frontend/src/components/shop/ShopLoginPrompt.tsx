'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/navigation'

// Il negozio e le schede prodotto sono pubblici: registrazione o accesso
// vengono chiesti solo al momento del pagamento.
export default function ShopLoginPrompt({ next, onClose }: { next: string; onClose: () => void }) {
  const t = useTranslations('student.shop')
  const tLayout = useTranslations('layout')
  const router = useRouter()
  const target = encodeURIComponent(next)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-brand/10 text-brand flex items-center justify-center mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h3>
          <p className="text-sm text-gray-500 mt-1.5">{t('loginPromptText')}</p>
        </div>
        <div className="px-6 pb-6 space-y-2">
          <button
            onClick={() => router.push(`/register?next=${target}`)}
            className="w-full py-2.5 bg-brand text-brand-fg rounded-xl text-sm font-medium hover:bg-brand-hover transition"
          >
            {tLayout('register')}
          </button>
          <button
            onClick={() => router.push(`/login?next=${target}`)}
            className="w-full py-2.5 border border-brand/30 text-brand rounded-xl text-sm font-medium hover:bg-brand/5 transition"
          >
            {tLayout('signIn')}
          </button>
          <button onClick={onClose} className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
