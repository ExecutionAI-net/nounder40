'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

export type TeacherScope = 'mine' | 'all'

const STORAGE_KEY = 'nu40_teacher_scope'

export interface TeacherSchoolGrant {
  school_id: string
  school_name?: string
  school_city?: string | null
  can_view_all_lessons?: boolean
  can_manage_bookings?: boolean
}

// Una sola GET /teacher/schools/ per pagina: la leggono lo scope, il
// selettore scuola nella barra, la dashboard e il profilo (code review 13/09).
const SCHOOLS_TTL = 60_000
let schoolsPromise: Promise<TeacherSchoolGrant[]> | null = null
let schoolsAt = 0

export function fetchTeacherSchools(): Promise<TeacherSchoolGrant[]> {
  const now = Date.now()
  if (!schoolsPromise || now - schoolsAt > SCHOOLS_TTL) {
    schoolsAt = now
    schoolsPromise = apiFetch<TeacherSchoolGrant[]>('/teacher/schools/')
      .then((rows) => rows ?? [])
      .catch((err) => { schoolsPromise = null; throw err })
  }
  return schoolsPromise
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
    fetchTeacherSchools()
      .then(rows => setGrants(rows))
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

// ---------------------------------------------------------------------------
// Scuola scelta nella barra laterale ('' = tutte). La memoria è del
// dispositivo, come lo scope; la valida e la cambia TeacherSchoolSwitcher,
// che poi ricarica la pagina. Le pagine la leggono e la passano come
// ?school= agli endpoint /teacher/* (lezioni, statistiche, libreria) oppure
// filtrano lato client (compensi, per scuola già nella risposta).
// ---------------------------------------------------------------------------

const SCHOOL_KEY = 'nu40_teacher_school'

export function readTeacherSchool(): string {
  try {
    return localStorage.getItem(SCHOOL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeTeacherSchool(schoolId: string) {
  try {
    if (schoolId) localStorage.setItem(SCHOOL_KEY, schoolId)
    else localStorage.removeItem(SCHOOL_KEY)
  } catch {
    // storage non disponibile: la scelta vale solo per questa pagina
  }
}

/** Letta una volta al montaggio (sul server è sempre ''): serve solo alle fetch. */
export function useTeacherSchool(): string {
  const [schoolId] = useState(() => (typeof window === 'undefined' ? '' : readTeacherSchool()))
  return schoolId
}

/** Query string aggiuntiva per /teacher/*: `&school=<id>` quando è scelta una scuola. */
export function schoolParam(schoolId: string): string {
  return schoolId ? `&school=${encodeURIComponent(schoolId)}` : ''
}
