import { createClient } from '@supabase/supabase-js'
import { sendTemplatedEmail } from '@/lib/zepto'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function getEmailsEnabled(): Promise<boolean> {
  const { data } = await admin()
    .from('email_settings')
    .select('value')
    .eq('key', 'emails_enabled')
    .maybeSingle()
  return (data?.value ?? 'true') === 'true'
}

async function getCreditsThreshold(): Promise<number> {
  const { data } = await admin()
    .from('email_settings')
    .select('value')
    .eq('key', 'credits_low_threshold')
    .maybeSingle()
  return parseInt(data?.value ?? '5', 10)
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
  if (!(await getEmailsEnabled())) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  const { data: booking } = await admin()
    .from('bookings')
    .select(`
      lessons!lesson_id(
        date, start_time, end_time,
        courses!course_id(name),
        lesson_types!lesson_type_id(name_en),
        teachers!teacher_id(name),
        school_rooms!room_id(name, school_locations!location_id(name))
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
    templateKey: 'student.booking_confirmed',
    locale,
    vars: {
      student_name: to.name,
      school_name: school?.name ?? '',
      lesson_name: lesson?.courses?.name ?? lesson?.lesson_types?.name_en ?? '',
      lesson_date: lesson?.date ? new Date(lesson.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
      lesson_time: lesson?.start_time?.slice(0, 5) ?? '',
      lesson_duration: lesson?.end_time && lesson?.start_time
        ? `${Math.round((new Date(`1970-01-01T${lesson.end_time}`).getTime() - new Date(`1970-01-01T${lesson.start_time}`).getTime()) / 60000)} min`
        : '',
      teacher_name: lesson?.teachers?.name ?? '',
      location_name: lesson?.school_rooms?.school_locations?.name ?? '',
      room_name: lesson?.school_rooms?.name ?? '',
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
}) {
  if (!(await getEmailsEnabled())) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.booking_cancelled',
    locale,
    vars: {
      student_name: to.name,
      school_name: vars.school_name,
      lesson_name: vars.lesson_name,
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
}) {
  if (!(await getEmailsEnabled())) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey: 'student.lesson_cancelled_by_school',
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`, ...vars },
  }).catch(e => console.error('[email] lesson_cancelled_by_school failed:', e))
}

export async function sendNoShowEmail(studentId: string, vars: {
  school_name: string
  lesson_name: string
  lesson_date: string
  lesson_time: string
}) {
  if (!(await getEmailsEnabled())) return
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
}) {
  if (!(await getEmailsEnabled())) return
  const to = await getStudentEmail(studentId)
  if (!to) return
  const locale = await getStudentLocale(studentId)

  await sendTemplatedEmail({
    to,
    templateKey,
    locale,
    vars: { student_name: to.name, booking_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/student/bookings`, ...vars },
  }).catch(e => console.error(`[email] ${templateKey} failed:`, e))
}

export async function sendAfterPurchaseEmail(studentId: string, vars: {
  package_name: string
  amount: string
  credits_remaining: string
  package_expiry: string
}) {
  if (!(await getEmailsEnabled())) return
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

export async function maybeSendCreditsLowEmail(studentId: string, schoolId: string, creditsRemaining: number) {
  if (!(await getEmailsEnabled())) return
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
  if (!(await getEmailsEnabled())) return
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
  if (!(await getEmailsEnabled())) return

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
  if (!(await getEmailsEnabled())) return

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
