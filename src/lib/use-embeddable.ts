'use client'

import { useEffect, useState } from 'react'

// true = mostra iframe; false = thumbnail + link esterno; null = in verifica
export function useEmbeddable(videoUrl: string | null): boolean | null {
  const [embeddable, setEmbeddable] = useState<boolean | null>(null)

  useEffect(() => {
    if (!videoUrl) { setEmbeddable(false); return }
    let alive = true
    setEmbeddable(null)
    fetch(`/api/video-check?url=${encodeURIComponent(videoUrl)}`)
      .then(r => r.ok ? r.json() : { embeddable: true })
      .then(d => { if (alive) setEmbeddable(!!d.embeddable) })
      .catch(() => { if (alive) setEmbeddable(true) })
    return () => { alive = false }
  }, [videoUrl])

  return embeddable
}
