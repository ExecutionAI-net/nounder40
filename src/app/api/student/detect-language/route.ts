import { NextRequest, NextResponse } from 'next/server'

// Maps ISO country codes to platform language codes
const COUNTRY_TO_LANG: Record<string, string> = {
  IT: 'it',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', PE: 'es', CL: 'es',
  VE: 'es', EC: 'es', BO: 'es', PY: 'es', UY: 'es', GT: 'es',
  CU: 'es', DO: 'es', HN: 'es', SV: 'es', NI: 'es', CR: 'es',
  PA: 'es', PR: 'es',
}

export async function GET(request: NextRequest) {
  const country = request.headers.get('x-vercel-ip-country') ?? ''
  const language = COUNTRY_TO_LANG[country.toUpperCase()] ?? 'en'
  return NextResponse.json({ language })
}
