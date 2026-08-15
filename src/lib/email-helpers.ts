import { createClient } from '@supabase/supabase-js'
import { sendTemplatedEmail } from '@/lib/zepto'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Un'email parte solo se l'invio globale è attivo E il singolo template non è
// stato disattivato da HQ (email_settings: emails_enabled + enabled.<key>).
async function emailEnabled(templateKey: string): Promise<boolean> {
  const { data } = await admin()
    .from('email_settings')
    .select('key, value')
    .in('key', ['emails_enabled', `enabled.${templateKey}`])
  const map = new Map((data ?? []).map(r => [r.key, r.value]))
  if ((map.get('emails_enabled') ?? 'true') !== 'true') return false
  return (map.get(`enabled.${templateKey}`) ?? 'true') === 'true'
}

async function getCreditsThreshold(): Promise<number> {
  const { data } = await admin()
    .from('email_settings')
    .select('value')
    .eq('key', 'credits_low_threshold')
    .maybeSingle()
  return parseInt(data?.value ?? '5', 10)
}

// Nomi del tipo lezione nelle varie lingue (per email nella lingua della studentessa)
export type LtNames = { name_en?: string | null; name_it?: string | null; name_es?: string | null } | null

function localizedLessonName(locale: string, courseName: string | null | undefined, lt: LtNames): string {
  if (courseName?.trim()) return courseName
  if (!lt) return ''
  const by: Record<string, string | null | undefined> = { en: lt.name_en, it: lt.name_it, es: lt.name_es }
  return by[locale] || lt.name_en || lt.name_it || ''
}

async function getStudentLocale(studentId: string): Promise<string> {
  const { data } = await admin()
    .from('profiles')
    .select('language_preference')
    .eq('id', studentId)
    .maybeSingle()
  return data?.language_preference ?? 'en'
}

async function getStudentEmail(studentId: string): Promise<{ email: string; name: string } | null> {
  const { data } = await admin()
    .from('profiles')
    .select('email, name')
    .eq('id', studentId)
    .maybeSingle()
  if (!data?.email) return null
  return { email: data.email, name: data.name ?? data.email }
}

