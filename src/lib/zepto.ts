import { createClient } from '@supabase/supabase-js'

interface SendEmailOptions {
  to: { email: string; name?: string }
  subject: string
  htmlBody: string
}

export async function sendEmail({ to, subject, htmlBody }: SendEmailOptions) {
  const res = await fetch('https://api.zeptomail.eu/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Zoho-enczapikey ${process.env.ZEPTO_MAIL_TOKEN}`,
    },
    body: JSON.stringify({
      from: {
        address: process.env.ZEPTO_MAIL_FROM,
        name: process.env.ZEPTO_MAIL_FROM_NAME,
      },
      to: [{ email_address: { address: to.email, name: to.name ?? to.email } }],
      subject,
      htmlbody: htmlBody,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ZeptoMail error ${res.status}: ${body}`)
  }

  return res.json()
}

// Replace {{variable}} placeholders in subject + body
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

export type EmailVars = Record<string, string>

export async function sendTemplatedEmail({
  to,
  templateKey,
  locale,
  vars,
}: {
  to: { email: string; name?: string }
  templateKey: string
  locale: string
  vars: EmailVars
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Try requested locale, fall back to 'en'
  const { data: template } = await supabase
    .from('email_templates')
    .select('subject, body_html')
    .eq('key', templateKey)
    .eq('locale', locale)
    .maybeSingle()

  let subject = template?.subject ?? ''
  let bodyHtml = template?.body_html ?? ''

  if (!subject || !bodyHtml) {
    const { data: fallback } = await supabase
      .from('email_templates')
      .select('subject, body_html')
      .eq('key', templateKey)
      .eq('locale', 'en')
      .maybeSingle()
    subject = fallback?.subject ?? ''
    bodyHtml = fallback?.body_html ?? ''
  }

  if (!subject || !bodyHtml) {
    console.warn(`[email] template not found: ${templateKey} (${locale})`)
    return
  }

  const allVars = { platform_name: 'No Under 40', ...vars }

  await sendEmail({
    to,
    subject: renderTemplate(subject, allVars),
    htmlBody: renderTemplate(bodyHtml, allVars),
  })
}
