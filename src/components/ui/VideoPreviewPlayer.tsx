'use client'

import { useState } from 'react'
import { useEmbeddable } from '@/lib/use-embeddable'
import { toEmbedUrl } from '@/lib/video-preview'

// Player di anteprima "click-to-play": mostra sempre l'immagine (mai riquadro
// scuro); al click parte l'embed in-app, o si apre il link esterno quando il
// proprietario del video ha disattivato l'incorporamento.
export default function VideoPreviewPlayer({
  video,
  image,
  emptyLabel,
}: {
  video: string | null
  image: string | null
  emptyLabel?: string
}) {
  const embeddable = useEmbeddable(video)
  const [playing, setPlaying] = useState(false)
  const embed = toEmbedUrl(video)

  // niente media
  if (!video && !image) {
    return emptyLabel
      ? <div className="aspect-video bg-gray-50 flex items-center justify-center text-sm text-gray-300">{emptyLabel}</div>
      : null
  }

  // embed in corso
  if (playing && embed && embeddable !== false) {
    return (
      <div className="aspect-video bg-black">
        <iframe src={`${embed}?autoplay=1`} className="w-full h-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    )
  }

  const playBtn = (
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="w-14 h-14 rounded-full bg-black/60 group-hover:bg-black/75 transition flex items-center justify-center">
        <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.34-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z"/></svg>
      </span>
    </span>
  )

  // immagine (o placeholder chiaro) + play
  const visual = image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" className="w-full aspect-video object-cover" />
  ) : (
    <div className="w-full aspect-video bg-gray-100" />
  )

  if (!video) return visual

  // embed consentito → play in-app; bloccato → apri il link esterno
  return embeddable === false ? (
    <a href={video} target="_blank" rel="noreferrer" className="relative block group">{visual}{playBtn}</a>
  ) : (
    <button type="button" onClick={() => setPlaying(true)} className="relative block group w-full">{visual}{playBtn}</button>
  )
}
