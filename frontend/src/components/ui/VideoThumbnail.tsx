'use client'

import { useEffect, useState } from 'react'

// Miniatura di un video con riquadro 16:9 fisso. YouTube offre più
// risoluzioni: si prova la migliore e si scende se manca — YouTube risponde
// 200 con un segnaposto 120×90 invece di un 404, quindi si guarda la
// larghezza reale dell'immagine. La scelta avviene con oggetti Image fuori
// dal DOM: con l'immagine già in cache l'evento load di un <img> può
// scattare prima che React agganci onLoad (QA TUT-R5-2, segnaposto
// rimasto sullo schermo alle visite successive). Le immagini 4:3 con bande
// nere (hqdefault) perdono solo le bande grazie a object-cover sul 16:9.
const PLACEHOLDER_MAX_WIDTH = 120

export default function VideoThumbnail({
  candidates,
  alt = '',
  className = '',
  overlay,
}: {
  /** URL in ordine di preferenza; il primo che carica davvero vince */
  candidates: string[]
  alt?: string
  className?: string
  overlay?: React.ReactNode
}) {
  const [src, setSrc] = useState<string | null>(null)
  const key = candidates.join('|')

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    const list = key ? key.split('|') : []
    function tryAt(i: number) {
      if (cancelled || i >= list.length) return
      const probe = new Image()
      probe.onload = () => {
        if (cancelled) return
        if (probe.naturalWidth > PLACEHOLDER_MAX_WIDTH) setSrc(list[i])
        else tryAt(i + 1)
      }
      probe.onerror = () => tryAt(i + 1)
      probe.src = list[i]
    }
    tryAt(0)
    return () => { cancelled = true }
  }, [key])

  return (
    <div className={`w-full aspect-video rounded-lg overflow-hidden bg-gray-100 relative ${className}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="w-full h-full object-cover" />
      )}
      {overlay}
    </div>
  )
}
