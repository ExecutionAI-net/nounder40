import { NextResponse } from 'next/server'

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiUnauthorized() {
  return apiError('Unauthorized', 401)
}

export function apiForbidden() {
  return apiError('Forbidden', 403)
}

export function apiNotFound(entity = 'Resource') {
  return apiError(`${entity} not found`, 404)
}

export function apiServerError(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : 'Server error'
  return apiError(message, 500)
}
