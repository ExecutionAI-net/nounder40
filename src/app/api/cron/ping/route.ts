import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Vercel cron: her 3 günde bir çalışır, Supabase free tier pause'unu önler
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = await createClient()
  const { error } = await supabase.from('schools').select('id').limit(1)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, time: new Date().toISOString() })
}
