// Per-endpoint latency over the wire, at low concurrency.
//
// Complements load/query_profile.py: that one counts SQL queries in-process via
// the Django test client, so it never crosses the network. This one measures
// what a client actually waits for. Run both — a fast query count with slow
// wall-clock means the cost is serialization or payload size, not the database.
//
//   docker run --rm --network nounder40_default -v "$PWD/ops/testing:/t" \
//     -e BASE=http://<django-ip>:8001 grafana/k6 run /t/load/endpoint_bench.js

import http from 'k6/http'
import { Trend } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://172.19.0.4:8001'
const PW = __ENV.PW || 'LoadTest!2024'

// k6 requires every metric to be constructed in the init context, so the
// endpoint list is declared first and the Trends are built from it up front.
const ENDPOINTS = [
  ['auth_login',           'POST', '/api/auth/login/',                  'none'],
  ['pub_schools',          'GET',  '/api/schools/public/',              'none'],
  ['pub_lessons',          'GET',  '/api/student/lessons/',             'none'],
  ['pub_translations',     'GET',  '/api/translations/',                'none'],
  ['pub_platform_stats',   'GET',  '/api/platform-stats/',              'none'],
  ['pub_locations',        'GET',  '/api/locations/',                   'none'],
  ['stu_me',               'GET',  '/api/auth/me/',                     'student'],
  ['stu_credits',          'GET',  '/api/student/credits/',             'student'],
  ['stu_bookings',         'GET',  '/api/student/bookings/',            'student'],
  ['stu_packages',         'GET',  '/api/student/packages/',            'student'],
  ['stu_lessons',          'GET',  '/api/student/lessons/',             'student'],
  ['stu_school_packages',  'GET',  '/api/student/school-packages/',     'student'],
  ['stu_credit_history',   'GET',  '/api/student/credit-history/',      'student'],
  ['sch_reports',          'GET',  '/api/school/reports/',              'owner'],
  ['sch_reports_detailed', 'GET',  '/api/school/reports/detailed/',     'owner'],
  ['sch_students',         'GET',  '/api/school/students/',             'owner'],
  ['sch_lessons',          'GET',  '/api/school/lessons/',              'owner'],
  ['sch_lessons_feed',     'GET',  '/api/school/lessons-feed/',         'owner'],
  ['sch_courses',          'GET',  '/api/school/courses/',              'owner'],
  ['sch_courses_overview', 'GET',  '/api/school/courses-overview/',     'owner'],
  ['sch_transactions',     'GET',  '/api/school/transactions/',         'owner'],
  ['sch_comp_summary',     'GET',  '/api/school/compensation-summary/', 'owner'],
  ['sch_documents',        'GET',  '/api/school/documents/',            'owner'],
  ['sch_teachers',         'GET',  '/api/school/teachers/',             'owner'],
]

const TRENDS = {}
for (const [name] of ENDPOINTS) TRENDS[name] = new Trend(`ep_${name}`, true)

export const options = { vus: 1, iterations: 15, thresholds: {} }

function jsonParams(token) {
  const h = { 'Content-Type': 'application/json' }
  if (token) h.Authorization = `Bearer ${token}`
  return { headers: h }
}

function login(email) {
  const r = http.post(`${BASE}/api/auth/login/`,
    JSON.stringify({ email, password: PW }), jsonParams(null))
  TRENDS.auth_login.add(r.timings.duration)
  return r.status === 200 ? r.json('access') : null
}

export default function () {
  const tokens = {
    none: null,
    student: login('load001@example.test'),
    owner: login('owner.a@example.test'),
  }

  for (const [name, method, path, who] of ENDPOINTS) {
    if (method !== 'GET') continue  // login is already timed above
    const r = http.get(`${BASE}${path}`, jsonParams(tokens[who]))
    TRENDS[name].add(r.timings.duration)
  }
}
