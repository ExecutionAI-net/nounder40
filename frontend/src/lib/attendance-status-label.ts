// Gli stati presenza sono record DB per scuola (Stati presenza) e nascono
// coi nomi inglesi di default: qui i default noti vengono tradotti nella
// lingua dell'utente, i nomi personalizzati restano come scritti.
const KEY_BY_NAME: Record<string, string> = {
  present: 'present',
  'no show': 'noShow',
  'no-show': 'noShow',
  noshow: 'noShow',
  late: 'late',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  reserved: 'reserved',
  medical: 'medical',
}

export function attendanceStatusKey(name: string): string | null {
  return KEY_BY_NAME[name.trim().toLowerCase()] ?? null
}
