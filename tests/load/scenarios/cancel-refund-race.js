/**
 * k6 scenario: Cancel-and-refund race.
 *
 * Pre-seed step (handled by the runner): each VU's student is already
 * booked into the test lesson, well before the cancellation policy
 * threshold so the cancel will trigger a refund.
 *
 * Then all VUs DELETE /api/bookings/:id at the same instant. Each cancel
 * must:
 *   - return 2xx exactly once (not double-refunded on retries)
 *   - refund the student's credit exactly once
 *   - decrement lessons.current_bookings exactly once
 *
 * The runner verifies post-conditions after the run by reading
 * student_packages.credits_remaining and lessons.current_bookings.
 *
 * Required env:
 *   LOAD_BOOKING_IDS  — JSON array of booking IDs, one per VU
 *
 * Run via the helper script `tests/load/run-cancel-race.mjs` which
 * does the booking pre-seed, then invokes k6 with the right env.
 */

import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'
import { loginStudent } from '../lib/auth.js'
import { BASE_URL, LOAD_STUDENT_COUNT } from '../lib/config.js'

const BOOKING_IDS = JSON.parse(__ENV.LOAD_BOOKING_IDS ?? '[]')

export const options = {
  scenarios: {
    cancel_stampede: {
      executor: 'per-vu-iterations',
      vus: BOOKING_IDS.length || LOAD_STUDENT_COUNT,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'cancel_5xx': ['count==0'],
    'cancel_double_success': ['count==0'],
  },
}

const cancelSuccess = new Counter('cancel_success')
const cancelClientError = new Counter('cancel_client_error')
const cancel5xx = new Counter('cancel_5xx')
const cancelDoubleSuccess = new Counter('cancel_double_success')

export default function () {
  if (BOOKING_IDS.length === 0) throw new Error('LOAD_BOOKING_IDS env required')

  const idx = (__VU - 1) % BOOKING_IDS.length
  const bookingId = BOOKING_IDS[idx]
  const session = loginStudent(idx)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  }

  // First request — the legit cancel.
  const r1 = http.del(`${BASE_URL}/api/bookings/${bookingId}`, null, {
    headers,
    tags: { name: 'booking_cancel_initial' },
  })

  // Second request — fire immediately. This must NOT succeed; the
  // booking is already 'cancelled'. If we see two 2xx responses for the
  // same booking, that is a refund-double-spend bug.
  const r2 = http.del(`${BASE_URL}/api/bookings/${bookingId}`, null, {
    headers,
    tags: { name: 'booking_cancel_replay' },
  })

  check(r1, { 'first cancel <500': (r) => r.status < 500 })
  check(r2, { 'replay cancel rejected': (r) => r.status >= 400 && r.status < 500 })

  for (const r of [r1, r2]) {
    if (r.status >= 500) cancel5xx.add(1)
    else if (r.status >= 200 && r.status < 300) cancelSuccess.add(1)
    else cancelClientError.add(1)
  }

  // Both succeeded → double refund happened.
  if (r1.status < 300 && r2.status < 300) cancelDoubleSuccess.add(1)
}

export function handleSummary(data) {
  const ok = data.metrics.cancel_success?.values?.count ?? 0
  const reject = data.metrics.cancel_client_error?.values?.count ?? 0
  const fivexx = data.metrics.cancel_5xx?.values?.count ?? 0
  const dbl = data.metrics.cancel_double_success?.values?.count ?? 0

  console.log('\n=== CANCEL-REFUND RACE RESULT ===')
  console.log(`  successful cancels (2xx)   : ${ok} (target: 1 per VU)`)
  console.log(`  rejected replays (4xx)     : ${reject} (target: 1 per VU)`)
  console.log(`  5xx errors                 : ${fivexx} (must be 0)`)
  console.log(`  double-refunds detected    : ${dbl} (must be 0)`)
  console.log('==================================\n')

  return { stdout: '' }
}
