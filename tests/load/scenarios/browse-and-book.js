/**
 * k6 scenario: Browse-and-book journey.
 *
 * Realistic student session — log in, list available lessons, fetch the
 * detail of the test lesson, then book it. Models the typical "evening
 * browsing" pattern rather than a stampede.
 *
 * Run:
 *   k6 run -e LOAD_LESSON_ID=<uuid> tests/load/scenarios/browse-and-book.js
 */

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Trend } from 'k6/metrics'
import { loginStudent } from '../lib/auth.js'
import { BASE_URL, LOAD_LESSON_ID, LOAD_STUDENT_COUNT } from '../lib/config.js'

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '2m', target: 15 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'browse_lessons_latency': ['p(95)<800'],
    'lesson_detail_latency': ['p(95)<600'],
  },
}

const browseLatency = new Trend('browse_lessons_latency', true)
const detailLatency = new Trend('lesson_detail_latency', true)

export default function () {
  const i = Math.floor(Math.random() * LOAD_STUDENT_COUNT)
  const session = loginStudent(i)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  }

  group('browse lessons', () => {
    const r = http.get(`${BASE_URL}/api/student/lessons`, { headers, tags: { name: 'lessons_list' } })
    browseLatency.add(r.timings.duration)
    check(r, { 'lessons 200': (res) => res.status === 200 })
  })

  sleep(1 + Math.random() * 2)

  if (LOAD_LESSON_ID) {
    group('view lesson', () => {
      const r = http.get(`${BASE_URL}/api/student/lessons/${LOAD_LESSON_ID}`, {
        headers,
        tags: { name: 'lesson_detail' },
      })
      detailLatency.add(r.timings.duration)
      check(r, { 'detail ok': (res) => res.status === 200 || res.status === 404 })
    })

    sleep(1 + Math.random() * 2)

    group('book', () => {
      http.post(
        `${BASE_URL}/api/bookings`,
        JSON.stringify({ lesson_id: LOAD_LESSON_ID }),
        { headers, tags: { name: 'booking_create' } },
      )
    })
  }

  sleep(2 + Math.random() * 3)
}
