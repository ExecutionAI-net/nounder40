import { createAdminClient } from '@/lib/supabase/admin'
import { HQ_PERMISSIONS, type HQSubRole, type Permission } from '@/lib/hq-permissions'

// Server-side lookup of an HQ sub-role's permissions from the hq_roles table
// (the editable matrix). Falls back to the static seed matrix if the row or
// table is missing, so a DB hiccup never locks HQ out of the panel.
export async function getPermissionsForSubRole(subRole: string | null | undefined): Promise<string[]> {
  if (!subRole) return []
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('hq_roles').select('permissions').eq('key', subRole).single()
    if (data?.permissions) return data.permissions
  } catch {
    // fall through to static fallback
  }
  return HQ_PERMISSIONS[subRole as HQSubRole] ?? []
}

export async function roleHasPermission(subRole: string | null | undefined, permission: Permission): Promise<boolean> {
  const perms = await getPermissionsForSubRole(subRole)
  return perms.includes(permission)
}
