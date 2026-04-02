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
