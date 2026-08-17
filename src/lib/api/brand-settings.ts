import { BRAND_DEFAULTS, BRAND_KEYS, parseBrandSettings, type BrandSettings } from '@/lib/brand'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

// Lettura server-side delle impostazioni di aspetto. Il pannello studente
// è consultabile anche da visitatori anonimi, quindi nessun auth qui.
export async function getBrandSettings(): Promise<BrandSettings> {
  try {
    const keys = Object.values(BRAND_KEYS).join(',')
    const res = await fetch(`${DJANGO_API_URL}/api/platform-settings?keys=${keys}`, { cache: 'no-store' })
    const raw: Record<string, string> = await res.json()
    return parseBrandSettings(raw)
  } catch {
    // Impostazioni non raggiungibili: meglio il tema di default che una pagina rotta
    return BRAND_DEFAULTS
  }
}
