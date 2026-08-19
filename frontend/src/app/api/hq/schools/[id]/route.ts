import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/api/guards'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Count records linked to a school. `blocking` ones prevent deletion
// (financial history must never be destroyed), `cascading` ones are
// deleted/detached automatically and are shown to the user before confirming.
async function linkedRecords(schoolId: string) {
  const admin = createAdminClient()
  const count = (table: string, col = 'school_id') =>
    admin.from(table).select('*', { count: 'exact', head: true }).eq(col, schoolId)

  const [students, teachers, courses, lessons, transactions, shopOrders] = await Promise.all([
    count('school_students'),
    count('teacher_schools'),
    count('courses'),
    count('lessons'),
    count('transactions'),
    count('shop_orders'),
  ])

  return {
    cascading: {
      students: students.count ?? 0,
      teachers: teachers.count ?? 0,
      courses: courses.count ?? 0,
      lessons: lessons.count ?? 0,
    },
    blocking: {
      transactions: transactions.count ?? 0,
      shopOrders: shopOrders.count ?? 0,
    },
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(await linkedRecords(id))
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()

  const { error } = await createAdminClient().from('schools').update(body).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireRole('hq')
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const linked = await linkedRecords(id)

  // Financial records must survive: block deletion, suggest deactivation
  if (linked.blocking.transactions > 0 || linked.blocking.shopOrders > 0) {
    return NextResponse.json({ error: 'has_financial_records', linked }, { status: 409 })
  }

  // Collect school-only login accounts before the row disappears
  // (multi-role users like HQ admins linked to the school are left untouched)
  const { data: schoolProfiles } = await admin
    .from('profiles')
    .select('id, role, roles')
    .eq('school_id', id)
    .eq('role', 'school')

  const { error } = await admin.from('schools').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Delete orphaned school login accounts (auth cascade removes their profile)
  for (const p of schoolProfiles ?? []) {
    const otherRoles = (p.roles ?? []).filter((r: string) => r !== 'school')
    if (otherRoles.length === 0) {
      await admin.auth.admin.deleteUser(p.id)
    }
  }

  return NextResponse.json({ ok: true, linked })
}
