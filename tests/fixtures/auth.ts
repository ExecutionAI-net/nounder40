import { test as base, Page } from '@playwright/test'
import path from 'path'

export type Role = 'hq' | 'school' | 'teacher' | 'student'

const AUTH_DIR = path.join(__dirname, '../.auth')

export function authFile(role: Role) {
  return path.join(AUTH_DIR, `${role}.json`)
}

/** Use inside a test file to pin the browser session to a specific role. */
export function withRole(role: Role) {
  return base.extend<{ role: Role }>({
    storageState: authFile(role),
    role: [async ({}, use) => use(role), { option: true }],
  })
}

/** Navigate to the role's dashboard and wait for it to load. */
export async function goToDashboard(page: Page, role: Role) {
  const paths: Record<Role, string> = {
    hq: '/en/hq/dashboard',
    school: '/en/school/dashboard',
    teacher: '/en/teacher/dashboard',
    student: '/en/student/dashboard',
  }
  await page.goto(paths[role])
  await page.waitForLoadState('networkidle')
}
