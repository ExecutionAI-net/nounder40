// Two-week windows for the teacher's Attendance page: "Upcoming" and "Past"
// used to be one unbounded query (a teacher can have thousands of lessons
// planned), so each section pages through 14 days at a time instead.
// Page 0 is the window nearest to today; a higher page is further away.

export const WINDOW_DAYS = 14

export type WindowKind = 'upcoming' | 'past'

// YYYY-MM-DD in the browser's own timezone (toISOString is UTC and flips the
// day around midnight).
export function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function shift(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  d.setDate(d.getDate() + days)
  return d
}

export function attendanceWindow(kind: WindowKind, page: number, today: Date = new Date()): { from: string; to: string } {
  if (kind === 'upcoming') {
    return {
      from: localISODate(shift(today, 1 + WINDOW_DAYS * page)),
      to: localISODate(shift(today, WINDOW_DAYS * (page + 1))),
    }
  }
  return {
    from: localISODate(shift(today, -WINDOW_DAYS * (page + 1))),
    to: localISODate(shift(today, -1 - WINDOW_DAYS * page)),
  }
}
