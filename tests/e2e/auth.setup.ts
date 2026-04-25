import { test as setup, expect } from '@playwright/test'
import path from 'path'

const roles = [
  {
    name: 'hq',
    email: process.env.TEST_HQ_EMAIL ?? '',
    password: process.env.TEST_HQ_PASSWORD ?? '',
    file: path.join(__dirname, '../.auth/hq.json'),
    expectedPath: '/hq/dashboard',
  },
  {
    name: 'school',
    email: process.env.TEST_SCHOOL_EMAIL ?? '',
    password: process.env.TEST_SCHOOL_PASSWORD ?? '',
    file: path.join(__dirname, '../.auth/school.json'),
    expectedPath: '/school/dashboard',
  },
  {
    name: 'teacher',
    email: process.env.TEST_TEACHER_EMAIL ?? '',
    password: process.env.TEST_TEACHER_PASSWORD ?? '',
    file: path.join(__dirname, '../.auth/teacher.json'),
    expectedPath: '/teacher/dashboard',
  },
  {
    name: 'student',
    email: process.env.TEST_STUDENT_EMAIL ?? '',
    password: process.env.TEST_STUDENT_PASSWORD ?? '',
    file: path.join(__dirname, '../.auth/student.json'),
    expectedPath: '/student/dashboard',
  },
]

for (const role of roles) {
  setup(`authenticate as ${role.name}`, async ({ page }) => {
    await page.goto('/en/login')

    await page.getByLabel(/email/i).fill(role.email)
    await page.getByLabel(/password/i).fill(role.password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await page.waitForURL(`**${role.expectedPath}`, { timeout: 15000 })
    await expect(page).toHaveURL(new RegExp(role.expectedPath))

    await page.context().storageState({ path: role.file })
  })
}
