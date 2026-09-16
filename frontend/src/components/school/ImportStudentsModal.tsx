'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch, ApiError } from '@/lib/api/client'
import LanguageSelect from '@/components/ui/LanguageSelect'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import { DEFAULT_PREFIX, PREFIXES } from '@/components/ui/PhoneInput'
import { countryName } from '@/lib/country-name'
import { dialCodeFor } from '@/lib/countries'
import { languageLabel } from '@/lib/languages'

/**
 * Import students from a spreadsheet, in steps the school can always go back
 * from: file -> column matching -> preview -> import.
 *
 * The file is parsed here in the browser (the `xlsx` package the exports
 * already use), so the school sees its own columns with sample values and
 * decides what each one becomes; anything set to "Ignore" never leaves the
 * browser. The preview is a dry run of the very same request the import
 * sends (POST /api/school/students/import/, students/services.py), so what
 * the school confirms is exactly what happens.
 *
 * The import sends no e-mail (Carlo, 16/09/2026). When it is done the
 * imported students are handed back to the page (`onDone`), which selects
 * them so the school can send the password e-mail as a separate step.
 */

type Cell = string | number | boolean | Date | null | undefined
type FileRow = { line: number; cells: Cell[] }
type ParsedSheet = { name: string; header: string[]; rows: FileRow[] }

const TARGETS = [
  'ignore', 'name', 'first_name', 'last_name', 'email', 'phone', 'address', 'city', 'postal_code',
  'province', 'country', 'date_of_birth', 'language_preference', 'skip_if_true',
] as const
type Target = typeof TARGETS[number]
// Fields that must not be fed by two columns (Ignore and the row filter may repeat)
const SINGLE_TARGETS = TARGETS.filter(t => t !== 'ignore' && t !== 'skip_if_true')

