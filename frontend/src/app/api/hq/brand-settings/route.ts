import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBrandSettings } from '@/lib/api/brand-settings'
import { BRAND_KEYS, type BrandLink } from '@/lib/brand'

export const dynamic = 'force-dynamic'

// Lettura pubblica: il pannello studente (anche anonimo) legge logo, colori e barra.
export async function GET() {
  return NextResponse.json(await getBrandSettings())
}

const HEX = /^#[0-9a-fA-F]{6}$/
// Solo link assoluti http(s) o percorsi interni: niente javascript:/data:
const SAFE_URL = /^(https?:\/\/|\/)/i

export async function POST(request: Request) {
  if (!await requireRole('hq')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const rows = [
    { key: BRAND_KEYS.colorBg, value: colorBg.toUpperCase(), updated_at: now },
    { key: BRAND_KEYS.colorPrimary, value: colorPrimary.toUpperCase(), updated_at: now },
    { key: BRAND_KEYS.navLinks, value: JSON.stringify(navLinks), updated_at: now },
  ]

  const { error } = await admin.from('platform_settings').upsert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(await getBrandSettings())
}
