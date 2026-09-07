// Helper condivisi per i due contratti backend introdotti dal round-2 QA:
//  - R2-M7  giorni di chiusura scuola  (`school_closed` / `skipped_closure_dates`)
//  - R2-M12 lezione al completo        (`lesson_full` / `overbooked`)
// Vivono qui perché li usano sia il pannello scuola sia quello insegnante.
'use client'

import { ApiError } from '@/lib/api/client'

export interface LessonFullInfo {
  current: number
  max: number
}

/** 409 `{"error":"lesson_full", ..., "allow_overbooking_required": true}` →
 *  i numeri veri da mostrare nella conferma, `null` se è un altro errore. */
export function lessonFullInfo(err: unknown): LessonFullInfo | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null
  const body = err.body as {
    error?: string
    allow_overbooking_required?: boolean
    current_bookings?: number
    max_capacity?: number
  } | null
  if (!body || typeof body !== 'object') return null
  if (body.error !== 'lesson_full' || !body.allow_overbooking_required) return null
  return { current: Number(body.current_bookings ?? 0), max: Number(body.max_capacity ?? 0) }
}

/** `{"overbooked": true, "warning": {...}}` di una POST andata a buon fine. */
export function overbookedWarning(payload: unknown): LessonFullInfo | null {
  const body = payload as {
    overbooked?: boolean
    warning?: { code?: string; current_bookings?: number; max_capacity?: number }
  } | null
  if (!body || typeof body !== 'object' || !body.overbooked) return null
  const w = body.warning
  return { current: Number(w?.current_bookings ?? 0), max: Number(w?.max_capacity ?? 0) }
}

/** 400 `{"error":"school_closed","date":"2026-09-27"}` → la data ISO. */
export function schoolClosedDate(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null
  const body = err.body as { error?: string; date?: string } | null
  if (!body || typeof body !== 'object' || body.error !== 'school_closed') return null
  return body.date ?? null
}

/** `skipped_closure_dates` — c'è sia nelle 200 sia nel corpo del 400 del wizard. */
export function skippedClosureDates(payload: unknown): string[] {
  const arr = (payload as { skipped_closure_dates?: unknown } | null | undefined)?.skipped_closure_dates
  if (!Array.isArray(arr)) return []
  return arr.filter((d): d is string => typeof d === 'string')
}

/** "2026-09-27" → "27/09/2026" (formato numerico della lingua interfaccia). */
export function formatClosureDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatClosureDates(dates: string[], locale: string): string {
  return dates.map(d => formatClosureDate(d, locale)).join(', ')
}
