import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALL_PERMISSIONS, type Permission } from '@/lib/hq-permissions'

export const dynamic = 'force-dynamic'

function slugify(text: string) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
}

async function requireManager() {
  const auth = await requireRole('hq')
  if (!auth) return null
  const { data } = await auth.supabase.from('profiles').select('hq_sub_role').eq('id', auth.user.id).single()
  const subRole = data?.hq_sub_role
  if (subRole !== 'owner' && subRole !== 'super_admin') return null
  return { ...auth, subRole }
}

// Any HQ member: full matrix + own sub-role (drives the read-only vs editable UI)
export async function GET() {
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const [{ data: roles, error }, { data: me }] = await Promise.all([
    admin.from('hq_roles').select('key, label, builtin, permissions').order('builtin', { ascending: false }).order('created_at'),
    admin.from('profiles').select('hq_sub_role').eq('id', auth.user.id).single(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    roles: roles ?? [],
    allPermissions: ALL_PERMISSIONS,
    callerSubRole: me?.hq_sub_role ?? null,
  })
}

// Update one role's permission set
export async function PUT(request: Request) {
  const auth = await requireManager()
  if (!auth) return NextResponse.json({ error: 'Forbidden: Owner or Super Admin only' }, { status: 403 })

  const { key, permissions } = await request.json() as { key: string; permissions: string[] }
  if (!key || !Array.isArray(permissions)) {
    return NextResponse.json({ error: 'key and permissions[] are required' }, { status: 400 })
  }
  if (key === 'owner') {
    return NextResponse.json({ error: 'owner_not_editable' }, { status: 403 })
  }

  const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p as Permission))
  if (invalid.length) {
    return NextResponse.json({ error: `Unknown permissions: ${invalid.join(', ')}` }, { status: 400 })
  }

  // Anti-lockout: when editing your own role, team + permissions stay on
  let next = [...new Set(permissions)]
  if (key === auth.subRole) {
    next = [...new Set([...next, 'team', 'permissions'])]
  }

  const admin = createAdminClient()
  const { error } = await admin.from('hq_roles').update({ permissions: next }).eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, permissions: next })
}

// Create a custom profile
export async function POST(request: Request) {
  const auth = await requireManager()
  if (!auth) return NextResponse.json({ error: 'Forbidden: Owner or Super Admin only' }, { status: 403 })

  const { label, permissions } = await request.json() as { label: string; permissions?: string[] }
  if (!label?.trim()) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  const key = slugify(label)
  if (!key) return NextResponse.json({ error: 'label must contain letters or numbers' }, { status: 400 })

  const perms = (permissions ?? ['dashboard']).filter(p => ALL_PERMISSIONS.includes(p as Permission))

  const admin = createAdminClient()
  const { data, error } = await admin.from('hq_roles')
    .insert({ key, label: label.trim(), builtin: false, permissions: perms })
    .select()
    .single()
  if (error) {
    const status = error.code === '23505' ? 409 : 500
    return NextResponse.json({ error: error.code === '23505' ? 'role_exists' : error.message }, { status })
  }

  return NextResponse.json(data)
}

// Delete a custom profile (never builtin, never one still in use)
export async function DELETE(request: Request) {
  const auth = await requireManager()
  if (!auth) return NextResponse.json({ error: 'Forbidden: Owner or Super Admin only' }, { status: 403 })

  const { key } = await request.json() as { key: string }
  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: role } = await admin.from('hq_roles').select('builtin').eq('key', key).single()
  if (!role) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (role.builtin) return NextResponse.json({ error: 'builtin_not_deletable' }, { status: 403 })

  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('hq_sub_role', key)
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'role_in_use', count }, { status: 409 })
  }

  const { error } = await admin.from('hq_roles').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
