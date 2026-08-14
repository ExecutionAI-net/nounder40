// Localized lesson type name with sensible fallbacks.
// Course display rule: courses.name (custom, optional) → lesson type name
// in the viewer's language → EN → IT.
export type LessonTypeNames = {
  name_it?: string | null
  name_en?: string | null
  name_fr?: string | null
  name_es?: string | null
} | null | undefined

export function lessonTypeName(lt: LessonTypeNames, locale: string): string {
  if (!lt) return ''
  const byLocale: Record<string, string | null | undefined> = {
    it: lt.name_it, en: lt.name_en, fr: lt.name_fr, es: lt.name_es,
  }
  return byLocale[locale] || lt.name_en || lt.name_it || ''
}

export function courseDisplayName(
  courseName: string | null | undefined,
  lt: LessonTypeNames,
  locale: string
): string {
  return courseName?.trim() || lessonTypeName(lt, locale)
}
