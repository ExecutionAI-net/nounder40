// Documenti allieve: tipi definiti dalla scuola, allegati multipli, scadenze.

/** Allegato salvato nel bucket privato `documents` (si firma al momento) */
export type DocFile = { path: string; name: string; mime: string; size: number }

export type SchoolDocumentType = {
  id: string
  school_id: string
  code: string
  name: string
  /** Scelte ammesse per lo stesso tipo, es. Carta d'identità / Passaporto */
  variants: string[]
  has_expiry: boolean
  required: boolean
  sort_order: number
  active: boolean
}

export type DocStatus = 'valid' | 'expiring' | 'expired'

export type StudentDocument = {
  id: string
  school_id: string
  type: string
  type_id: string | null
  variant: string | null
  files: DocFile[] | null
  /** Documenti caricati prima degli allegati multipli */
  file_url: string | null
  uploaded_at: string | null
  expires_at: string | null
  status: DocStatus
  validated_at: string | null
  note: string | null
}

export const DOC_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const DOC_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_DOC_FILES = 6
const MAX_DOC_SIZE = 10 * 1024 * 1024 // 10MB per file

const EXPIRING_WINDOW = 30 * 24 * 60 * 60 * 1000

/** Stato calcolato dalla scadenza (in scadenza = entro 30 giorni). */
export function docStatus(doc: { expires_at: string | null; status?: string }): DocStatus {
  if (!doc.expires_at) return (doc.status as DocStatus) ?? 'valid'
  const remaining = new Date(doc.expires_at).getTime() - Date.now()
  if (remaining < 0) return 'expired'
  if (remaining < EXPIRING_WINDOW) return 'expiring'
  return 'valid'
}

/** Un PDF esclude altri allegati: o un documento unico, o più immagini. */
export function validateUploadSet(files: { type: string; size: number }[]): string | null {
  if (files.length === 0) return 'no_files'
  if (files.length > MAX_DOC_FILES) return 'too_many'
  if (files.some(f => !DOC_ALLOWED_MIME.includes(f.type))) return 'invalid_type'
  if (files.some(f => f.size > MAX_DOC_SIZE)) return 'too_large'
  const pdfs = files.filter(f => f.type === 'application/pdf').length
  if (pdfs > 0 && files.length > 1) return 'pdf_alone'
  return null
}
