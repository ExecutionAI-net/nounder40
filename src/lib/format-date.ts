// Format a date string (yyyy-mm-dd or ISO) to dd/mm/yyyy
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  // Handle ISO strings
  const d = date.includes('T') ? new Date(date) : new Date(date + 'T12:00:00')
  if (isNaN(d.getTime())) return date
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// Format a JS Date to dd/mm/yyyy
export function formatDateObj(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

// Format 'YYYY-MM-DD' to long locale string for emails, e.g. "15 April 2026"
export function formatLessonDate(date: string | null | undefined): string {
  if (!date) return ''
  const d = new Date(date + 'T12:00:00')
  if (isNaN(d.getTime())) return date ?? ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Combine a 'YYYY-MM-DD' date and 'HH:MM' time into a Date object
export function parseLessonDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}`)
}
