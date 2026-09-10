import { ApiError } from './client'

/**
 * The reason the server gave, or `fallback`.
 *
 * DRF answers a validation failure as `{"field": ["reason"]}`, not
 * `{"error": "..."}` or `{"detail": "..."}`. Reading only those two keys sends
 * every field error into the generic fallback even though the server had
 * already said exactly what was wrong (SCH-R2-18).
 *
 * This lived as a private copy inside the school Locations page. SCH-R3-11
 * needed the same thing on the school Profile page — a rejected `website` was
 * showing "Failed to save" — and a second copy is how the first one stopped
 * being the only one.
 *
 * The text comes back in the backend's own language; translating those
 * messages is a separate, larger job (I18N-R3-08).
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || !err.body) return fallback
  const body = err.body as Record<string, unknown>
  const first = Object.values(body).find(v => Array.isArray(v) && typeof v[0] === 'string')
  return (
    (typeof body.detail === 'string' ? body.detail : null)
    ?? (typeof body.error === 'string' ? body.error : null)
    ?? (Array.isArray(first) ? String(first[0]) : null)
    ?? fallback
  )
}
