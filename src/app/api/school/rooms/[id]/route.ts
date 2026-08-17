import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

async function authHeader() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const res = await fetch(`${DJANGO_API_URL}/api/school/rooms/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${DJANGO_API_URL}/api/school/rooms/${params.id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
