// The one sanctioned server-side call to Django (Server Components and
// generateMetadata only). CLAUDE.md §3 rule 3 sends every browser request
// through lib/api/client.ts for the JWT and the refresh; this helper is the
// server-only counterpart for public, tokenless endpoints: it reaches Django
// by its compose DNS name (DJANGO_API_URL), never sees localStorage, and
// answers null on any failure so a page never breaks over a preview.
export async function serverApiFetch<T>(
  path: string,
  { revalidate = 60, timeoutMs = 2000 }: { revalidate?: number | false; timeoutMs?: number } = {},
): Promise<T | null> {
  const base = process.env.DJANGO_API_URL || process.env.API_URL
  if (!base) return null
  try {
    const res = await fetch(`${base}/api${path.startsWith('/') ? '' : '/'}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      ...(revalidate === false ? { cache: 'no-store' as const } : { next: { revalidate } }),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
