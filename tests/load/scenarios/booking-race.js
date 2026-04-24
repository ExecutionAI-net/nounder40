/**
 * k6 scenario: Booking race.
 *
 * N students all attempt to book the SAME lesson at (roughly) the same
 * instant. Only LOAD_LESSON_CAPACITY should succeed. The rest must get a
 * clean 4xx (not 5xx, not double-booked, not credit-double-deducted).
 *
 * This is the regression test for the current_bookings RLS / capacity
 * race that we fixed earlier this quarter.
 *
 * Run:
 *   k6 run \
 *     -e LOAD_LESSON_ID=<uuid> \
 *     -e LOAD_LESSON_CAPACITY=5 \
 *     -e LOAD_STUDENT_COUNT=20 \
 *     tests/load/scenarios/booking-race.js
 */

import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'
import { loginStudent } from '../lib/auth.js'
import { BASE_URL, LOAD_LESSON_ID, LOAD_STUDENT_COUNT } from '../lib/config.js'

const CAPACITY = Number(__ENV.LOAD_LESSON_CAPACITY ?? 5)

export const options = {
  scenarios: {
    stampede: {
      executor: 'per-vu-iterations',
      vus: LOAD_STUDENT_COUNT,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'booking_success': [`count<=${CAPACITY}`],
    'booking_overflow_5xx': ['count==0'],
  },
}

const bookingSuccess = new Counter('booking_success')
const bookingRejected = new Counter('booking_rejected')
const bookingOverflow5xx = new Counter('booking_overflow_5xx')

export default function () {
  if (!LOAD_LESSON_ID) throw new Error('LOAD_LESSON_ID is required')

  const i = (__VU - 1) % LOAD_STUDENT_COUNT
  const session = loginStudent(i)

  const res = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify({ lesson_id: LOAD_LESSON_ID }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      tags: { name: 'booking_create' },
    },
  )

  check(res, {
    'no 5xx': (r) => r.status < 500,
    'response not empty': (r) => !!r.body,
  })

  if (res.status >= 500) {
    bookingOverflow5xx.add(1)
  } else if (res.status >= 200 && res.status < 300) {
    bookingSuccess.add(1)
  } else {
    bookingRejected.add(1)
  }
}

export function handleSummary(data) {
  const successCount = data.metrics.booking_success?.values?.count ?? 0
  const rejectCount = data.metrics.booking_rejected?.values?.count ?? 0
  const overflow = data.metrics.booking_overflow_5xx?.values?.count ?? 0

  console.log('\n=== BOOKING RACE RESULT ===')
  console.log(`  capacity      : ${CAPACITY}`)
  console.log(`  successes (2xx): ${successCount} (must equal capacity)`)
  console.log(`  rejected (4xx) : ${rejectCount}`)
  console.log(`  5xx errors     : ${overflow} (must be zero)`)
  console.log('============================\n')

  return { stdout: '' }
}
