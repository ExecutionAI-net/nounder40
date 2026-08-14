// Anteprima media: mostra sempre l'immagine (mai riquadro scuro); al click il
// link del video si apre in un'altra scheda. Niente embed in-app: YouTube
// blocca l'iframe per molti video anche quando l'oEmbed risponde OK.
export default function VideoPreviewPlayer({
  video,
  image,
  emptyLabel,
}: {
  video: string | null
  image: string | null
  emptyLabel?: string
}) {
  // niente media
  if (!video && !image) {
    return emptyLabel
      ? <div className="aspect-video bg-gray-50 flex items-center justify-center text-sm text-gray-300">{emptyLabel}</div>
      : null
  }

  const playBtn = (
    <span className="absolute inset-0 flex items-center justify-center">
      <span className="w-14 h-14 rounded-full bg-black/60 group-hover:bg-black/75 transition flex items-center justify-center">
        <svg className="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.34-5.89a1.5 1.5 0 0 0 0-2.54L6.3 2.84Z"/></svg>
      </span>
    </span>
  )

  // immagine (o placeholder chiaro)
  const visual = image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" className="w-full aspect-video object-cover" />
  ) : (
    <div className="w-full aspect-video bg-gray-100" />
  )

  if (!video) return visual

  // click → link del video in un'altra scheda
  return (
    <a href={video} target="_blank" rel="noreferrer" className="relative block group">{visual}{playBtn}</a>
  )
}
