import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// TEMPORARY DEV ROUTE — DELETE AFTER USE
export async function GET() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const users = [
    '5776822f-fc95-4cbc-9846-3a8332dc94bd', // school@test.com
    'de4a20d7-8d62-4915-9092-87b7629ca1e0', // teacher@test.com
    '586a8686-bbcb-422a-8ec4-a9a58d14dacd', // student@test.com
  ]

  const results = await Promise.all(
    users.map((id) =>
      admin.auth.admin.updateUserById(id, { password: 'Test1234!' })
    )
  )

  const errors = results.filter((r) => r.error).map((r) => r.error?.message)
  if (errors.length > 0) return NextResponse.json({ errors }, { status: 500 })

  return NextResponse.json({ ok: true, updated: users.length })
}
