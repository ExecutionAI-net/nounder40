/**
 * Journey 15 — HQ transactions aggregation
 *
 * HQ sees a consolidated view of all schools' transactions. When a school
 * admin grants a paid manual package to a student, the resulting transaction
 * should surface in /api/hq/transactions.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'
import { createPackage, linkStudentToSchool } from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  studentRowId: string
  schoolId: string
  packageId: string
}

const HQ_AUTH = path.join(__dirname, '../../.auth/hq.json')
const SCHOOL_AUTH = path.join(__dirname, '../../.auth/school.json')

async function seed(): Promise<Ctx> {
  const { data: studentProfile } = await adminDb
    .from('profiles').select('id').eq('email', 'support+student@alinaquintana.com').single()
  if (!studentProfile) throw new Error('student profile missing')

  const { data: studentRow } = await adminDb
    .from('students').select('id').eq('user_id', studentProfile.id).single()
  if (!studentRow) throw new Error('students row missing')

  const { data: school } = await adminDb
    .from('schools').select('id').eq('slug', 'test-school').single()
  if (!school) throw new Error('test school missing')

  await linkStudentToSchool(studentProfile.id, school.id, true)
  const pkg = await createPackage(school.id, { credits: 10, price: 80 })

  return {
    studentUserId: studentProfile.id,
    studentRowId: studentRow.id,
    schoolId: school.id,
    packageId: pkg.id,
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  if (ctx.studentUserId && ctx.schoolId) {
    await adminDb.from('manual_credit_grants').delete().eq('student_id', ctx.studentUserId)
    await adminDb.from('student_packages').delete().eq('student_id', ctx.studentUserId).eq('school_id', ctx.schoolId)
  }
  if (ctx.studentRowId && ctx.schoolId) {
    await adminDb.from('transactions').delete().eq('student_id', ctx.studentRowId).eq('school_id', ctx.schoolId).like('product_name', '%Manual credit grant%')
  }
  if (ctx.packageId) await adminDb.from('packages').delete().eq('id', ctx.packageId)
}

test.describe('Journey — HQ transactions visibility', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('HQ GET /api/hq/transactions includes a school-created manual-cash transaction', async () => {
    // Step 1 — school admin grants a paid package (creates a transaction)
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const grantRes = await school.post('/api/school/credits/grant', {
      data: {
        student_id: ctx.studentUserId,
        amount: 10,
        reason: 'gift',
        package_catalog_id: ctx.packageId,
        price: 80,
        payment_method: 'cash',
      },
    })
    expect(grantRes.ok()).toBe(true)
    await school.dispose()

    // Direct DB check: transaction exists with the correct student reference
    const { data: ownTx } = await adminDb
      .from('transactions')
      .select('amount, platform_fee, school_amount, student_id, school_id, type, payment_method')
      .eq('student_id', ctx.studentRowId)
      .eq('school_id', ctx.schoolId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    expect(ownTx?.amount).toBe(80)
    expect(ownTx?.platform_fee).toBe(8)        // 10% of 80
    expect(ownTx?.school_amount).toBe(72)      // 80 - 8
    expect(ownTx?.payment_method).toBe('cash')

    // Step 2 — HQ sees the transaction in the consolidated view
    const hq = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: HQ_AUTH,
    })
    const hqRes = await hq.get('/api/hq/transactions')
    expect(hqRes.ok()).toBe(true)
    const txs = await hqRes.json()
    expect(Array.isArray(txs)).toBe(true)

    // GET returns schools as a joined object — not a bare school_id column
    type HqTx = {
      amount: number
      payment_method: string
      schools?: { id: string } | null
    }
    const found = txs.find((t: HqTx) =>
      Number(t.amount) === 80 &&
      t.schools?.id === ctx.schoolId &&
      t.payment_method === 'cash'
    )
    expect(found).toBeTruthy()

    await hq.dispose()
  })

  test('non-HQ user cannot read the consolidated transactions list (401/403)', async () => {
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.get('/api/hq/transactions')
    expect([401, 403]).toContain(res.status())
    await school.dispose()
  })
})
