/**
 * Journey 12 — HQ lesson type catalog
 *
 * HQ owns the platform-wide lesson type taxonomy. Schools reuse these types
 * when creating courses (via GET /api/school/lesson-types or equivalent).
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

type Ctx = { createdIds: string[] }

const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')
const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function cleanup(ctx: Ctx) {
  if (ctx.createdIds.length > 0) {
    await adminDb.from('lesson_types').delete().in('id', ctx.createdIds)
  }
}

test.describe('Journey — HQ lesson type catalog', () => {
  const ctx: Ctx = { createdIds: [] }

  test.afterEach(async () => {
    await cleanup(ctx)
    ctx.createdIds = []
  })

  test('HQ creates a lesson type, updates it, then soft-deletes', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })

    const uniq = Date.now().toString(36).toUpperCase()
    const code = `E2E-${uniq}`

    // 1. Create — level must be one of entry | intermediate | advanced | all
    const createRes = await hq.post('/api/hq/lesson-types', {
      data: {
        code,
        level: 'entry',
        name_en: `e2e-type-${uniq}`,
        name_it: `e2e-tipo-${uniq}`,
        name_fr: '',
        name_es: '',
        description_it: '',
        description_en: '',
      },
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created.id).toBeTruthy()
    expect(created.code).toBe(code)
    expect(created.name_en).toBe(`e2e-type-${uniq}`)
    ctx.createdIds.push(created.id)

    // 2. Listed in HQ catalog
    const listRes = await hq.get('/api/hq/lesson-types')
    expect(listRes.ok()).toBe(true)
    const list: Array<{ id: string; active: boolean }> = await listRes.json()
    const found = list.find(t => t.id === created.id)
    expect(found).toBeTruthy()
    expect(found?.active).toBe(true)

    // 3. Update name
    const patchRes = await hq.patch(`/api/hq/lesson-types/${created.id}`, {
      data: { name_en: `e2e-type-${uniq}-updated` },
    })
    expect(patchRes.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('lesson_types').select('name_en').eq('id', created.id).single()
    expect(updated?.name_en).toBe(`e2e-type-${uniq}-updated`)

    // 4. Delete (soft — active=false)
    const delRes = await hq.delete(`/api/hq/lesson-types/${created.id}`)
    expect(delRes.ok()).toBe(true)

    const { data: afterDelete } = await adminDb
      .from('lesson_types').select('active').eq('id', created.id).single()
    // Deletion may be hard or soft; assert that the type is no longer usable
    // (either gone or active=false).
    expect(afterDelete === null || afterDelete?.active === false).toBe(true)

    await hq.dispose()
  })

  test('non-HQ user cannot create a lesson type (403)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/hq/lesson-types', {
      data: {
        code: `E2E-FORBID-${Date.now().toString(36)}`,
        level: 'all',
        name_en: 'e2e-forbidden',
        name_it: 'e2e-forbidden',
      },
    })
    expect([401, 403]).toContain(res.status())
    await school.dispose()
  })

  test('validation: missing code or name_en returns 400', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const res = await hq.post('/api/hq/lesson-types', {
      data: { code: '', name_en: '' },
    })
    expect(res.status()).toBe(400)
    await hq.dispose()
  })

  test('school admin GETs the catalog (shared read access)', async () => {
    // Seed a type via admin so cleanup still runs
    const { data: lt } = await adminDb.from('lesson_types').insert({
      code: `E2E-READ-${Date.now().toString(36).toUpperCase()}`,
      level: 'all',
      name_en: `e2e-readable`,
      name_it: 'e2e',
      active: true,
    }).select('id').single()
    if (!lt) throw new Error('seed lesson_type failed')
    ctx.createdIds.push(lt.id)

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.get('/api/hq/lesson-types')
    expect(res.ok()).toBe(true)
    const list: Array<{ id: string }> = await res.json()
    expect(list.find(t => t.id === lt.id)).toBeTruthy()
    await school.dispose()
  })
})
