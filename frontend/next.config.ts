import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// In sviluppo gli URL dei chunk di Turbopack si ripetono cambiando contenuto:
// una cache lunga farebbe vedere l'interfaccia vecchia finché non si spunta
// "Disable cache" nei DevTools. In produzione i nomi hanno l'hash, quindi la
// cache lunga è sicura e necessaria.
const isDev = process.env.NODE_ENV !== 'production'
const STATIC_CACHE = isDev
  ? 'no-store, must-revalidate'
  : 'public, max-age=31536000, immutable'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // Asset con hash nel nome: cache lunga in produzione, mai in sviluppo
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: STATIC_CACHE },
        ],
      },
      {
        // Tutto tranne gli asset con hash, che hanno la regola sopra:
        // le regole successive sovrascrivono le precedenti sulla stessa chiave
        source: '/((?!_next/static/).*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://api.anthropic.com",
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Le pagine si rivalidano sempre: con max-age il browser teneva
            // per un'ora l'HTML vecchio, che puntava al CSS vecchio (interfaccia
            // "senza stili" dopo un deploy).
            key: 'Cache-Control',
            value: 'no-cache, must-revalidate',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig);
