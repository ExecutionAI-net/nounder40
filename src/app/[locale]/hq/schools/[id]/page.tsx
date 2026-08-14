import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getTranslations, getLocale } from 'next-intl/server'
import BackButton from '@/components/ui/BackButton'
import SchoolActions from './SchoolActions'
import SendInviteOnNew from './SendInviteOnNew'
import { formatDate } from '@/lib/format-date'

export default async function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations('hq.schools.detail')
  const locale = await getLocale()
  const { id } = await params
  const supabase = await createClient()

  const { data: school } = await supabase
    .from('schools')
    .select('*')
    .eq('id', id)
    .single()

  if (!school) notFound()

  // Use admin client to bypass RLS for aggregate queries
  const admin = createAdminClient()

  const today = new Date().toISOString().split('T')[0]

  const [
    { data: locations },
    { count: teacherCount },
    { count: studentCount },
    { count: lessonCount },
  ] = await Promise.all([
    admin.from('school_locations').select('id, name, address').eq('school_id', id),
    admin.from('teacher_schools').select('id', { count: 'exact', head: true }).eq('school_id', id).eq('active', true),
    admin.from('school_students').select('id', { count: 'exact', head: true }).eq('school_id', id),
    admin.from('lessons').select('id', { count: 'exact', head: true }).eq('school_id', id).eq('status', 'scheduled').gte('date', today),
  ])

  return (
    <div className="max-w-3xl">
      <Suspense><SendInviteOnNew schoolId={id} /></Suspense>
      <div className="mb-6">
        <BackButton href={`/${locale}/hq/schools`} label={t('linkBack')} />
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
            <p className="text-gray-500 text-sm mt-1">{school.city}, {school.country}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full ${school.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {school.active ? t('statusActive') : t('statusInactive')}
            </span>
            <SchoolActions school={school} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t('kpiPlatformFee')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{school.platform_fee_percentage}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t('kpiTeachers')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{teacherCount ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t('kpiStudents')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{studentCount ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{t('kpiActiveLessons')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{lessonCount ?? 0}</p>
        </div>
      </div>

      {locations && locations.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t('sectionLocations')} ({locations.length})</h2>
          <div className="space-y-2">
            {locations.map((loc) => (
              <div key={loc.id} className="flex justify-between text-sm">
                <span className="font-medium text-gray-900">{loc.name}</span>
                <span className="text-gray-400">{loc.address}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
        <h2 className="font-semibold text-gray-900 mb-4">{t('sectionDetails')}</h2>
        {[
          { label: t('labelEmail'), value: school.email },
          { label: t('labelPhone'), value: school.phone ?? '—' },
          {
            label: t('labelAddress'),
            value: [school.address, school.address_line2, school.city, school.province, school.country]
              .filter(Boolean).join(', ') || '—',
          },
          { label: t('labelVat'), value: school.vat_number ?? '—' },
          { label: t('labelLocations'), value: locations?.length ?? 0 },
          { label: t('labelFreeTrialEnds'), value: formatDate(school.free_trial_ends_at) },
          { label: t('labelStripeConnected'), value: school.stripe_onboarding_complete ? t('yes') : t('no') },
          { label: t('labelCreated'), value: formatDate(school.created_at) },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-gray-400">{label}</span>
            <span className="text-gray-900 font-medium">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
