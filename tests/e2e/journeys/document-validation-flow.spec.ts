/**
 * Journey 8 — Student document upload + school validation
 *
 * Covers the document lifecycle:
 *   1. Student POSTs a document → student_documents row created, status='valid'
 *      but unvalidated (validated_by=null, validated_at=null)
 *   2. Re-uploading the same type for the same school updates the existing row
 *   3. School admin PATCHes with action='validate' → status='valid', with
 *      validated_by + validated_at + expires_at populated
 *   4. School admin PATCHes with action='reject' → status='expired'
 *   5. Bad action → 400
 *   6. GET /api/student/documents computes status from expires_at:
 *      - Expired (past date)
 *      - Expiring (within 30 days)
 *      - Valid (> 30 days out)
 *   7. Upload without enrollment in that school → 403
 *   8. Upload with an invalid type string → 400
 *
 * NOTE: The CLAUDE.md product spec says booking should be blocked when the
 * medical cert is expired, but the booking API currently does not check
 * student_documents. That feature is still pending; this journey only covers
 * the upload/validation lifecycle itself.
 */

import { test, expect, request as pwRequest } from '@playwright/test'
import path from 'node:path'
import { adminDb } from '../../helpers/db'
import { linkStudentToSchool } from '../../fixtures/factory'

type Ctx = {
  studentUserId: string
  studentRowId: string
  schoolId: string
  createdDocIds: string[]
}

const STUDENT_AUTH = path.join(__dirname, '../../.auth/student.json')
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

  // Clean any leftover test docs before starting
  await adminDb
    .from('student_documents')
    .delete()
    .eq('student_id', studentRow.id)
    .eq('school_id', school.id)

  return {
    studentUserId: studentProfile.id,
    studentRowId: studentRow.id,
    schoolId: school.id,
    createdDocIds: [],
  }
}

async function cleanup(ctx: Partial<Ctx>) {
  if (ctx.studentRowId && ctx.schoolId) {
    await adminDb
      .from('student_documents')
      .delete()
      .eq('student_id', ctx.studentRowId)
      .eq('school_id', ctx.schoolId)
  }
}

