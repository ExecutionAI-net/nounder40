/**
 * k6 scenario: Calendar peak read load.
 *
 * Models the "evening browsing" peak — many students hit the public
 * lesson + calendar endpoints concurrently (no booking, just reads).
 * This is the read-scaling regression test: query plans, RLS overhead,
 * Supabase connection pool, and response sizes.
 *
 * Endpoints exercised:
 *   GET /api/student/lessons     — student-scoped lesson list
 *   GET /api/calendar/[schoolId] — public school calendar
 *   GET /api/student/credits     — credit/subscription summary
 *
 * Required env (besides defaults):
 *   LOAD_SCHOOL_ID — public iCal/calendar fetch target
 *
 * Run:
 *   k6 run -e LOAD_SCHOOL_ID=<uuid> tests/load/scenarios/calendar-peak.js
 */

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Trend } from 'k6/metrics'
import { loginStudent } from '../lib/auth.js'
import { BASE_URL, LOAD_STUDENT_COUNT } from '../lib/config.js'

const SCHOOL_ID = __ENV.LOAD_SCHOOL_ID

export const options = {
  scenarios: {
    peak_read: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 50 },
        { duration: '20s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'lessons_latency': ['p(95)<1000'],
    'calendar_latency': ['p(95)<1500'],
    'credits_latency': ['p(95)<800'],
  },
}

const lessonsLatency = new Trend('lessons_latency', true)
const calendarLatency = new Trend('calendar_latency', true)
const creditsLatency = new Trend('credits_latency', true)

export default function () {
  const i = Math.floor(Math.random() * LOAD_STUDENT_COUNT)
  const session = loginStudent(i)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  }

  group('lesson list', () => {
    const r = http.get(`${BASE_URL}/api/student/lessons`, { headers, tags: { name: 'lessons_list' } })
    lessonsLatency.add(r.timings.duration)
    check(r, { 'lessons 200': (res) => res.status === 200 })
  })

  sleep(0.5 + Math.random())

  if (SCHOOL_ID) {
    group('calendar', () => {
      const r = http.get(`${BASE_URL}/api/calendar/${SCHOOL_ID}`, { headers, tags: { name: 'calendar' } })
      calendarLatency.add(r.timings.duration)
      check(r, { 'calendar <500': (res) => res.status < 500 })
    })

    sleep(0.5 + Math.random())
  }

  group('credits', () => {
    const r = http.get(`${BASE_URL}/api/student/credits`, { headers, tags: { name: 'credits' } })
    creditsLatency.add(r.timings.duration)
    check(r, { 'credits 200': (res) => res.status === 200 })
  })

  sleep(1 + Math.random() * 2)
}
