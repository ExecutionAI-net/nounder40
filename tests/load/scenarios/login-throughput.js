/**
 * k6 scenario: Login throughput.
 *
 * Hammers the Supabase auth endpoint with concurrent password sign-ins.
 * Goal: confirm /token can sustain a realistic login burst (e.g. school
 * morning rush) without 5xx and within p95 < 1500ms.
 *
 * Run:
 *   k6 run -e LOAD_STUDENT_COUNT=20 tests/load/scenarios/login-throughput.js
 */

import { sleep } from 'k6'
import { Trend, Rate } from 'k6/metrics'
import { loginStudent } from '../lib/auth.js'
import { LOAD_STUDENT_COUNT } from '../lib/config.js'

export const options = {
  scenarios: {
    login_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 25 },
        { duration: '30s', target: 0 },
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
    'login_latency': ['p(95)<1500'],
    'login_success': ['rate>0.99'],
  },
}

const loginLatency = new Trend('login_latency', true)
const loginSuccess = new Rate('login_success')

export default function () {
  const i = Math.floor(Math.random() * LOAD_STUDENT_COUNT)
  const start = Date.now()
  try {
    const session = loginStudent(i)
    loginLatency.add(Date.now() - start)
    loginSuccess.add(!!session.accessToken)
  } catch (_e) {
    loginSuccess.add(false)
  }
  sleep(Math.random() * 2)
}
