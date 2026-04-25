/**
 * Journey 11 — Attendance statuses CRUD
 *
 * School admin manages the per-school attendance status taxonomy used by the
 * teacher attendance form (Present, No-show, Medical, Late, etc.).
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

type Ctx = {
  schoolId: string
  createdIds: string[]
}

const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function seed(): Promise<Ctx> {
  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')
  return { schoolId: school.id, createdIds: [] }
}

async function cleanup(ctx: Ctx) {
  if (ctx.createdIds.length > 0) {
    await adminDb.from('attendance_statuses').delete().in('id', ctx.createdIds)
  }
  // Restore default flag if we touched it (best-effort)
}

test.describe('Journey — Attendance statuses CRUD', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('school admin creates, lists, updates, and deletes a status', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)
    const name = `e2e-status-${uniq}`

    // 1. Create
    const createRes = await school.post('/api/school/attendance-statuses', {
      data: {
        name,
        color: '#22C55E',
        burns_credit: true,
        is_default: false,
        sort_order: 10,
      },
    })
    expect(createRes.ok()).toBe(true)
    const createBody = await createRes.json()
    const created = createBody.status ?? createBody
    expect(created.id).toBeTruthy()
    expect(created.name).toBe(name)
    expect(created.burns_credit).toBe(true)
    ctx.createdIds.push(created.id)

    // 2. Listed — GET wraps rows in { statuses: [...] }
    const listRes = await school.get('/api/school/attendance-statuses')
    expect(listRes.ok()).toBe(true)
    const listBody = await listRes.json()
    const list: Array<{ id: string }> = listBody.statuses ?? listBody
    expect(list.find((s: { id: string }) => s.id === created.id)).toBeTruthy()

    // 3. Update
    const patchRes = await school.patch(`/api/school/attendance-statuses/${created.id}`, {
      data: { name: `${name}-renamed`, burns_credit: false },
    })
    expect(patchRes.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('attendance_statuses')
      .select('name, burns_credit')
      .eq('id', created.id)
      .single()
    expect(updated?.name).toBe(`${name}-renamed`)
    expect(updated?.burns_credit).toBe(false)

    // 4. Delete
    const delRes = await school.delete(`/api/school/attendance-statuses/${created.id}`)
    expect(delRes.ok()).toBe(true)
    ctx.createdIds = ctx.createdIds.filter(i => i !== created.id)

    const { data: gone } = await adminDb
      .from('attendance_statuses')
      .select('id')
      .eq('id', created.id)
      .maybeSingle()
    expect(gone).toBeNull()

    await school.dispose()
  })

  test('setting is_default=true unsets the previous default', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })

    const uniq = Date.now().toString(36)

    const first = await school.post('/api/school/attendance-statuses', {
      data: { name: `e2e-status-${uniq}-a`, color: '#22C55E', burns_credit: true, is_default: true, sort_order: 1 },
    })
    const firstBody = await first.json()
    const firstRow = firstBody.status ?? firstBody
    ctx.createdIds.push(firstRow.id)

    const second = await school.post('/api/school/attendance-statuses', {
      data: { name: `e2e-status-${uniq}-b`, color: '#EF4444', burns_credit: false, is_default: true, sort_order: 2 },
    })
    const secondBody = await second.json()
    const secondRow = secondBody.status ?? secondBody
    ctx.createdIds.push(secondRow.id)

    // Only the second one should still be default
    const { data: a } = await adminDb
      .from('attendance_statuses').select('is_default').eq('id', firstRow.id).single()
    expect(a?.is_default).toBe(false)

    const { data: b } = await adminDb
      .from('attendance_statuses').select('is_default').eq('id', secondRow.id).single()
    expect(b?.is_default).toBe(true)

    await school.dispose()
  })

  test('non-school user cannot list attendance statuses (401)', async () => {
    const guest = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: { cookies: [], origins: [] },
    })
    const res = await guest.get('/api/school/attendance-statuses')
    expect([401, 403]).toContain(res.status())
    await guest.dispose()
  })
})
