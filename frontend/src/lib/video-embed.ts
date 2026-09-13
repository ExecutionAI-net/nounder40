// Link video esterni (YouTube / Vimeo) → URL da mettere in un <iframe>.
// Usato dalla Libreria Metodo (HQ) e dai Tutorial (HQ + studente): un solo
// posto per le regex, così un nuovo formato di link si aggiunge una volta.

const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/

export function youtubeId(url: string | null | undefined): string | null {
  const m = url?.match(YOUTUBE)
  return m ? m[1] : null
}

// True se il link è di una piattaforma che si incorpora con un iframe; un
// file video diretto (mp4 su un CDN) va invece in un <video>.
export function isEmbedUrl(url: string | null | undefined): boolean {
  return !!url && (YOUTUBE.test(url) || VIMEO.test(url))
}

// Per un link non riconosciuto restituisce l'URL così com'è (comportamento
// storico della Libreria, che lo mette comunque in un iframe).
export function getEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const yt = youtubeId(url)
  if (yt) return `https://www.youtube.com/embed/${yt}`
  const vimeo = url.match(VIMEO)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return url
}

// Anteprima gratuita per i video YouTube; per gli altri serve una miniatura
// caricata a mano (Vimeo la dà solo via API).
export function getVideoThumbnail(url: string | null | undefined): string | null {
  const yt = youtubeId(url)
  return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : null
}

// Dalla risoluzione migliore alla peggiore: maxresdefault (1280×720, non
// sempre presente) → sddefault (640×480) → hqdefault (480×360, c'è sempre).
// Le due 4:3 hanno bande nere sopra e sotto: in un riquadro 16:9 con
// object-cover si tagliano solo le bande (components/ui/VideoThumbnail.tsx).
export function getVideoThumbnailCandidates(url: string | null | undefined, custom?: string | null): string[] {
  const out: string[] = []
  if (custom) out.push(custom)
  const yt = youtubeId(url)
  if (yt) out.push(...['maxresdefault', 'sddefault', 'hqdefault'].map((n) => `https://img.youtube.com/vi/${yt}/${n}.jpg`))
  return out
}
