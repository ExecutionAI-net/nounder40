export function hqInviteEmailHtml(name: string, dashboardUrl: string, role: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
        <tr>
          <td style="background:#6B1F3A;padding:32px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">No Under 40</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600">Hi ${name},</h2>
            <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
              You have been added to the <strong>No Under 40 HQ Panel</strong> as <strong>${role}</strong>.
            </p>
            <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6">
              Sign in with your existing account to access the HQ dashboard.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#6B1F3A;border-radius:10px">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                    Go to HQ Dashboard →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">No Under 40 · Classical Dance Network</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function welcomeEmailHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
        <!-- Header -->
        <tr>
          <td style="background:#6B1F3A;padding:32px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">No Under 40</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 12px;color:#111827;font-size:20px;font-weight:600">Welcome, ${name}! 🎉</h2>
            <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
              Your account has been verified. You're now part of the No Under 40 network — a community of classical dance schools and students.
            </p>
            <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6">
              You can now browse lessons, book classes, and manage your packages.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#6B1F3A;border-radius:10px">
                  <a href="${process.env.NEXT_PUBLIC_APP_URL}/student/dashboard"
                     style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                    Go to Dashboard →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">No Under 40 · Classical Dance Network</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
