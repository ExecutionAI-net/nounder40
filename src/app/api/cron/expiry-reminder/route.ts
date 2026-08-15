import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPackageExpiringEmail, sendSubscriptionExpiringEmail } from '@/lib/email-helpers'

export const dynamic = 'force-dynamic'

export const maxDuration = 300

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Giornaliero: avvisa le allieve 7 giorni prima della scadenza di pacchetti
// (non ricorrenti, con crediti residui) e abbonamenti che non si rinnovano
// (senza auto-rinnovo o disdetti).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = admin()

  // Giorni di preavviso configurabili da HQ (email_settings, default 7)
  const { data: daysSetting } = await supabase
    .from('email_settings')
    .select('value')
    .eq('key', 'expiry_reminder_days')
    .maybeSingle()
  const days = Math.max(1, parseInt(daysSetting?.value ?? '7', 10) || 7)

  // Finestra: tutto ciò che scade tra N e N+1 giorni da ora (cron giornaliero → un solo invio)
  const from = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const to = new Date(Date.now() + (days + 1) * 24 * 60 * 60 * 1000).toISOString()

  const emailTasks: Promise<unknown>[] = []

  // ── Pacchetti in scadenza ──
  const { data: pkgs, error: pkgErr } = await supabase
    .from('student_packages')
    .select(`
      id, student_id, expires_at, credits_remaining,
      packages!package_id(name_en, is_recurring),
      schools!school_id(name)
    `)
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .gte('expires_at', from)
    .lt('expires_at', to)

  if (pkgErr) console.error('[cron/expiry] packages fetch error:', pkgErr.message)

  let pkgCount = 0
  for (const sp of pkgs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = sp as unknown as Record<string, any>
    if (row.packages?.is_recurring) continue // si rinnova da solo, niente avviso
    pkgCount++
    emailTasks.push(sendPackageExpiringEmail(sp.student_id, {
      school_name: row.schools?.name ?? '',
      package_name: row.packages?.name_en ?? '',
      package_expiry: formatDate(sp.expires_at),
      credits_remaining: String(sp.credits_remaining),
    }))
  }

  // ── Abbonamenti in scadenza (che non si rinnoveranno) ──
  const { data: subs, error: subErr } = await supabase
    .from('student_subscriptions')
    .select(`
      id, student_id, current_period_end, access_remaining, status,
      subscriptions_catalog!subscription_catalog_id(name_en, auto_renewal),
      schools!school_id(name)
    `)
    .in('status', ['active', 'cancelled'])
    .gte('current_period_end', from)
    .lt('current_period_end', to)

  if (subErr) console.error('[cron/expiry] subscriptions fetch error:', subErr.message)

  let subCount = 0
  for (const ss of subs ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = ss as unknown as Record<string, any>
    // attivo con auto-rinnovo → si rinnova da solo, niente avviso
    if (ss.status === 'active' && row.subscriptions_catalog?.auto_renewal) continue
    subCount++
    emailTasks.push(sendSubscriptionExpiringEmail(ss.student_id, {
      school_name: row.schools?.name ?? '',
      subscription_name: row.subscriptions_catalog?.name_en ?? '',
      subscription_expiry: formatDate(ss.current_period_end),
      accesses_remaining: ss.access_remaining != null ? String(ss.access_remaining) : '∞',
    }))
  }

  await Promise.allSettled(emailTasks)

  console.log(`[cron/expiry] sent ${pkgCount} package + ${subCount} subscription expiry reminders (${days} days ahead)`)
  return NextResponse.json({ packages: pkgCount, subscriptions: subCount, days })
}
