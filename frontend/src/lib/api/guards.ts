import { createClient } from '@/lib/supabase/server'

type Profile = {
  role: string
  roles: string[] | null
  school_id: string | null
}

// Returns the authenticated user + profile if they have the given role
// (single-role column or multi-role array), otherwise null.
// Usage in API routes:
//   const auth = await requireRole('hq')
//   if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
export async function requireRole(role: 'hq' | 'school' | 'teacher' | 'student') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, roles, school_id')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile) return null
  const hasRole = profile.role === role || profile.roles?.includes(role)
  if (!hasRole) return null

  return { user, profile, supabase }
}
