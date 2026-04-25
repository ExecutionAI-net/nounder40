/**
 * Journey 13 — HQ platform-wide packages catalog
 *
 * HQ can create packages with school_id=null that any school inherits as a
 * template. This journey exercises the HQ side CRUD and validation.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'

type Ctx = { createdIds: string[] }

const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')
const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function cleanup(ctx: Ctx) {
  if (ctx.createdIds.length > 0) {
    await adminDb.from('packages').delete().in('id', ctx.createdIds)
  }
}

test.describe('Journey — HQ packages catalog', () => {
  const ctx: Ctx = { createdIds: [] }

  test.afterEach(async () => {
    await cleanup(ctx)
    ctx.createdIds = []
  })

  test('HQ creates a platform-wide package, lists it, then updates it', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })

    const uniq = Date.now().toString(36)
    const nameEn = `e2e-hq-pkg-${uniq}`

    // Create
    const createRes = await hq.post('/api/hq/packages', {
      data: {
        name_en: nameEn,
        name_it: `e2e-hq-pkg-it-${uniq}`,
        description_en: 'platform-wide starter pack',
        credits: 10,
        validity_days: 90,
        price: 50,
        color: '#6B1F3A',
        is_popular: false,
      },
    })
    expect(createRes.ok()).toBe(true)
    const created = await createRes.json()
    expect(created.id).toBeTruthy()
    expect(created.name_en).toBe(nameEn)
    expect(created.school_id).toBeNull()      // platform-wide
    expect(Number(created.credits)).toBe(10)
    expect(Number(created.price)).toBe(50)
    ctx.createdIds.push(created.id)

    // Listed
    const listRes = await hq.get('/api/hq/packages')
    expect(listRes.ok()).toBe(true)
    const list: Array<{ id: string; school_id: string | null }> = await listRes.json()
    const found = list.find(p => p.id === created.id)
    expect(found).toBeTruthy()
    expect(found?.school_id).toBeNull()

    // Update
    const patchRes = await hq.patch(`/api/hq/packages/${created.id}`, {
      data: { price: 75, is_popular: true },
    })
    expect(patchRes.ok()).toBe(true)

    const { data: updated } = await adminDb
      .from('packages').select('price, is_popular').eq('id', created.id).single()
    expect(Number(updated?.price)).toBe(75)
    expect(updated?.is_popular).toBe(true)

    await hq.dispose()
  })

  test('non-HQ user cannot create a platform package (403)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.post('/api/hq/packages', {
      data: {
        name_en: `e2e-forbid-${Date.now().toString(36)}`,
        credits: 5,
        validity_days: 30,
        price: 20,
      },
    })
    expect([401, 403]).toContain(res.status())
    await school.dispose()
  })

  test('validation: missing name_en/credits/validity_days/price → 400', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    for (const payload of [
      { credits: 5, validity_days: 30, price: 10 },             // no name
      { name_en: 'x', validity_days: 30, price: 10 },            // no credits
      { name_en: 'x', credits: 5, price: 10 },                   // no validity
      { name_en: 'x', credits: 5, validity_days: 30 },           // no price
    ]) {
      const res = await hq.post('/api/hq/packages', { data: payload })
      expect(res.status()).toBe(400)
    }
    await hq.dispose()
  })

  test('HQ can DELETE a platform package', async () => {
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const createRes = await hq.post('/api/hq/packages', {
      data: {
        name_en: `e2e-del-${Date.now().toString(36)}`,
        credits: 5,
        validity_days: 30,
        price: 20,
      },
    })
    const created = await createRes.json()
    ctx.createdIds.push(created.id)

    const delRes = await hq.delete(`/api/hq/packages/${created.id}`)
    expect(delRes.ok()).toBe(true)

    const { data: gone } = await adminDb
      .from('packages').select('id, active').eq('id', created.id).maybeSingle()
    expect(gone === null || gone?.active === false).toBe(true)

    // Remove from cleanup list since already deleted
    ctx.createdIds = ctx.createdIds.filter(i => i !== created.id)

    await hq.dispose()
  })
})
