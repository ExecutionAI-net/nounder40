'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

// The school role matrix (HQ → Permissions), read the same way SchoolLayout
// reads it to filter the sidebar: the caller's `school_sub_role` looked up in
// /school/permissions/. Same fallback too — no sub-role, or a role the matrix
// does not know (owner), sees everything.

type SchoolRoleRow = { key: string; permissions: string[] }

let rolesPromise: Promise<SchoolRoleRow[]> | null = null

function loadRoles(): Promise<SchoolRoleRow[]> {
  if (!rolesPromise) {
    rolesPromise = apiFetch<SchoolRoleRow[]>('/school/permissions/').catch(() => {
      rolesPromise = null // try again next time
      return []
    })
  }
  return rolesPromise
}

/** Whether the caller's school role may open `section` ("reports", "students",
 *  ...). `null` until known. */
export function useSchoolSectionAllowed(section: string): boolean | null {
  const { user } = useAuth()
  const subRole = user?.school_sub_role ?? ''
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!subRole) { setAllowed(true); return }
    let alive = true
    loadRoles().then(roles => {
      if (!alive) return
      const match = roles.find(r => r.key === subRole)
      setAllowed(!match || match.permissions.includes(section))
    })
    return () => { alive = false }
  }, [subRole, section])

  return allowed
}
