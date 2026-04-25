import { defineConfig, devices } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    // Posts a summary to Slack when SLACK_WEBHOOK_URL is set; silent otherwise.
    ['./tests/reporters/slack-reporter.ts'],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 60000,
    // Set SLOW_MO=800 (or any ms) to watch actions slowly with --headed
    launchOptions: {
      slowMo: process.env.SLOW_MO ? Number(process.env.SLOW_MO) : 0,
    },
  },

  timeout: 60000,

  projects: [
    // ── Setup: saves 4 session files ──────────────────────────────────
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    // ── Auth suite ────────────────────────────────────────────────────
    {
      name: 'auth',
      testMatch: /e2e\/auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    // ── HQ suite ──────────────────────────────────────────────────────
    {
      name: 'hq',
      testMatch: /e2e\/hq\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/hq.json',
      },
      dependencies: ['setup'],
    },

    // ── School suite ──────────────────────────────────────────────────
    {
      name: 'school',
      testMatch: /e2e\/school\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/school.json',
      },
      dependencies: ['setup'],
    },

    // ── Teacher suite ─────────────────────────────────────────────────
    {
      name: 'teacher',
      testMatch: /e2e\/teacher\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/teacher.json',
      },
      dependencies: ['setup'],
    },

    // ── Student suite ─────────────────────────────────────────────────
    {
      name: 'student',
      testMatch: /e2e\/student\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/student.json',
      },
      dependencies: ['setup'],
    },

    // ── End-to-end journeys (cross-role) ──────────────────────────────
    {
      name: 'journeys',
      testMatch: /e2e\/journeys\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    // ── Cross-cutting: mobile, a11y, perf ─────────────────────────────
    {
      name: 'cross-cutting',
      testMatch: /e2e\/cross-cutting\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: `${BASE_URL}/en/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
})
