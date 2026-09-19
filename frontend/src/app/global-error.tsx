'use client'

// Renders outside the locale layout (no next-intl provider), so the copy is a
// fixed bilingual fallback instead of a message key.
export default function GlobalError() {
  return (
    <html>
      <body style={{ fontFamily: 'sans-serif', textAlign: 'center', padding: '4rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Something went wrong / Qualcosa è andato storto</h1>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: '1rem', padding: '0.6rem 1.25rem', borderRadius: 8, background: '#111', color: '#fff', border: 0 }}
        >
          Reload / Ricarica
        </button>
      </body>
    </html>
  )
}
