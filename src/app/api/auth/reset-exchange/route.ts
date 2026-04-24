import { NextRequest, NextResponse } from 'next/server'

/**
 * Legacy route kept for backward compatibility with reset emails that were
 * already sent with the old redirectTo. Instead of exchanging the code here
 * (which set httpOnly cookies the browser client couldn't read → user bounced
 * to /login), forward the code to the client-side /reset-password page and
 * let it run exchangeCodeForSession itself.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const origin = req.nextUrl.origin

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=reset_expired', origin))
  }

  const url = new URL('/reset-password', origin)
  url.searchParams.set('code', code)
  return NextResponse.redirect(url)
}
