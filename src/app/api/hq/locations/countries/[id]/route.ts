import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DJANGO_API_URL = process.env.DJANGO_API_URL!

async function authHeader() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const res = await fetch(`${DJANGO_API_URL}/api/hq/locations/countries/${params.id}`, {
    method: 'DELETE',
    headers: await authHeader(),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
