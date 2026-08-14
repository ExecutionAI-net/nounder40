import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Checks whether a YouTube/Vimeo video allows embedding, via oEmbed.
// YouTube returns 401/403 for videos whose owner disabled embedding —
// the UI then shows the thumbnail + external link instead of a broken iframe.
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let oembed: string | null = null
  if (/youtube\.com|youtu\.be/.test(url)) {
    oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`
  } else if (/vimeo\.com/.test(url)) {
    oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
  }
  if (!oembed) return NextResponse.json({ embeddable: false })

  try {
    const res = await fetch(oembed, { signal: AbortSignal.timeout(4000) })
    const out = NextResponse.json({ embeddable: res.ok })
    out.headers.set('Cache-Control', 'public, max-age=3600')
    return out
  } catch {
    // rete incerta: prova comunque l'embed
    return NextResponse.json({ embeddable: true })
  }
}
