'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Container } from './primitives'

/**
 * Piede ridotto a logo, presentazione e copyright (20/09/2026): niente
 * colonne di link ne' gazzetta. I rimandi utili stanno gia' nelle sezioni
 * della pagina (orari, registrazione, formazione su alinaquintana.com).
 */
export default function LandingFooter() {
  const t = useTranslations('landing.footer')

  return (
    <footer className="bg-bv-ink text-white">
      <Container className="flex flex-col gap-6 py-14 md:flex-row md:items-center md:justify-between">
        <Image src="/Logo.png" alt="Danza Classica No Under 40" width={140} height={48}
          className="h-10 w-auto object-contain brightness-0 invert" />
        <p className="max-w-xl text-sm leading-6 text-white/70 md:text-right">{t('about')}</p>
      </Container>

      <div className="border-t border-white/10">
        <Container className="py-6 text-xs text-white/50">
          © {new Date().getFullYear()} Danza Classica No Under 40. {t('rights')}
        </Container>
      </div>
    </footer>
  )
}
