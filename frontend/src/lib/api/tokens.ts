// JWT storage — localStorage, per the locked architecture decision (Bearer
// tokens, dreemli-style, not httpOnly cookies). Browser-only; every getter
// no-ops during SSR since these are only ever called from Client Components.
//
// Every storage access is guarded: Safari with "Block all cookies", some
// in-app browsers (WhatsApp/Instagram) and private modes throw on
// localStorage. A throw here used to leave auth-context on loading=true
// forever (blank page); now a storage-less browser simply behaves as logged out.

const ACCESS_KEY = 'nu40_access'
const REFRESH_KEY = 'nu40_refresh'

function read(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return read(ACCESS_KEY)
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY)
}

export function setTokens(access: string, refresh: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  } catch {
    // storage unavailable: the session lives in memory only (user state)
  }
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    // nothing to clear
  }
}
