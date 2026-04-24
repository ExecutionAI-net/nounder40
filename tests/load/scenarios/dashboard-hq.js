/**
 * k6 scenario: HQ dashboard read-heavy.
 *
 * One HQ super-admin user, many concurrent dashboard refreshes (e.g.
 * monitoring + open tabs). Validates that the network-wide aggregate
 * queries stay fast.
 *
 * Required env:
 *   HQ_EMAIL, HQ_PASSWORD — credentials of an HQ super_admin user
 *
 * Run:
 *   k6 run \
 *     -e HQ_EMAIL=admin@... -e HQ_PASSWORD=... \
 *     tests/load/scenarios/dashboard-hq.js
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'
import { BASE_URL, SUPABASE_URL, ANON_KEY } from '../lib/config.js'

const HQ_EMAIL = __ENV.HQ_EMAIL
const HQ_PASSWORD = __ENV.HQ_PASSWORD

export const options = {
  scenarios: {
    hq_refresh: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      gracefulStop: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'dashboard_latency': ['p(95)<2000'],
  },
}

const dashboardLatency = new Trend('dashboard_latency', true)

let cachedToken = null

function loginHQ() {
  if (!HQ_EMAIL || !HQ_PASSWORD) throw new Error('HQ_EMAIL and HQ_PASSWORD required')
  if (cachedToken) return cachedToken

  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: HQ_EMAIL, password: HQ_PASSWORD }),
    { headers: { 'Content-Type': 'application/json', apikey: ANON_KEY }, tags: { name: 'auth_hq' } },
  )
  if (res.status !== 200) throw new Error(`HQ login failed: ${res.status} ${res.body}`)
  cachedToken = res.json('access_token')
  return cachedToken
}

export default function () {
  const token = loginHQ()
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  const endpoints = [
    '/api/hq/dashboard',
    '/api/hq/schools',
    '/api/hq/team',
  ]

  for (const path of endpoints) {
    const r = http.get(`${BASE_URL}${path}`, { headers, tags: { name: path } })
    dashboardLatency.add(r.timings.duration)
    check(r, { [`${path} ok`]: (res) => res.status < 400 })
  }

  sleep(3 + Math.random() * 4)
}
