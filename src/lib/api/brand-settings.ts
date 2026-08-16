import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND_DEFAULTS, BRAND_KEYS, parseBrandSettings, type BrandSettings } from '@/lib/brand'

// Lettura server-side delle impostazioni di aspetto. Usa il client admin perché
// il pannello studente è consultabile anche da visitatori anonimi.
export async function getBrandSettings(): Promise<BrandSettings> {
  try {
    const { data } = await createAdminClient()
      .from('platform_settings')
      .select('key, value')
      .in('key', Object.values(BRAND_KEYS))

    const raw: Record<string, string> = {}
    data?.forEach(({ key, value }) => { raw[key] = value })
    return parseBrandSettings(raw)
  } catch {
    // Impostazioni non raggiungibili: meglio il tema di default che una pagina rotta
    return BRAND_DEFAULTS
  }
}
