'use client'

import Image from 'next/image'
import type { ReactNode } from 'react'

/**
 * Guscio split-screen condiviso da login e register ("Atelier Élevé", vedi
 * globals.css per i token `au-*`). La foto e il duotone bordeaux vivono qui;
 * il contenuto di ciascun pannello resta libero perché login e register
 * raccontano cose diverse (citazione + cameo vs. citazione + fondatrice).
 *
 * Il pannello foto sparisce sotto `lg`: sotto quella soglia lo spazio serve
 * al modulo, non all'illustrazione.
 */
export default function AuthSplit({
  imageSrc,
  imageAlt,
  visual,
  children,
}: {
  imageSrc: string
  imageAlt: string
  visual: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-au-surface font-body text-au-on-surface">
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8 lg:p-12">
        <div className="au-panel-elevated grid w-full max-w-[1240px] grid-cols-1 overflow-hidden rounded-xl bg-au-surface-container-lowest lg:grid-cols-2">
          <div className="relative hidden overflow-hidden lg:block">
            <Image src={imageSrc} alt={imageAlt} fill sizes="50vw" priority
              className="object-cover" />
            <div aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-au-primary via-au-primary/70 to-au-primary/30" />
            <div className="relative flex h-full flex-col justify-between p-10 text-au-surface xl:p-14">
              {visual}
            </div>
          </div>

          <div className="flex items-center justify-center px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
            <div className="w-full max-w-sm">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
