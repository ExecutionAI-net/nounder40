// Localized lesson type name with sensible fallbacks.
// Course display rule: courses.name (custom, optional) → lesson type name
// in the viewer's language → EN → IT.
import { localizedName, type TranslatedNames } from './localized-name'

export type LessonTypeNames = TranslatedNames

export function lessonTypeName(lt: LessonTypeNames, locale: string): string {
  return localizedName(lt, locale)
}

export function courseDisplayName(
  courseName: string | null | undefined,
  lt: LessonTypeNames,
  locale: string
): string {
  return courseName?.trim() || lessonTypeName(lt, locale)
}
