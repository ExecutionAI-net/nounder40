// Client-side API fetch wrapper — the replacement for `supabase.from(...)` /
// `supabase.auth...` calls in every Client Component. Attaches the JWT Bearer
// token, retries once on 401 via the refresh token, and normalizes errors.
'use client'

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './tokens'

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message || `API error ${status}`)
    this.status = status
    this.body = body
  }
}

function apiPath(path: string): string {
  return path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`
}

let refreshInFlight: Promise<string | null> | null = null

async function performRefresh(): Promise<string | null> {
  const refresh = getRefreshToken()
  if (!refresh) return null
  try {
    const res = await fetch(apiPath('/auth/refresh/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
    if (!res.ok) {
      clearTokens()
      return null
    }
    const data = await res.json()
    setTokens(data.access, data.refresh ?? refresh)
    return data.access as string
  } catch {
    return null
  }
}

// Coalesce concurrent 401s into a single refresh call.
function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  _internal: { retry?: boolean } = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  const access = getAccessToken()
  if (access) headers.set('Authorization', `Bearer ${access}`)

  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (!isFormData && init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(apiPath(path), { ...init, headers })

  if (res.status === 401 && _internal.retry !== false && getRefreshToken()) {
    const newAccess = await refreshOnce()
    if (newAccess) {
      return apiFetch<T>(path, init, { retry: false })
    }
  }

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, body, typeof body === 'object' && body && 'detail' in body ? String((body as { detail: unknown }).detail) : undefined)
  }

  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  return undefined as T
}

export function apiUrl(path: string): string {
  return apiPath(path)
}
