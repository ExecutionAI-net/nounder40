'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import BalletLoader from '@/components/ui/BalletLoader'
import CoursesClient, { type CourseFilterOptions } from './CoursesClient'

type LessonType = { id: string; name_en: string; name_it: string; name_es?: string | null; sort_order?: number | null }
type Teacher = { id: string; name: string }

export default function CoursesPage() {
  const t = useTranslations('school.courses.list')
  const [filterOptions, setFilterOptions] = useState<CourseFilterOptions | null>(null)
  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [schoolLang, setSchoolLang] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function load() {
      type TeachersResponse = { teachers: { teachers: Teacher | null }[] }
      // Only the filter options are essential: the page loads no course until a
      // filter is picked. The teacher list is lookup data a restricted role may
      // not be allowed to read (403).
      const [optionsData, lessonTypesData, teachersData, school] = await Promise.all([
        apiFetch<CourseFilterOptions>('/school/courses-filter-options/'),
        apiFetch<LessonType[]>('/school/lesson-types/?active=true').catch((): LessonType[] => []),
        apiFetch<TeachersResponse>('/school/teachers/').catch((): TeachersResponse => ({ teachers: [] })),
        apiFetch<{ language?: string }>('/school/profile/').catch((): { language?: string } => ({})),
      ])
      setFilterOptions(optionsData)
      setLessonTypes(
        lessonTypesData.sort((a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || (a.name_en ?? '').localeCompare(b.name_en ?? ''))
      )
      setTeachers((teachersData.teachers ?? []).map(t => t.teachers).filter((t): t is Teacher => !!t))
      setSchoolLang(school.language)
      setLoaded(true)
    }
    load().catch(() => setError(true))
  }, [])

  if (error) return <div className="text-sm text-red-600">{t('errorGeneric')}</div>
  if (!loaded || !filterOptions) return <BalletLoader label={t('loading')} />

  return (
    <CoursesClient
      filterOptions={filterOptions}
      initialLessonTypes={lessonTypes}
      initialTeachers={teachers}
      schoolLang={schoolLang}
    />
  )
}
