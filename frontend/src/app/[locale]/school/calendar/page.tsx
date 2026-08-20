'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import CalendarClient, { type Lesson, type TeacherOption, type StudentOption, type CourseOption, type Closure } from './CalendarClient'

/** Returns Monday–Sunday ISO strings for the current week */
function getCurrentWeekRange(): { from: string; to: string } {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((day + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const toISO = (d: Date) => d.toISOString().split('T')[0]
  return { from: toISO(monday), to: toISO(sunday) }
}

export default function CalendarPage() {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [teacherOptions, setTeacherOptions] = useState<TeacherOption[]>([])
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([])
  const [courses, setCourses] = useState<CourseOption[]>([])
  const [closures, setClosures] = useState<Closure[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const { from, to } = getCurrentWeekRange()

      type TeachersResponse = { teachers: { teachers: { id: string; name: string } | null }[] }
      type StudentRow = { students: { id: string; name: string } }

      const [lessonsData, teachersData, studentsData, coursesData, closuresData] = await Promise.all([
        apiFetch<Lesson[]>(`/school/lessons-feed/?from=${from}&to=${to}`),
        apiFetch<TeachersResponse>('/school/teachers/'),
        apiFetch<StudentRow[]>('/school/students/'),
        apiFetch<CourseOption[]>('/school/courses/?active=true'),
        apiFetch<Closure[]>('/school/closures/'),
      ])

      setLessons(lessonsData)
      setTeacherOptions((teachersData.teachers ?? []).map(t => t.teachers).filter((t): t is TeacherOption => !!t))
      setStudentOptions((studentsData ?? []).map(r => r.students).filter(Boolean))
      setCourses((coursesData ?? []).map(c => ({ id: c.id, name: c.name, color: c.color })))
      setClosures(closuresData ?? [])
      setLoaded(true)
    }
    load()
  }, [])

  if (!loaded) return <div className="text-sm text-gray-400">Loading…</div>

  return (
    <CalendarClient
      initialLessons={lessons}
      teacherOptions={teacherOptions}
      studentOptions={studentOptions}
      initialCourses={courses}
      initialClosures={closures}
    />
  )
}