export async function sendBookingConfirmedEmail(bookingId: string, studentId: string) {
  if (!(await emailEnabled('student.booking_confirmed'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  const { data: booking } = await admin()
    .from('bookings')
    .select(`
      lessons!lesson_id(
        date, start_time, end_time, is_online, online_link,
        courses!course_id(name),
        lesson_types!lesson_type_id(name_en, name_it, name_es),
        teachers!teacher_id(name),
        school_rooms!room_id(name, school_locations!location_id(name, address))
      ),
      schools!school_id(name)
    `)
    .eq('id', bookingId)
    .maybeSingle()

  if (!booking) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lesson = booking.lessons as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const school = booking.schools as any

  await sendTemplatedEmail({
    to,
    // email sdoppiata: testo diverso per lezioni online (link) e in sede (indirizzo)
    templateKey: lesson?.is_online ? 'student.booking_confirmed.online' : 'student.booking_confirmed',
    locale,
    vars: {
      student_name: to.name,
      school_name: school?.name ?? '',
      lesson_name: localizedLessonName(locale, lesson?.courses?.name, lesson?.lesson_types ?? null),
      lesson_date: lesson?.date ? new Date(lesson.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
      lesson_time: lesson?.start_time?.slice(0, 5) ?? '',
      lesson_duration: lesson?.end_time && lesson?.start_time
        ? `${Math.round((new Date(`1970-01-01T${lesson.end_time}`).getTime() - new Date(`1970-01-01T${lesson.start_time}`).getTime()) / 60000)} min`
        : '',
      teacher_name: lesson?.teachers?.name ?? '',
      location_name: lesson?.is_online ? 'Online' : (lesson?.school_rooms?.school_locations?.name ?? ''),
      location_address: lesson?.is_online ? '' : (lesson?.school_rooms?.school_locations?.address ?? ''),
      room_name: lesson?.is_online ? '' : (lesson?.school_rooms?.name ?? ''),
      online_link: lesson?.is_online && lesson?.online_link
        ? (lesson.online_link.startsWith('http') ? lesson.online_link : `https://${lesson.online_link}`)
        : '',
      // blocco HTML pronto: bottone "partecipa" se online, vuoto se in sede
      // (i template non hanno condizionali, così la riga sparisce da sola)
      online_link_html: (() => {
        if (!lesson?.is_online || !lesson?.online_link) return ''
        const url = lesson.online_link.startsWith('http') ? lesson.online_link : `https://${lesson.online_link}`
        const label = ({ it: 'Partecipa alla lezione online', es: 'Únete a la clase online', fr: 'Rejoindre le cours en ligne', de: 'Online-Stunde beitreten' } as Record<string, string>)[locale] ?? 'Join the online class'
        return `<p style="margin:16px 0;"><a href="${url}" style="display:inline-block;background:#6B1F3A;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">🌐 ${label}</a></p>`
      })(),
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`,
    },
  }).catch(e => console.error('[email] booking_confirmed failed:', e))
}

export async function sendBookingCancelledEmail(studentId: string, vars: {
  school_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
  credit_refunded: boolean
  credits_deducted: number
  is_online?: boolean
  course_name?: string | null
  lesson_type_names?: LtNames
}) {
  if (!(await emailEnabled('student.booking_cancelled'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: vars.is_online ? 'student.booking_cancelled.online' : 'student.booking_cancelled',
    locale,
    vars: {
      student_name: to.name,
      school_name: vars.school_name,
      lesson_name: vars.lesson_name || localizedLessonName(locale, vars.course_name, vars.lesson_type_names ?? null),
      lesson_date: vars.lesson_date,
      lesson_time: vars.lesson_time,
      credits_remaining: vars.credit_refunded ? `+${vars.credits_deducted} refunded` : 'not refunded',
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`,
    },
  }).catch(e => console.error('[email] booking_cancelled failed:', e))
}

export async function sendLessonCancelledBySchoolEmail(studentId: string, vars: {
  school_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
  is_online?: boolean
}) {
  if (!(await emailEnabled('student.lesson_cancelled_by_school'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: vars.is_online ? 'student.lesson_cancelled_by_school.online' : 'student.lesson_cancelled_by_school',
    locale,
    vars: {
      student_name: to.name,
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`,
      school_name: vars.school_name,
      lesson_name: vars.lesson_name,
      lesson_date: vars.lesson_date,
      lesson_time: vars.lesson_time,
    },
  }).catch(e => console.error('[email] lesson_cancelled_by_school failed:', e))
}

export async function sendNoShowEmail(studentId: string, vars: {
  school_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
}) {
  if (!(await emailEnabled('student.no_show'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.no_show',
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`, ...vars },
  }).catch(e => console.error('[email] no_show failed:', e))
}

export async function sendLessonReminderEmail(studentId: string, templateKey: 'student.lesson_reminder_1day' | 'student.lesson_reminder_2hour', vars: {
  school_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
  teacher_name: string
  location_name: string
  location_address?: string
  online_link?: string
  is_online?: boolean
  course_name?: string | null
  lesson_type_names?: LtNames
}) {
  if (!(await emailEnabled(templateKey))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: vars.is_online ? `${templateKey}.online` : templateKey,
    locale,
    vars: {
      student_name: to.name,
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`,
      school_name: vars.school_name,
      lesson_name: vars.lesson_name || localizedLessonName(locale, vars.course_name, vars.lesson_type_names ?? null),
      lesson_date: vars.lesson_date,
      lesson_time: vars.lesson_time,
      teacher_name: vars.teacher_name,
      location_name: vars.location_name,
      location_address: vars.location_address ?? '',
      online_link: vars.online_link ?? '',
    },
  }).catch(e => console.error(`[email] ${templateKey} failed:`, e))
}

export async function sendAfterPurchaseEmail(studentId: string, vars: {
  package_name: string
  amount: string
  credits_remaining: string
  package_expiry: string
}) {
  if (!(await emailEnabled('student.after_purchase'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.after_purchase',
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/book`, ...vars },
  }).catch(e => console.error('[email] after_purchase failed:', e))
}

export async function sendPackageExpiringEmail(studentId: string, vars: {
  school_name: string
  package_name: string
  package_expiry: string
  credits_remaining: string
}) {
  if (!(await emailEnabled('student.package_expiring'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.package_expiring',
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/buy`, ...vars },
  }).catch(e => console.error('[email] package_expiring failed:', e))
}

export async function sendSubscriptionExpiringEmail(studentId: string, vars: {
  school_name: string
  subscription_name: string
  subscription_expiry: string
  accesses_remaining: string
}) {
  if (!(await emailEnabled('student.subscription_expiring'))) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.subscription_expiring',
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/buy`, ...vars },
  }).catch(e => console.error('[email] subscription_expiring failed:', e))
}

export async function maybeSendCreditsLowEmail(studentId: string, schoolId: string, creditsRemaining: number) {
  if (!(await emailEnabled('student.credits_low'))) return
  const threshold = await getCreditsThreshold()
  if (creditsRemaining > threshold) return

  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  const { data: school } = await admin().from('schools').select('name').eq('id', schoolId).maybeSingle()

  await sendTemplatedEmail({
    to,
    templateKey: 'student.credits_low',
    locale,
    vars: {
      student_name: to.name,
      school_name: school?.name ?? '',
      credits_remaining: String(creditsRemaining),
      credits_threshold: String(threshold),
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/buy`,
    },
  }).catch(e => console.error('[email] credits_low failed:', e))
}

export async function sendWelcomeEmail(studentId: string, name: string, email: string) {
  if (!(await emailEnabled('student.welcome'))) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to: { email, name },
    templateKey: 'student.welcome',
    locale,
    vars: {
      student_name: name,
      booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/dashboard`,
    },
  }).catch(e => console.error('[email] welcome failed:', e))
}

export async function sendSchoolNewBookingEmail(schoolId: string, vars: {
  student_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
  teacher_name?: string
  location_name?: string
}) {
  if (!(await emailEnabled('school.new_booking'))) return

  const { data: school } = await admin().from('schools').select('email, name').eq('id', schoolId).maybeSingle()
  if (!school?.email) return

  await sendTemplatedEmail({
    to: { email: school.email, name: school.name },
    templateKey: 'school.new_booking',
    locale: 'en',
    vars: { school_name: school.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/school/bookings`, ...vars },
  }).catch(e => console.error('[email] school.new_booking failed:', e))
}

export async function sendHQNewSchoolEmail(schoolName: string, schoolEmail: string) {
  if (!(await emailEnabled('hq.new_school_registered'))) return

  const { data: hqMembers } = await admin()
    .from('profiles')
    .select('email, name')
    .eq('role', 'hq')
    .limit(5)

  for (const member of hqMembers ?? []) {
    await sendTemplatedEmail({
      to: { email: member.email, name: member.name },
      templateKey: 'hq.new_school_registered',
      locale: 'en',
      vars: {
        student_name: member.name,
        school_name: schoolName,
        booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/hq/schools`,
      },
    }).catch(e => console.error('[email] hq.new_school failed:', e))
  }
}
