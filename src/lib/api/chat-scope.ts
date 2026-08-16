export type ChatProfile = { role: string; roles: string[] | null; school_id: string | null }

/**
 * Un account può avere più ruoli (es. HQ che gestisce anche una scuola):
 * il solo campo `role` non basta a capire cosa deve vedere. Ogni pannello
 * dichiara il proprio ambito (`scope`) e qui si verifica che lo possieda.
 */
export function resolveChatScope(profile: ChatProfile, wanted?: string | null): string {
  const roles = profile.roles?.length ? profile.roles : profile.role ? [profile.role] : []
  const has = (r: string) => roles.includes(r)

  if (wanted && has(wanted) && (wanted !== 'school' || profile.school_id)) return wanted
  if (has('school') && profile.school_id) return 'school'
  if (has('hq')) return 'hq'
  if (has('teacher')) return 'teacher'
  if (has('student')) return 'student'
  return profile.role
}
