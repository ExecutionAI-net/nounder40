// QA_REGRESSION_ROUND2 R2-H14 — a lesson's `date`/`start_time` are naive
// wall-clock values chosen by the SCHOOL in its own local timezone, not UTC
// and not the viewer's browser timezone. The backend now interprets them
// via `School.timezone` (see backend/bookings/services.py::_lesson_datetime);
// this mirrors that on the frontend so a cancellation-policy/min-notice
// countdown agrees with the server instead of drifting by whatever offset
// separates the viewer's browser from the school (a 2h CEST/UTC drift is
// what actually inverted a refund decision live: the UI said "will not be
// refunded" while the server correctly refunded).

/** Minutes to ADD to a UTC instant to get wall-clock time in `timeZone`
 * (i.e. `wallClockMs = utcMs + offsetMinutes * 60000`). */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs)).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {} as Record<string, string>)
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  )
  return (asIfUtc - utcMs) / 60000
}

/** UTC epoch ms for a naive `date`/`time` interpreted as wall-clock time in
 * `timeZone` — the inverse of `offsetMinutesAt`. One correction pass is
 * enough here (not iterated to a fixed point): a lesson landing in a DST
 * transition's skipped/repeated hour is a real-world edge case with no
 * single correct answer anyway, and this is a countdown display, not a
 * ledger entry. */
export function zonedWallTimeToUtcMs(date: string, time: string, timeZone: string): number {
  const [, y, mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) || []
  const [, h, mi, s] = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time) || []
  if (!y) throw new Error(`invalid date: ${date}`)
  if (!h) throw new Error(`invalid time: ${time}`)
  // First guess: treat the wall-clock values as if they were UTC, then shift
  // by that instant's actual offset in `timeZone`.
  const guessUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0))
  const offsetMin = offsetMinutesAt(guessUtcMs, timeZone)
  return guessUtcMs - offsetMin * 60000
}

/** Hours from now until `date`/`time` (a lesson's local wall-clock start),
 * as decided in the SCHOOL's own timezone — falls back to UTC (matching the
 * backend's own fallback) if the timezone name is missing/unrecognized. */
export function hoursUntilSchoolTime(date: string, time: string, schoolTimeZone: string | null | undefined): number {
  let tz = schoolTimeZone || 'UTC'
  let ms: number
  try {
    ms = zonedWallTimeToUtcMs(date, time, tz)
  } catch {
    tz = 'UTC'
    ms = zonedWallTimeToUtcMs(date, time, tz)
  }
  return (ms - Date.now()) / (1000 * 60 * 60)
}
