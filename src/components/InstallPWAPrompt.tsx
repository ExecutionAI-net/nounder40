'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPWAPrompt() {
  const t = useTranslations('pwa')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Only show on mobile
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768

    if (!isMobile) return

    const dismissed = localStorage.getItem('pwa-install-dismissed')
    if (dismissed) return

    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setShow(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    deferredPrompt.userChoice.then(() => {
      setShow(false)
      setDeferredPrompt(null)
    })
  }

  function handleDismiss() {
    localStorage.setItem('pwa-install-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#6B1F3A] text-white px-4 py-3 flex items-center gap-3 shadow-lg">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">
          {t('installMessage')}
        </p>
      </div>
      <button
        onClick={handleInstall}
        className="flex-shrink-0 bg-white text-[#6B1F3A] text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-100 transition"
      >
        {t('install')}
      </button>
      <button
        onClick={handleDismiss}
        aria-label={t('dismiss')}
        className="flex-shrink-0 text-white/70 hover:text-white transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
    </div>
  )
}
