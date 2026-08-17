import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandSettings } from '@/lib/api/brand-settings'
import { BRAND_KEYS, type BrandLink } from '@/lib/brand'

export const dynamic = 'force-dynamic'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

// Lettura pubblica: il pannello studente (anche anonimo) legge logo, colori e barra.
export async function GET() {
  return NextResponse.json(await getBrandSettings())
}

const HEX = /^#[0-9a-fA-F]{6}$/
// Solo link assoluti http(s) o percorsi interni: niente javascript:/data:
const SAFE_URL = /^(https?:\/\/|\/)/i

export async function POST(request: Request) {
  const body = await request.json()
  const colorBg = String(body.colorBg ?? '').trim()
  const colorPrimary = String(body.colorPrimary ?? '').trim()
  if (!HEX.test(colorBg) || !HEX.test(colorPrimary)) {
    return NextResponse.json({ error: 'invalid_color' }, { status: 400 })
  }

  const navLinks: BrandLink[] = Array.isArray(body.navLinks)
    ? body.navLinks
        .map((l: BrandLink) => ({ label: String(l?.label ?? '').trim(), url: String(l?.url ?? '').trim() }))
        .filter((l: BrandLink) => l.label && l.url)
    : []
  if (navLinks.some(l => !SAFE_URL.test(l.url))) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${DJANGO_API_URL}/api/platform-settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({
      [BRAND_KEYS.colorBg]: colorBg.toUpperCase(),
      [BRAND_KEYS.colorPrimary]: colorPrimary.toUpperCase(),
      [BRAND_KEYS.navLinks]: JSON.stringify(navLinks),
    }),
  })
  if (!res.ok) {
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  }

  return NextResponse.json(await getBrandSettings())
}
