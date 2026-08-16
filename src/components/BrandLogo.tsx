'use client'

import { useEffect, useState } from 'react'
import { BRAND_DEFAULTS } from '@/lib/brand'

// Logo ufficiale della piattaforma (quello caricato in HQ > Aspetto e barra).
// Parte dal logo di default così non c'è un buco mentre arriva la risposta.
export default function BrandLogo({
  className = 'h-14',
  onDark = false,
}: {
  className?: string
  /** Sidebar scure: il tratto del logo viene reso bianco */
  onDark?: boolean
}) {
  const [url, setUrl] = useState(BRAND_DEFAULTS.logoUrl)

  useEffect(() => {
    fetch('/api/hq/brand-settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.logoUrl) setUrl(d.logoUrl) })
      .catch(() => {})
  }, [])

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="No Under 40"
      className={`w-auto object-contain ${onDark ? 'brightness-0 invert' : 'mx-auto'} ${className}`}
    />
  )
}
