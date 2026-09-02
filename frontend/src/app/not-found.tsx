// Root 404 — must render its own <html>/<body> because the root layout is a
// pass-through (html/body live in [locale]/layout.tsx). Without this file,
// any unknown URL crashed with "Missing <html> and <body> tags in the root
// layout". No locale context here, hence the bilingual copy.
export default function NotFound() {
  return (
    <html lang="it">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#fafafa', color: '#111827', padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 48, fontWeight: 700, color: '#6B1F3A', margin: 0 }}>404</p>
          <p style={{ margin: 0, fontSize: 15 }}>Pagina non trovata · Page not found</p>
          <a href="/" style={{ marginTop: 8, color: '#6B1F3A', fontSize: 14, fontWeight: 500 }}>
            ← No Under 40
          </a>
        </div>
      </body>
    </html>
  )
}