test.describe('Journey — Document upload + school validation', () => {
  let ctx: Ctx

  test.beforeEach(async () => {
    ctx = await seed()
  })

  test.afterEach(async () => {
    await cleanup(ctx)
  })

  test('student uploads medical_cert → row created with status=valid, unvalidated', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    const res = await student.post('/api/student/documents', {
      data: {
        school_id: ctx.schoolId,
        type: 'medical_cert',
        file_url: 'https://example.com/medical.pdf',
      },
    })
    expect(res.ok()).toBe(true)

    const { data: doc } = await adminDb
      .from('student_documents')
      .select('type, status, validated_by, validated_at, file_url, school_id')
      .eq('student_id', ctx.studentRowId)
      .eq('school_id', ctx.schoolId)
      .single()
    expect(doc?.type).toBe('medical_cert')
    expect(doc?.status).toBe('valid')          // initial status; not yet school-approved
    expect(doc?.validated_by).toBeNull()
    expect(doc?.validated_at).toBeNull()
    expect(doc?.file_url).toBe('https://example.com/medical.pdf')

    await student.dispose()
  })

  test('re-uploading same type replaces the existing row', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })

    // First upload
    await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'medical_cert', file_url: 'https://example.com/old.pdf' },
    })

    // Second upload — should UPDATE, not INSERT
    const res = await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'medical_cert', file_url: 'https://example.com/new.pdf' },
    })
    expect(res.ok()).toBe(true)

    const { data: docs } = await adminDb
      .from('student_documents')
      .select('id, file_url')
      .eq('student_id', ctx.studentRowId)
      .eq('school_id', ctx.schoolId)
      .eq('type', 'medical_cert')
    expect(docs?.length).toBe(1)
    expect(docs?.[0].file_url).toBe('https://example.com/new.pdf')

    await student.dispose()
  })

  test('upload with invalid type returns 400', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    const res = await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'bogus_type', file_url: 'https://example.com/x.pdf' },
    })
    expect(res.status()).toBe(400)
    await student.dispose()
  })

  test('upload without school enrollment returns 403', async () => {
    // Temporarily unlink student from school
    await adminDb
      .from('school_students')
      .delete()
      .eq('student_id', ctx.studentUserId)
      .eq('school_id', ctx.schoolId)

    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    const res = await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'medical_cert', file_url: 'https://example.com/x.pdf' },
    })
    expect(res.status()).toBe(403)

    // Restore the link for other tests
    await linkStudentToSchool(ctx.studentUserId, ctx.schoolId, true)
    await student.dispose()
  })

  test('school admin validates document → status=valid, validated_by + validated_at set', async () => {
    // Seed: student uploads first
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'medical_cert', file_url: 'https://example.com/a.pdf' },
    })
    await student.dispose()

    const { data: doc } = await adminDb
      .from('student_documents').select('id').eq('student_id', ctx.studentRowId).single()
    if (!doc) throw new Error('seed doc missing')

    // School admin validates with expiry 1 year out
    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const res = await school.patch(`/api/school/documents/${doc.id}`, {
      data: { action: 'validate', expires_at: expiresAt },
    })
    expect(res.ok()).toBe(true)

    const { data: validated } = await adminDb
      .from('student_documents')
      .select('status, validated_by, validated_at, expires_at')
      .eq('id', doc.id)
      .single()
    expect(validated?.status).toBe('valid')
    expect(validated?.validated_by).toBeTruthy()
    expect(validated?.validated_at).toBeTruthy()
    expect(validated?.expires_at).toBeTruthy()

    await school.dispose()
  })

  test('school admin rejects document → status=expired', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'privacy', file_url: 'https://example.com/p.pdf' },
    })
    await student.dispose()

    const { data: doc } = await adminDb
      .from('student_documents').select('id').eq('type', 'privacy').eq('student_id', ctx.studentRowId).single()

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.patch(`/api/school/documents/${doc!.id}`, {
      data: { action: 'reject' },
    })
    expect(res.ok()).toBe(true)

    const { data: rejected } = await adminDb
      .from('student_documents')
      .select('status, validated_by, validated_at')
      .eq('id', doc!.id)
      .single()
    expect(rejected?.status).toBe('expired')
    expect(rejected?.validated_by).toBeNull()

    await school.dispose()
  })

  test('invalid PATCH action returns 400', async () => {
    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    await student.post('/api/student/documents', {
      data: { school_id: ctx.schoolId, type: 'image_release', file_url: 'https://example.com/i.pdf' },
    })
    await student.dispose()

    const { data: doc } = await adminDb
      .from('student_documents').select('id').eq('type', 'image_release').eq('student_id', ctx.studentRowId).single()

    const school = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: SCHOOL_AUTH,
    })
    const res = await school.patch(`/api/school/documents/${doc!.id}`, {
      data: { action: 'nonsense' },
    })
    expect(res.status()).toBe(400)
    await school.dispose()
  })

  test('GET /api/student/documents computes status from expires_at', async () => {
    // Seed 3 docs with different expiry dates (directly to DB)
    const now = Date.now()
    const past = new Date(now - 5 * 86400000).toISOString()
    const soon = new Date(now + 10 * 86400000).toISOString()        // <30 days → expiring
    const farFuture = new Date(now + 100 * 86400000).toISOString()  // >30 days → valid

    await adminDb.from('student_documents').insert([
      { student_id: ctx.studentRowId, school_id: ctx.schoolId, type: 'medical_cert', file_url: 'x', status: 'valid', expires_at: past },
      { student_id: ctx.studentRowId, school_id: ctx.schoolId, type: 'privacy', file_url: 'x', status: 'valid', expires_at: soon },
      { student_id: ctx.studentRowId, school_id: ctx.schoolId, type: 'image_release', file_url: 'x', status: 'valid', expires_at: farFuture },
    ])

    const student = await pwRequest.newContext({
      baseURL: 'http://localhost:3000',
      storageState: STUDENT_AUTH,
    })
    const res = await student.get('/api/student/documents')
    expect(res.ok()).toBe(true)
    const docs: Array<{ type: string; status: string }> = await res.json()

    const byType = Object.fromEntries(docs.map(d => [d.type, d.status]))
    expect(byType.medical_cert).toBe('expired')
    expect(byType.privacy).toBe('expiring')
    expect(byType.image_release).toBe('valid')

    await student.dispose()
  })
})
