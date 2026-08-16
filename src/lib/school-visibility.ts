import { createAdminClient } from '@/lib/supabase/admin'

// schools.show_teacher_to_students: se false, il nome insegnante non va mai
// esposto alle allieve (pagine e email). Tollerante alla migrazione 058 mancante
// (colonna assente → default true per tutte).
export async function getShowTeacherMap(schoolIds: string[]): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {}
  const ids = [...new Set(schoolIds.filter(Boolean))]
  if (ids.length === 0) return map
  const db = createAdminClient()
  const { data, error } = await db
    .from('schools')
    .select('id, show_teacher_to_students')
    .in('id', ids)
  if (error) {
    for (const id of ids) map[id] = true
    return map
  }
  for (const r of data ?? []) map[r.id] = (r as { show_teacher_to_students?: boolean }).show_teacher_to_students ?? true
  for (const id of ids) if (!(id in map)) map[id] = true
  return map
}
