'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api/client'
import { readTeacherSchool, writeTeacherSchool, type TeacherSchoolGrant } from '@/lib/teacher-scope'

// Blocco della barra laterale del pannello insegnante, sul modello di
// SchoolSwitcher (pannello scuola): con una sola scuola mostra il nome, con
// più scuole (es. Alina, insegnante in due) diventa un selettore che filtra
// tutto il pannello — calendario, presenze, statistiche, compensi, libreria.
// "Tutte le scuole" resta possibile. La scelta vive sul dispositivo
// (lib/teacher-scope.ts) e la pagina si ricarica, come il cambio scuola.
export default function TeacherSchoolSwitcher() {
  const t = useTranslations('layout.teacherSchool')
  const [schools, setSchools] = useState<TeacherSchoolGrant[]>([])
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    apiFetch<TeacherSchoolGrant[]>('/teacher/schools/')
      .then((rows) => {
        const list = rows ?? []
        setSchools(list)
        const saved = readTeacherSchool()
        if (saved && !list.some((s) => s.school_id === saved)) {
          // Non è più insegnante di quella scuola: si torna a "tutte"
          writeTeacherSchool('')
          window.location.reload()
          return
        }
        setSelected(saved)
      })
      .catch(() => setSchools([]))
      .finally(() => setLoaded(true))
  }, [])

  function change(id: string) {
    if (id === selected) return
    writeTeacherSchool(id)
    setSelected(id)
    // Ricarica completa: ogni pagina rilegge la scuola scelta
    window.location.reload()
  }

  if (!loaded || schools.length === 0) return null

  if (schools.length === 1) {
    return (
      <div className="px-6 py-3 border-t border-white/10">
        <p className="text-[10px] uppercase tracking-wider text-[var(--sb-text)] opacity-70 font-semibold">{t('label')}</p>
        <p className="text-sm text-white font-medium truncate mt-0.5">{schools[0].school_name}</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-white/10">
      <p className="text-[10px] uppercase tracking-wider text-[var(--sb-text)] opacity-70 font-semibold px-2 mb-1.5">{t('label')}</p>
      <select
        value={selected}
        onChange={(e) => change(e.target.value)}
        className="w-full px-2 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-white/30"
      >
        <option value="" className="text-gray-900">{t('all')}</option>
        {schools.map((s) => (
          <option key={s.school_id} value={s.school_id} className="text-gray-900">{s.school_name}</option>
        ))}
      </select>
    </div>
  )
}