// Header words (accent-free, lower case) per field, in the five UI languages
// plus the usual export jargon. "nome"/"name"/"nom" are resolved apart: they
// mean the first name when a surname column exists, the surname when only a
// first-name column exists (French "Nom" + "Prénom"), the full name otherwise.
const NAME_LIKE = new Set(['nome', 'name', 'nombre', 'nom', 'nominativo', 'full name', 'fullname', 'nome completo', 'nombre completo', 'nom complet', 'vollstandiger name', 'nome e cognome', 'allieva', 'alumna', 'eleve', 'schulerin', 'student', 'studentessa'])
const SYNONYMS: Record<Exclude<Target, 'ignore' | 'skip_if_true' | 'name'>, string[]> = {
  first_name: ['first name', 'firstname', 'prenom', 'vorname', 'given name', 'nome di battesimo', 'nombre de pila'],
  last_name: ['cognome', 'surname', 'last name', 'lastname', 'apellido', 'apellidos', 'nom de famille', 'nachname', 'familienname', 'family name'],
  email: ['email', 'e mail', 'mail', 'correo', 'correo electronico', 'courriel', 'indirizzo email', 'email address', 'e mail address', 'adresse e mail', 'e mail adresse'],
  phone: ['telefono', 'phone', 'tel', 'cellulare', 'mobile', 'telephone', 'telefon', 'handy', 'celular', 'movil', 'numero di telefono', 'phone number', 'mobile phone'],
  address: ['indirizzo', 'address', 'direccion', 'adresse', 'via', 'street', 'anschrift', 'strasse'],
  city: ['citta', 'city', 'ciudad', 'ville', 'stadt', 'comune', 'localita', 'ort', 'wohnort'],
  postal_code: ['cap', 'codice postale', 'postal code', 'postcode', 'zip', 'zip code', 'codigo postal', 'code postal', 'plz', 'postleitzahl'],
  province: ['provincia', 'province', 'prov', 'bundesland', 'departement', 'regione', 'region'],
  country: ['paese', 'nazione', 'country', 'pais', 'pays', 'land', 'stato', 'nazionalita'],
  date_of_birth: ['data di nascita', 'nascita', 'date of birth', 'dob', 'birthday', 'birth date', 'birthdate', 'fecha de nacimiento', 'date de naissance', 'geburtsdatum', 'geburtstag', 'nato il', 'nata il'],
  language_preference: ['lingua', 'language', 'idioma', 'langue', 'sprache'],
}
const LANGUAGE_WORDS: Record<string, string> = {
  it: 'it', ita: 'it', italiano: 'it', italian: 'it', italien: 'it', italienisch: 'it',
  en: 'en', eng: 'en', english: 'en', inglese: 'en', ingles: 'en', anglais: 'en', englisch: 'en',
  es: 'es', esp: 'es', spa: 'es', espanol: 'es', spanish: 'es', spagnolo: 'es', espagnol: 'es', spanisch: 'es',
  fr: 'fr', fra: 'fr', fre: 'fr', francais: 'fr', french: 'fr', francese: 'fr', frances: 'fr', franzosisch: 'fr',
  de: 'de', deu: 'de', ger: 'de', deutsch: 'de', german: 'de', tedesco: 'de', aleman: 'de', allemand: 'de',
}
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'si', 'x', 'oui', 'ja', 'vero', 'verdadero', 'vrai', 'wahr', 'on'])

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// A cell as clean text: Excel dates are Date objects (cellDates), numbers
// typed as text keep a leading apostrophe in exports ("'+39...").
function cellText(v: Cell): string {
  if (v == null) return ''
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : isoDate(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v).replace(/^['"’`]+/, '').replace(/\s+/g, ' ').trim()
}

// Day-first, as every spreadsheet around here is; anything else is left to
// the server, which reports it as an invalid date instead of guessing.
function dateValue(text: string): string {
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) return `${dmy[3]}-${pad(+dmy[2])}-${pad(+dmy[1])}`
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`
  return text
}

function guessTargets(header: string[]): Target[] {
  const norm = header.map(normalize)
  const exact = (h: string): Target | null => {
    for (const [target, words] of Object.entries(SYNONYMS) as [Target, string[]][]) if (words.includes(h)) return target
    return null
  }
  const contains = (h: string): Target | null => {
    for (const [target, words] of Object.entries(SYNONYMS) as [Target, string[]][]) {
      if (words.some(w => w.length >= 5 && h.includes(w))) return target
    }
    return null
  }
  const guesses: (Target | null)[] = norm.map(h => (NAME_LIKE.has(h) ? null : exact(h) ?? contains(h)))
  const hasLast = guesses.includes('last_name')
  const hasFirst = guesses.includes('first_name')
  const nameLike: Target = hasLast ? 'first_name' : hasFirst ? 'last_name' : 'name'
  const used = new Set<Target>()
  return norm.map((h, i) => {
    let target = guesses[i] ?? (NAME_LIKE.has(h) ? nameLike : 'ignore')
    if (target !== 'ignore' && used.has(target)) target = 'ignore'  // a field is fed by one column
    used.add(target)
    return target
  })
}

async function parseFile(file: File): Promise<ParsedSheet[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]
    if (!ws['!ref']) return { name, header: [], rows: [] }
    // Read from A1 whatever the used range says, so `line` is the row number
    // the school sees in Excel.
    const range = XLSX.utils.decode_range(ws['!ref'])
    range.s.r = 0
    range.s.c = 0
    const matrix = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range })
    const filled = (cells: Cell[]) => cells.filter(c => cellText(c) !== '').length
    let headerIndex = matrix.findIndex(cells => filled(cells) >= 2)
    if (headerIndex < 0) headerIndex = matrix.findIndex(cells => filled(cells) >= 1)
    if (headerIndex < 0) return { name, header: [], rows: [] }
    const headerCells = matrix[headerIndex]
    const width = Math.max(headerCells.length, ...matrix.slice(headerIndex + 1).map(r => r.length))
    const header = Array.from({ length: width }, (_, i) => cellText(headerCells[i]))
    const rows: FileRow[] = []
    matrix.slice(headerIndex + 1).forEach((cells, i) => {
      if (filled(cells) > 0) rows.push({ line: headerIndex + i + 2, cells })
    })
    return { name, header, rows }
  })
}

type PayloadRow = { row: number } & Partial<Record<Exclude<Target, 'ignore' | 'skip_if_true'>, string>>

function buildRows(sheet: ParsedSheet, mapping: Target[]): { rows: PayloadRow[]; filtered: number } {
  const rows: PayloadRow[] = []
  let filtered = 0
  for (const fileRow of sheet.rows) {
    const values = fileRow.cells.map(cellText)
    if (mapping.some((t, i) => t === 'skip_if_true' && TRUTHY.has(normalize(values[i] ?? '')))) {
      filtered++
      continue
    }
    const row: PayloadRow = { row: fileRow.line }
    mapping.forEach((target, i) => {
      if (target === 'ignore' || target === 'skip_if_true') return
      const value = values[i] ?? ''
      if (!value) return
      if (target === 'date_of_birth') row[target] = dateValue(value)
      else if (target === 'language_preference') row[target] = LANGUAGE_WORDS[normalize(value)] ?? ''
      else row[target] = value
    })
    if (Object.keys(row).length > 1) rows.push(row)
  }
  return { rows, filtered }
}

type ResultRow = {
  row: number; email: string; name: string; phone: string; city: string; country: string
  date_of_birth: string | null; language_preference: string
  action: 'create' | 'enroll' | 'already_enrolled' | 'error'
  error: string; error_field: string; warnings: string[]; student_id: string | null
}
type ImportResult = {
  dry_run: boolean
  summary: { create: number; enroll: number; already_enrolled: number; error: number }
  rows: ResultRow[]
}

type Step = 'file' | 'mapping' | 'preview' | 'done'
const STEPS: Step[] = ['file', 'mapping', 'preview', 'done']

const ACTION_STYLE: Record<ResultRow['action'], string> = {
  create: 'bg-green-100 text-green-700',
  enroll: 'bg-blue-50 text-blue-700',
  already_enrolled: 'bg-gray-100 text-gray-500',
  error: 'bg-red-50 text-red-700',
}

export default function ImportStudentsModal({ onClose, onDone }: {
  onClose: () => void
  /** Called once the import is done, with the ids of the students it created or enrolled. */
  onDone?: (importedStudentIds: string[]) => void
}) {
  const t = useTranslations('school.studentsImport')
  const uiLocale = useLocale()

  const [step, setStep] = useState<Step>('file')
  const [error, setError] = useState<string | null>(null)

  // Step 1: file
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [parsing, setParsing] = useState(false)
  const sheet = sheets[sheetIndex]

  // Step 2: mapping + options
  const [mapping, setMapping] = useState<Target[]>([])
  const [language, setLanguage] = useState(uiLocale)
  // Default prefix for phone numbers without one: the school's own country
  const [phonePrefix, setPhonePrefix] = useState(DEFAULT_PREFIX)
  useEffect(() => {
    apiFetch<{ country_code?: string | null }>('/school/profile/')
      .then(p => { const code = dialCodeFor(p.country_code); if (code) setPhonePrefix(code) })
      .catch(() => {})
  }, [])

  // Step 3/4: server answers
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function loadFile(file: File) {
    setError(null)
    setParsing(true)
    try {
      const parsed = await parseFile(file)
      const first = parsed.findIndex(s => s.rows.length > 0)
      if (first < 0) {
        setError(t('emptyFile'))
        setSheets([])
        return
      }
      setFileName(file.name)
      setSheets(parsed)
      pickSheet(parsed, first)
    } catch {
      setError(t('parseError'))
      setSheets([])
    } finally {
      setParsing(false)
    }
  }

  function pickSheet(all: ParsedSheet[], index: number) {
    setSheetIndex(index)
    setMapping(guessTargets(all[index].header))
  }

  // Mapping checks: email once and required, a name column, no field fed twice
  const mappingErrors = useMemo(() => {
    const errors: string[] = []
    const count = (target: Target) => mapping.filter(m => m === target).length
    if (count('email') === 0) errors.push(t('mappingNeedEmail'))
    if (count('name') === 0 && count('first_name') === 0) errors.push(t('mappingNeedName'))
    for (const target of SINGLE_TARGETS) {
      if (count(target) > 1) errors.push(t('mappingDuplicate', { field: t(`target_${target}`) }))
    }
    return errors
  }, [mapping, t])

  const built = useMemo(() => (sheet ? buildRows(sheet, mapping) : { rows: [], filtered: 0 }), [sheet, mapping])

  async function runImport(dryRun: boolean): Promise<ImportResult> {
    return apiFetch<ImportResult>('/school/students/import/', {
      method: 'POST',
      body: JSON.stringify({ rows: built.rows, dry_run: dryRun, language_preference: language, phone_prefix: phonePrefix }),
    })
  }

  function describe(err: unknown): string {
    if (err instanceof ApiError && typeof err.body === 'object' && err.body && (err.body as { error?: string }).error === 'too_many_rows') {
      return t('tooManyRows', { max: (err.body as { max?: number }).max ?? 2000 })
    }
    return t('genericError')
  }

  // Entering the preview asks the server for the dry run
  useEffect(() => {
    if (step !== 'preview') return
    let cancelled = false
    setPreview(null)
    setPreviewLoading(true)
    setError(null)
    runImport(true)
      .then(res => { if (!cancelled) setPreview(res) })
      .catch(err => { if (!cancelled) setError(describe(err)) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmImport() {
    setImporting(true)
    setError(null)
    try {
      const res = await runImport(false)
      setResult(res)
      setStep('done')
      onDone?.(res.rows.filter(r => (r.action === 'create' || r.action === 'enroll') && r.student_id).map(r => r.student_id as string))
    } catch (err) {
      setError(describe(err))
    } finally {
      setImporting(false)
    }
  }

  const importable = preview ? preview.summary.create + preview.summary.enroll : 0
  const previewRows = (preview?.rows ?? []).filter(r => statusFilter.length === 0 || statusFilter.includes(r.action))

  function rowNotes(r: ResultRow) {
    const notes: string[] = []
    if (r.error) notes.push(r.error === 'too_long' ? t('error_too_long', { field: t(`target_${r.error_field}`) }) : t(`error_${r.error}`))
    for (const w of r.warnings) notes.push(t(`warning_${w}`))
    return notes.join(' · ') || '—'
  }

  const statusLabel = (r: ResultRow, final: boolean) =>
    final && r.action === 'create' ? t('status_created')
      : final && r.action === 'enroll' ? t('status_enrolled')
      : t(`status_${r.action}`)

  function renderTable(rows: ResultRow[], final: boolean) {
    return (
      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {[t('colRow'), t('colStatus'), t('colName'), t('colEmail'), t('colPhone'), t('colCity'), t('colCountry'), t('colBirth'), t('colLanguage'), t('colNotes')].map(h => (
                <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400 text-sm">{t('noRowsMatch')}</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.row} className={r.action === 'error' ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-2 text-gray-400 text-xs">{r.row}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${ACTION_STYLE[r.action]}`}>{statusLabel(r, final)}</span>
                </td>
                <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{r.name || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{r.email || '—'}</td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.phone || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{r.city || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{r.country ? countryName(r.country, uiLocale, r.country) : '—'}</td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                  {r.date_of_birth ? new Date(`${r.date_of_birth}T00:00:00`).toLocaleDateString(uiLocale) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{languageLabel(r.language_preference)}</td>
                <td className={`px-3 py-2 text-xs ${r.action === 'error' ? 'text-red-600' : 'text-gray-500'}`}>{rowNotes(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const stepLabel: Record<Step, string> = { file: t('stepFile'), mapping: t('stepMapping'), preview: t('stepPreview'), done: t('stepDone') }
  const btn = 'px-4 py-2 text-sm rounded-lg transition disabled:opacity-50'
  const btnSecondary = `${btn} border border-gray-200 text-gray-600 hover:bg-gray-50`
  const btnPrimary = `${btn} bg-[#6B1F3A] text-white hover:bg-[#581931]`
  const fieldCls = 'w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('title')}</h2>
            <ol className="flex items-center gap-2 mt-2 text-xs">
              {STEPS.map((s, i) => {
                const reached = STEPS.indexOf(step) >= i
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${reached ? 'bg-[#6B1F3A] text-white' : 'bg-gray-100 text-gray-400'}`}>{i + 1}</span>
                    <span className={reached ? 'text-gray-900 font-medium' : 'text-gray-400'}>{stepLabel[s]}</span>
                    {i < STEPS.length - 1 && <span className="text-gray-200">/</span>}
                  </li>
                )
              })}
            </ol>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label={t('close')}>×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          {step === 'file' && (
            <>
              <div
                onClick={() => fileInput.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f) }}
                className="border-2 border-dashed border-gray-200 rounded-2xl px-6 py-10 text-center cursor-pointer hover:border-[#6B1F3A]/40 hover:bg-[#6B1F3A]/5 transition"
              >
                <p className="text-sm text-gray-700">{parsing ? t('parsing') : t('dropHint')}</p>
                <p className="text-xs text-gray-400 mt-2">{t('fileTypes')}</p>
                <input
                  ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = '' }}
                />
              </div>
              {sheet && (
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-gray-700">{t('rowsFound', { count: sheet.rows.length, file: fileName })}</span>
                  {sheets.length > 1 && (
                    <label className="flex items-center gap-2 text-gray-600">
                      <span className="text-xs text-gray-500">{t('sheetLabel')}</span>
                      <select
                        value={sheetIndex}
                        onChange={e => pickSheet(sheets, Number(e.target.value))}
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                      >
                        {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length})</option>)}
                      </select>
                    </label>
                  )}
                  <button onClick={() => fileInput.current?.click()} className="text-xs text-[#6B1F3A] underline">{t('changeFile')}</button>
                </div>
              )}
            </>
          )}

          {step === 'mapping' && sheet && (
            <>
              <p className="text-sm text-gray-600">{t('columnsIntro')}</p>
              <div className="border border-gray-100 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colFileColumn')}</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colSample')}</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">{t('colTarget')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sheet.header.map((label, i) => {
                      const samples = sheet.rows.map(r => cellText(r.cells[i])).filter(Boolean).slice(0, 3)
                      const target = mapping[i] ?? 'ignore'
                      return (
                        <tr key={i} className={target === 'ignore' ? 'text-gray-400' : ''}>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{label || t('columnN', { n: i + 1 })}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">{samples.join(' · ') || '—'}</td>
                          <td className="px-3 py-2">
                            <select
                              value={target}
                              onChange={e => setMapping(m => m.map((v, j) => (j === i ? (e.target.value as Target) : v)))}
                              className={`border rounded-lg px-2 py-1.5 text-sm bg-white ${target === 'ignore' ? 'border-gray-200 text-gray-500' : 'border-[#6B1F3A]/40 text-gray-900'}`}
                            >
                              {TARGETS.map(opt => <option key={opt} value={opt}>{t(`target_${opt}`)}</option>)}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {mappingErrors.length > 0 && (
                <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                  {mappingErrors.map(m => <li key={m}>{m}</li>)}
                </ul>
              )}
              {built.filtered > 0 && <p className="text-xs text-gray-500">{t('summaryFiltered', { count: built.filtered })}</p>}

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">{t('optionsTitle')}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <LanguageSelect value={language} onChange={setLanguage} label={t('languageLabel')} hint={t('languageHint')} />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('phonePrefixLabel')}</label>
                    <select value={phonePrefix} onChange={e => setPhonePrefix(e.target.value)} className={fieldCls}>
                      {!PREFIXES.some(p => p.code === phonePrefix) && <option value={phonePrefix}>{phonePrefix}</option>}
                      {PREFIXES.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">{t('phonePrefixHint')}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{t('noEmailsNote')}</p>
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <p className="text-sm text-gray-600">{t('previewIntro')}</p>
              {previewLoading && <p className="text-sm text-gray-400 py-6 text-center">{t('previewLoading')}</p>}
              {preview && (
                <>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.create}`}>{t('summaryCreate', { count: preview.summary.create })}</span>
                    <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.enroll}`}>{t('summaryEnroll', { count: preview.summary.enroll })}</span>
                    <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.already_enrolled}`}>{t('summaryAlready', { count: preview.summary.already_enrolled })}</span>
                    <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.error}`}>{t('summaryError', { count: preview.summary.error })}</span>
                    {built.filtered > 0 && <span className="px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-500">{t('summaryFiltered', { count: built.filtered })}</span>}
                  </div>
                  <p className="text-xs text-gray-500">{t('noEmailsNote')}</p>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t('statusFilterLabel')}</p>
                    <MultiFilterSelect
                      label={t('statusFilterLabel')}
                      options={(['create', 'enroll', 'already_enrolled', 'error'] as const).map(a => ({ value: a, label: t(`status_${a}`) }))}
                      selected={statusFilter}
                      onChange={setStatusFilter}
                    />
                  </div>
                  {renderTable(previewRows, false)}
                </>
              )}
            </>
          )}

          {step === 'done' && result && (
            <>
              <h3 className="text-base font-semibold text-gray-900">{t('doneTitle')}</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.create}`}>{t('doneCreated', { count: result.summary.create })}</span>
                <span className={`px-2.5 py-1 rounded-full font-medium ${ACTION_STYLE.enroll}`}>{t('doneEnrolled', { count: result.summary.enroll })}</span>
                <span className="px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-500">{t('doneSkipped', { count: result.summary.already_enrolled + result.summary.error + built.filtered })}</span>
              </div>
              {result.summary.create + result.summary.enroll > 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">✉ {t('doneHint')}</p>
              )}
              {renderTable(result.rows, true)}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <div>
            {step === 'mapping' && <button onClick={() => setStep('file')} className={btnSecondary}>{t('back')}</button>}
            {step === 'preview' && <button onClick={() => setStep('mapping')} disabled={importing} className={btnSecondary}>{t('back')}</button>}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'done' && <button onClick={onClose} disabled={importing} className={btnSecondary}>{t('cancel')}</button>}
            {step === 'file' && (
              <button onClick={() => setStep('mapping')} disabled={!sheet || parsing} className={btnPrimary}>{t('next')}</button>
            )}
            {step === 'mapping' && (
              <button onClick={() => setStep('preview')} disabled={mappingErrors.length > 0 || built.rows.length === 0} className={btnPrimary}>{t('next')}</button>
            )}
            {step === 'preview' && (
              importable > 0 ? (
                <button onClick={confirmImport} disabled={!preview || importing} className={btnPrimary}>
                  {importing ? t('importing') : t('confirmImport', { count: importable })}
                </button>
              ) : preview ? (
                <span className="text-xs text-gray-500">{t('nothingToImport')}</span>
              ) : null
            )}
            {step === 'done' && <button onClick={onClose} className={btnPrimary}>{t('close')}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
