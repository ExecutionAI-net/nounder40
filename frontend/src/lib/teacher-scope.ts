'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

export type TeacherScope = 'mine' | 'all'

const STORAGE_KEY = 'nu40_teacher_scope'

export interface TeacherSchoolGrant {
  school_id: string
  school_name?: string
  can_view_all_lessons?: boolean
  can_manage_bookings?: boolean
}

/**
 * "Le mie lezioni / Tutte le lezioni" nel pannello insegnante.
 *
 * L'interruttore compare solo se almeno una scuola l'ha resa "staff"
 * (TeacherSchool.can_view_all_lessons, acceso da Scuola → Insegnanti); senza
 * quel permesso il server restituisce comunque solo le sue lezioni. La scelta
 * resta memorizzata sul dispositivo.
 */
export function useTeacherScope() {
  const [choice, setChoice] = useState<TeacherScope>('all')
  const [grants, setGrants] = useState<TeacherSchoolGrant[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'mine' || saved === 'all') setChoice(saved)
    } catch {
      // storage non disponibile: resta il default
    }
    apiFetch<TeacherSchoolGrant[]>('/teacher/schools/')
      .then(rows => setGrants(rows ?? []))
      .catch(() => setGrants([]))
      .finally(() => setLoaded(true))
  }, [])

  const setScope = useCallback((next: TeacherScope) => {
    setChoice(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  const viewAllSchools = grants.filter(g => g.can_view_all_lessons).map(g => g.school_id)
  const canViewAll = viewAllSchools.length > 0

  return {
    // Senza permesso la scelta non conta: sono sempre e solo le sue
    scope: (canViewAll ? choice : 'mine') as TeacherScope,
    setScope,
    canViewAll,
    viewAllSchools,
    loaded,
  }
}

/** Query string per /teacher/lessons/: `scope=mine` quando serve restringere. */
export function scopeParam(scope: TeacherScope): string {
  return scope === 'mine' ? '&scope=mine' : ''
}
