'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import CoursesClient, { type Course } from './CoursesClient'

type LessonType = { id: string; name_en: string; name_it: string; name_es?: string | null; sort_order?: number | null }
type Teacher = { id: string; name: string }

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [lessonTypes, setLessonTypes] = useState<LessonType[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [schoolLang, setSchoolLang] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const [coursesData, lessonTypesData, teachersData, school] = await Promise.all([
        apiFetch<Course[]>('/school/courses-overview/'),
        apiFetch<LessonType[]>('/school/lesson-types/?active=true'),
        apiFetch<{ teachers: { teachers: Teacher | null }[] }>('/school/teachers/'),
        apiFetch<{ language?: string }>('/school/profile/').catch((): { language?: string } => ({})),
      ])
      setCourses(coursesData)
      setLessonTypes(
        lessonTypesData.sort((a, b) => ((a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)) || (a.name_en ?? '').localeCompare(b.name_en ?? ''))
      )
      setTeachers((teachersData.teachers ?? []).map(t => t.teachers).filter((t): t is Teacher => !!t))
      setSchoolLang(school.language)
      setLoaded(true)
    }
    load()
  }, [])

  if (!loaded) return <div className="text-sm text-gray-400">Loading…</div>

  return (
    <CoursesClient
      initialCourses={courses}
      initialLessonTypes={lessonTypes}
      initialTeachers={teachers}
      schoolLang={schoolLang}
    />
  )
}
