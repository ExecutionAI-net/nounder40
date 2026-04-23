/**
 * Cross-role end-to-end journey:
 *   School creates course → Student books lesson → Teacher marks attendance
 *
 * These tests use browser contexts per role (no shared storageState at project level).
 */

import { test, expect, chromium } from '@playwright/test'
import path from 'path'

const authFile = (role: string) => path.join(__dirname, `../../.auth/${role}.json`)

test.describe('Journey — booking flow', () => {
  test.skip('placeholder: full booking journey', async () => {
    // TODO: implement when School + Student suites are complete
    // 1. School admin creates e2e course via UI
    // 2. Student books the lesson via /book
    // 3. Teacher marks attendance
    // 4. Verify credit deducted
  })
})
