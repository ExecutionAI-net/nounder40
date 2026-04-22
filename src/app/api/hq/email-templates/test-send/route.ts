import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/zepto'

// POST /api/hq/email-templates/test-send
// Body: { subject: string, body_html: string, to_email: string }
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { subject, body_html, to_email } = await req.json()
  if (!subject || !body_html || !to_email) {
    return NextResponse.json({ error: 'subject, body_html and to_email required' }, { status: 400 })
  }

  // Replace placeholders with sample values for preview
  const sampleVars: Record<string, string> = {
    student_name: 'Maria Rossi',
    school_name: 'Dance Studio Roma',
    lesson_name: 'Ballet Fundamentals',
    lesson_date: '25 April 2026',
    lesson_time: '18:00',
    lesson_duration: '60 min',
    teacher_name: 'Sofia Ferrari',
    location_name: 'Studio Roma Centro',
    room_name: 'Sala A',
    credits_remaining: '3',
    credits_used: '7',
    credits_threshold: '5',
    package_name: 'Monthly 10 Credits',
    package_expiry: '30 April 2026',
    amount: '€45.00',
    booking_url: '#',
    platform_name: 'No Under 40',
  }

  const rendered = body_html.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => sampleVars[k] ?? `{{${k}}}`)
  const renderedSubject = subject.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => sampleVars[k] ?? `{{${k}}}`)

  try {
    await sendEmail({ to: { email: to_email }, subject: `[TEST] ${renderedSubject}`, htmlBody: rendered })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
