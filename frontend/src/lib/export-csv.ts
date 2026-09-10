/**
 * One CSV writer for the whole app.
 *
 * I18N-R3-09: there were three. The HQ Reports one escaped properly, wrote a
 * BOM and declared charset=utf-8; the HQ Payments one quoted every value and
 * had a hardcoded English header row; the School Reports one used
 * `Object.keys(rows[0])`, so its five export buttons emitted raw API field
 * names ("has_active_package") as headers in every language. This is the
 * first of the three, lifted; the callers pass headers they have translated.
 */
export function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
  // BOM: Excel reads a CSV without one as the system codepage and mangles
  // every accented name.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
