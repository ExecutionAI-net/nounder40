// Root 404 — must render its own <html>/<body> because the root layout is a
// pass-through (html/body live in [locale]/layout.tsx). Without this file,
// any unknown URL crashed with "Missing <html> and <body> tags in the root
// layout".
//
// I18N-R3-03: this is no longer what a visitor normally sees. A path under a
// locale prefix is caught by [locale]/[...rest]/page.tsx and rendered by
// [locale]/not-found.tsx, which has the language. What is left here is the
// handful of paths with no locale to render in at all — the ones
// middleware.ts skips (anything with a file extension, /manifest.json,
// /sw.js). There is no locale to pick, so it declares the default one and
// says it once instead of twice.
import Link from 'next/link'

export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#fafafa', color: '#111827', padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 48, fontWeight: 700, color: '#6B1F3A', margin: 0 }}>404</p>
          <p style={{ margin: 0, fontSize: 15 }}>Page not found</p>
          <Link href="/" style={{ marginTop: 8, color: '#6B1F3A', fontSize: 14, fontWeight: 500 }}>
            ← No Under 40
          </Link>
        </div>
      </body>
    </html>
  )
}
