'use client'

import { useEffect, useState } from 'react'
import { BRAND_DEFAULTS, parseBrandSettings } from '@/lib/brand'
import { apiFetch } from '@/lib/api/client'

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
    apiFetch<Record<string, string>>('/platform-stats/')
      .then((raw) => setUrl(parseBrandSettings(raw).logoUrl))
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
