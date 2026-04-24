/**
 * k6 scenario: Attendance burst.
 *
 * Models the "end of evening" pattern where teachers across the network
 * submit attendance for full lessons in rapid succession. The endpoint
 * does a delete + bulk insert + booking status updates, so latency
 * scales with class size — we want to confirm it stays under budget at
 * 30 students × concurrent teachers.
 *
 * For local runs we simulate a single teacher resubmitting attendance
 * for the test lesson many times (POST is idempotent — it deletes
 * existing attendance rows before inserting). This is the worst-case
 * write pattern: a lesson with N booked students being marked over and
 * over.
 *
 * Required env:
 *   TEACHER_EMAIL, TEACHER_PASSWORD — credentials of a teacher who owns
 *                                      the lesson at LOAD_LESSON_ID
 *   LOAD_LESSON_ID                  — lesson with at least 1 booking
 *
 * Run:
 *   k6 run \
 *     -e TEACHER_EMAIL=... -e TEACHER_PASSWORD=... \
 *     -e LOAD_LESSON_ID=<uuid> \
 *     tests/load/scenarios/attendance-burst.js
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'
import { BASE_URL, SUPABASE_URL, ANON_KEY, LOAD_LESSON_ID } from '../lib/config.js'

const TEACHER_EMAIL = __ENV.TEACHER_EMAIL
const TEACHER_PASSWORD = __ENV.TEACHER_PASSWORD

export const options = {
  scenarios: {
    attendance_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 3 },
        { duration: '45s', target: 5 },
        { duration: '15s', target: 0 },
      ],
      gracefulStop: '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'attendance_get_latency': ['p(95)<1500'],
    'attendance_post_latency': ['p(95)<2500'],
  },
}

const getLatency = new Trend('attendance_get_latency', true)
const postLatency = new Trend('attendance_post_latency', true)

let cachedToken = null

function loginTeacher() {
  if (!TEACHER_EMAIL || !TEACHER_PASSWORD) throw new Error('TEACHER_EMAIL/PASSWORD required')
  if (cachedToken) return cachedToken

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD }),
    { headers: { 'Content-Type': 'application/json', apikey: ANON_KEY }, tags: { name: 'auth_teacher' } },
  )
  if (res.status !== 200) throw new Error(`teacher login failed: ${res.status} ${res.body}`)
  cachedToken = res.json('access_token')
  return cachedToken
}

export default function () {
  if (!LOAD_LESSON_ID) throw new Error('LOAD_LESSON_ID required')

  const token = loginTeacher()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  // 1. GET attendance — list bookings + statuses.
  const getRes = http.get(`${BASE_URL}/api/attendance/${LOAD_LESSON_ID}`, {
    headers,
    tags: { name: 'attendance_get' },
  })
  getLatency.add(getRes.timings.duration)
  check(getRes, { 'GET 200': (r) => r.status === 200 })

  if (getRes.status !== 200) {
    sleep(1)
    return
  }

  const body = getRes.json()
  const bookings = body.bookings ?? []
  const statuses = body.statuses ?? []
  const defaultStatus = statuses.find((s) => s.is_default) ?? statuses[0]

  if (bookings.length === 0 || !defaultStatus) {
    sleep(1)
    return
  }

  // 2. POST attendance — mark every booking with the default status.
  const records = bookings.map((b) => ({
    booking_id: b.id,
    student_id: b.student_id,
    status_id: defaultStatus.id,
  }))

  const postRes = http.post(
    `${BASE_URL}/api/attendance/${LOAD_LESSON_ID}`,
    JSON.stringify({ attendance: records }),
    { headers, tags: { name: 'attendance_post' } },
  )
  postLatency.add(postRes.timings.duration)
  check(postRes, {
    'POST 200': (r) => r.status === 200,
    'submitted true': (r) => {
      try { return r.json('submitted') === true } catch { return false }
    },
  })

  sleep(1 + Math.random() * 2)
}
