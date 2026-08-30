'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from './client'
import { clearTokens, getAccessToken, setTokens } from './tokens'

export interface AuthUser {
  id: string
  email: string
  full_name: string
  role: string
  roles: string[]
  hq_sub_role: string
  school_sub_role: string
  active_school: string | null
  language_preference: string
  phone: string
  city: string
}

interface TokenPairResponse {
  user: AuthUser
  access: string
  refresh: string
}

interface RegisterPayload {
  email: string
  password: string
  full_name?: string
  first_name?: string
  last_name?: string
  language_preference?: string
  phone?: string
  date_of_birth?: string
  city?: string
  country?: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  loginWithGoogle: (idToken: string, language?: string) => Promise<AuthUser>
  register: (payload: RegisterPayload) => Promise<AuthUser>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  setUser: (user: AuthUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await apiFetch<AuthUser>('/auth/me/')
      setUser(me)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<TokenPairResponse>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    setTokens(data.access, data.refresh)
    setUser(data.user)
    return data.user
  }, [])

  const loginWithGoogle = useCallback(async (idToken: string, language?: string) => {
    const data = await apiFetch<TokenPairResponse>('/auth/google/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken, language }),
    })
    setTokens(data.access, data.refresh)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (payload: RegisterPayload) => {
    const data = await apiFetch<TokenPairResponse>('/auth/register/', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setTokens(data.access, data.refresh)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    const refresh = typeof window !== 'undefined' ? localStorage.getItem('nu40_refresh') : null
    try {
      await apiFetch('/auth/logout/', { method: 'POST', body: JSON.stringify({ refresh }) })
    } catch {
      // best-effort — always clear local state regardless
    }
    clearTokens()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    await loadUser()
  }, [loadUser])

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, register, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
