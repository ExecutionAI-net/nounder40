// Every date the UI shows is dd-mm-yyyy (Carlo, 2026-09-28: "ovunque"),
// whatever the interface language -- the backend's e-mails already write
// strftime("%d-%m-%Y"). A weekday, where a page wants one, is a word in the
// UI language in front of the numbers ("lun 05-10-2026"). Calendar headers
// (month names, weekday columns) are navigation, not dates, and keep their
// words. Date inputs are the browser's own and are not touched.

type DateInput = string | Date | null | undefined

// 'YYYY-MM-DD', an ISO timestamp or a Date as a local Date; a bare day is
// pinned at noon so no timezone can move it to the day before
export function toDate(value: DateInput): Date | null {
  if (!value) return null
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  const d = value.includes('T') ? new Date(value) : new Date(value + 'T12:00:00')
  return isNaN(d.getTime()) ? null : d
}

const pad = (n: number) => String(n).padStart(2, '0')

// "05-10-2026". Nothing gives "—"; a string that is not a date (a "—"
// placeholder from the API) comes back as it is. `_locale` is accepted for
// the callers that still pass it: the order no longer depends on it.
export function formatDate(value: DateInput, _locale?: string): string {
  if (!value) return '—'
  const d = toDate(value)
  if (!d) return typeof value === 'string' ? value : '—'
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

// "05-10-2026 18:30" (local time)
export function formatDateTime(value: DateInput): string {
  const d = toDate(value)
  if (!d) return typeof value === 'string' && value ? value : '—'
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// "lun 05-10-2026", or with `weekday: 'long'` "lunedì 05-10-2026"
export function formatDateWeekday(value: DateInput, locale: string, weekday: 'short' | 'long' = 'short'): string {
  const d = toDate(value)
  if (!d) return typeof value === 'string' && value ? value : '—'
  let day: string
  try {
    day = d.toLocaleDateString(locale, { weekday })
  } catch {
    day = d.toLocaleDateString('en', { weekday })
  }
  return `${day} ${formatDate(d)}`
}

// A JS Date as dd-mm-yyyy (kept for the callers that hold a Date)
export function formatDateObj(d: Date): string {
  return formatDate(d)
}

// Plain text (e-mail previews): the same dd-mm-yyyy, empty for nothing
export function formatLessonDate(date: string | null | undefined): string {
  if (!date) return ''
  return formatDate(date)
}

// Combine a 'YYYY-MM-DD' date and 'HH:MM' time into a Date object
export function parseLessonDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`)
}
