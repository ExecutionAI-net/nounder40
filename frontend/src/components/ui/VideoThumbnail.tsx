'use client'

import { useEffect, useState } from 'react'

// Miniatura di un video con riquadro 16:9 fisso. YouTube offre più
// risoluzioni: si prova la migliore e si scende se manca — YouTube risponde
// 200 con un segnaposto 120×90 invece di un 404, quindi il fallback guarda
// la larghezza reale dell'immagine, non solo onError. Le immagini 4:3 con
// bande nere (hqdefault) vengono ritagliate esattamente delle bande grazie
// a object-cover sul riquadro 16:9: il fotogramma non si taglia.
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
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [candidates.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const src = candidates[index]

  function next() {
    if (index < candidates.length - 1) setIndex(index + 1)
  }

  return (
    <div className={`w-full aspect-video rounded-lg overflow-hidden bg-gray-100 relative ${className}`}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onError={next}
          onLoad={(e) => { if (e.currentTarget.naturalWidth <= 120) next() }}
        />
      )}
      {overlay}
    </div>
  )
}
