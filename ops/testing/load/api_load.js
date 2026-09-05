// k6 load test — realistic student journey against the local stack.
//
//   docker run --rm --add-host=host.docker.internal:host-gateway \
//     -v "$PWD/ops/testing:/t" -e BASE=http://host.docker.internal:8080 \
//     grafana/k6 run /t/load/api_load.js
//
// Scenarios run together: a browse-heavy anonymous crowd, a logged-in student
// journey, and a school-admin dashboard load (the heaviest reports).

import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Trend, Rate, Counter } from 'k6/metrics'
import { SharedArray } from 'k6/data'

const BASE = __ENV.BASE || 'http://host.docker.internal:8080'
const PW = __ENV.PW || 'LoadTest!2024'

const loginTime = new Trend('t_login', true)
const browseTime = new Trend('t_browse', true)
const dashTime = new Trend('t_school_dash', true)
const bookTime = new Trend('t_booking', true)
const errors = new Rate('business_errors')
const bookingOk = new Counter('bookings_created')
const bookingRejected = new Counter('bookings_rejected')

const students = new SharedArray('students', () =>
  Array.from({ length: 30 }, (_, i) => `load${String(i + 1).padStart(3, '0')}@example.test`)
)

export const options = {
  scenarios: {
    anon_browse: {
      executor: 'ramping-vus',
      exec: 'anonBrowse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '1m', target: 60 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'anon' },
    },
    student_journey: {
      executor: 'ramping-vus',
      exec: 'studentJourney',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 15 },
        { duration: '1m', target: 30 },
        { duration: '30s', target: 0 },
      ],
      tags: { scenario: 'student' },
    },
    school_dashboard: {
      executor: 'constant-vus',
      exec: 'schoolDashboard',
      vus: 5,
      duration: '2m',
      tags: { scenario: 'school' },
    },
  },
  thresholds: {
    // Deliberately strict so the report says something, not just "it survived".
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{scenario:anon}': ['p(95)<800'],
    'http_req_duration{scenario:student}': ['p(95)<1500'],
    'http_req_duration{scenario:school}': ['p(95)<2500'],
    't_login': ['p(95)<1000'],
    't_school_dash': ['p(95)<2500'],
    'business_errors': ['rate<0.02'],
  },
}

function login(email) {
  const t0 = Date.now()
  const r = http.post(`${BASE}/api/auth/login/`,
    JSON.stringify({ email, password: PW }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /auth/login' } })
  loginTime.add(Date.now() - t0)
  const ok = check(r, { 'login 200': (x) => x.status === 200 })
  errors.add(!ok)
  if (!ok) return null
  return r.json('access')
}

function auth(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}

// ---- anonymous catalogue browsing (the public marketing surface) ----------
export function anonBrowse() {
  group('anon browse', () => {
    const t0 = Date.now()
    const r = http.batch([
      ['GET', `${BASE}/api/schools/public/`, null, { tags: { name: 'GET /schools/public' } }],
      ['GET', `${BASE}/api/student/lessons/`, null, { tags: { name: 'GET /student/lessons' } }],
      ['GET', `${BASE}/api/platform-stats/`, null, { tags: { name: 'GET /platform-stats' } }],
      ['GET', `${BASE}/api/translations/`, null, { tags: { name: 'GET /translations' } }],
    ])
    browseTime.add(Date.now() - t0)
    const ok = check(r[0], { 'schools 200': (x) => x.status === 200 }) &&
      check(r[1], { 'lessons 200': (x) => x.status === 200 })
    errors.add(!ok)
  })
  sleep(Math.random() * 2 + 1)
}

// ---- logged-in student: browse -> credits -> bookings -> book ------------
export function studentJourney() {
  const email = students[Math.floor(Math.random() * students.length)]
  const token = login(email)
  if (!token) return

  group('student dashboard', () => {
    const r = http.batch([
      ['GET', `${BASE}/api/auth/me/`, null, { ...auth(token), tags: { name: 'GET /auth/me' } }],
      ['GET', `${BASE}/api/student/credits/`, null, { ...auth(token), tags: { name: 'GET /student/credits' } }],
      ['GET', `${BASE}/api/student/bookings/`, null, { ...auth(token), tags: { name: 'GET /student/bookings' } }],
      ['GET', `${BASE}/api/student/packages/`, null, { ...auth(token), tags: { name: 'GET /student/packages' } }],
      ['GET', `${BASE}/api/student/lessons/`, null, { ...auth(token), tags: { name: 'GET /student/lessons (auth)' } }],
    ])
    const ok = r.every((x) => x.status === 200)
    check(r[1], { 'credits 200': (x) => x.status === 200 })
    errors.add(!ok)

    // Contention on purpose: many VUs racing for seats on the same lessons is
    // where credit double-spend or capacity overbooking would show up.
    const lessons = r[4].status === 200 ? r[4].json() : []
    if (lessons && lessons.length) {
      const lesson = lessons[Math.floor(Math.random() * Math.min(lessons.length, 5))]
      const t0 = Date.now()
      const b = http.post(`${BASE}/api/bookings/`,
        JSON.stringify({ lesson: lesson.id }),
        { ...auth(token), tags: { name: 'POST /bookings' } })
      bookTime.add(Date.now() - t0)
      if (b.status === 201 || b.status === 200) bookingOk.add(1)
      else bookingRejected.add(1)
      // 4xx here is legitimate business logic (already booked, no credits,
      // notice window) — only 5xx counts as a failure.
      check(b, { 'booking not 5xx': (x) => x.status < 500 })
      errors.add(b.status >= 500)
    }
  })
  sleep(Math.random() * 3 + 2)
}

// ---- school admin: the heavy aggregate pages -----------------------------
export function schoolDashboard() {
  const token = login('owner.a@example.test')
  if (!token) return

  group('school dashboard', () => {
    const t0 = Date.now()
    const r = http.batch([
      ['GET', `${BASE}/api/school/reports/`, null, { ...auth(token), tags: { name: 'GET /school/reports' } }],
      ['GET', `${BASE}/api/school/students/`, null, { ...auth(token), tags: { name: 'GET /school/students' } }],
      ['GET', `${BASE}/api/school/lessons/`, null, { ...auth(token), tags: { name: 'GET /school/lessons' } }],
      ['GET', `${BASE}/api/school/courses/`, null, { ...auth(token), tags: { name: 'GET /school/courses' } }],
      ['GET', `${BASE}/api/school/transactions/`, null, { ...auth(token), tags: { name: 'GET /school/transactions' } }],
      ['GET', `${BASE}/api/school/compensation-summary/`, null, { ...auth(token), tags: { name: 'GET /school/compensation-summary' } }],
    ])
    dashTime.add(Date.now() - t0)
    const ok = r.every((x) => x.status === 200)
    errors.add(!ok)
    check(r[0], { 'reports 200': (x) => x.status === 200 })
  })
  sleep(1)
}
