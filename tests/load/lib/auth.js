/**
 * k6 helper: log in a seeded student via Supabase auth.
 * Returns { accessToken, userId } or throws on failure.
 */

import http from 'k6/http'
import { check, fail } from 'k6'
import { SUPABASE_URL, ANON_KEY, LOAD_PASSWORD, studentEmail } from './config.js'

export function loginStudent(i) {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`
  const payload = JSON.stringify({
    email: studentEmail(i),
    password: LOAD_PASSWORD,
  })
  const res = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
    },
    tags: { name: 'auth_login' },
  })

  const ok = check(res, {
    'login 200': (r) => r.status === 200,
    'has access_token': (r) => !!r.json('access_token'),
  })

  if (!ok) {
    fail(`login failed for s${i}: ${res.status} ${res.body}`)
  }

  const body = res.json()
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    userId: body.user?.id,
  }
}

export function authHeaders(accessToken) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}
