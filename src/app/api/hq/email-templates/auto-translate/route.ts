import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as adminClient } from '@supabase/supabase-js'

export const maxDuration = 120

function admin() {
  return adminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const LOCALES = ['it', 'es', 'fr', 'de'] as const
const LOCALE_NAMES: Record<string, string> = {
  en: 'English', it: 'Italian', es: 'Spanish', fr: 'French', de: 'German',
}

async function translateText(text: string, toLocale: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Translate the following from English to ${LOCALE_NAMES[toLocale]} for a professional dance school platform email.

RULES:
- Keep {{variable}} placeholders EXACTLY as-is
- Keep HTML tags intact
- Do NOT translate: "No Under 40", proper nouns, brand names
- Professional, warm tone
- Return ONLY the translated text, nothing else

Text to translate:
${text}`,
      }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic error ${res.status}`)
  const data = await res.json()
  return data.content[0].text.trim()
}

// POST /api/hq/email-templates/auto-translate
// Body: { key: string } — translate EN template of this key to all missing locales
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'hq') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const { key } = await req.json()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const db = admin()

  // Get EN template
  const { data: enTemplate } = await db
    .from('email_templates')
    .select('subject, body_html')
    .eq('key', key)
    .eq('locale', 'en')
    .maybeSingle()

  if (!enTemplate?.subject || !enTemplate?.body_html) {
    return NextResponse.json({ error: 'English template not found or empty' }, { status: 404 })
  }

  // Get existing locales for this key
  const { data: existing } = await db
    .from('email_templates')
    .select('locale, subject, body_html')
    .eq('key', key)

  const existingMap = new Map((existing ?? []).map(r => [r.locale, r]))
  const now = new Date().toISOString()
  let translated = 0

  for (const locale of LOCALES) {
    const ex = existingMap.get(locale)
    if (ex?.subject?.trim() && ex?.body_html?.trim()) continue // already filled

    try {
      const [translatedSubject, translatedBody] = await Promise.all([
        translateText(enTemplate.subject, locale),
        translateText(enTemplate.body_html, locale),
      ])

      await db.from('email_templates').upsert({
        key, locale,
        subject: translatedSubject,
        body_html: translatedBody,
        updated_at: now,
      }, { onConflict: 'key,locale' })

      translated++
      await new Promise(r => setTimeout(r, 200))
    } catch (err) {
      console.error(`[auto-translate] failed for ${key}/${locale}:`, err)
    }
  }

  return NextResponse.json({ translated })
}
