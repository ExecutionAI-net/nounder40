import { createClient } from '@supabase/supabase-js'

interface SendEmailOptions {
  to: { email: string; name?: string }
  subject: string
  htmlBody: string
}

function wrapEmailLayout(content: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="display:inline-block;background:#6B1F3A;border-radius:12px;padding:12px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">No Under 40</span>
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:40px 36px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                © ${new Date().getFullYear()} No Under 40 · You received this email because you are registered on our platform.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
      htmlbody: wrapEmailLayout(htmlBody, subject),
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
