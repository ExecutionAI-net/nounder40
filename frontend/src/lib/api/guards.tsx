'use client'

import { useEffect } from 'react'
import { useRouter } from '@/navigation'
import { useAuth, type AuthUser } from './auth-context'

type Role = 'hq' | 'school' | 'teacher' | 'student'

function rolesOf(user: AuthUser): string[] {
  return user.roles?.length ? user.roles : user.role ? [user.role] : []
}

/**
 * Client-side replacement for the old middleware's server-validated role
 * gate. Redirects to /login when unauthenticated, or to the user's own
 * dashboard when they're on the wrong role's section — mirrors the
 * old Supabase middleware's roleRoutes behavior exactly.
 */
export function useRequireRole(role: Role) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }
    const roles = rolesOf(user)
    if (!roles.includes(role)) {
      router.replace(`/${roles[0] || 'student'}/dashboard`)
    }
  }, [user, loading, role, router])

  return { user, loading }
}

/** Same idea, but any authenticated user is fine (no specific role required). */
export function useRequireAuth() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) router.replace('/login')
  }, [user, loading, router])

  return { user, loading }
}
