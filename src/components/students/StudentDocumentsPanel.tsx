'use client'

import { useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { DOC_ACCEPT, type DocFile, type DocStatus } from '@/lib/documents'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'

export type PanelDoc = {
  id: string
  school_id?: string
  type_id: string | null
  variant: string | null
  files: DocFile[] | null
  file_url: string | null
  expires_at: string | null
  status: DocStatus
  validated_at: string | null
  note: string | null
}

export type PanelType = {
  id: string
  name: string
  variants: string[]
  has_expiry: boolean
  required: boolean
}

export type PanelSchool = { id: string; name: string; types: PanelType[] }

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-600',
}

const toDateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

// Elenco documenti: stesso componente nel profilo dell'allieva e nella scheda
// vista dalla scuola. Con `canManage` compaiono in più la data di scadenza e
// le azioni approva / rifiuta / segnala.
export default function StudentDocumentsPanel({
  schools,
  documents,
  onReload,
  canManage = false,
  studentId,
}: {
  schools: PanelSchool[]
  documents: PanelDoc[]
  onReload: () => void | Promise<void>
  canManage?: boolean
  /** Necessario quando carica la scuola per conto dell'allieva */
  studentId?: string
}) {
  const t = useTranslations('student.profile')
  const tManage = useTranslations('school.studentSheet')
  const uiLocale = useLocale()

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [variantByType, setVariantByType] = useState<Record<string, string>>({})
  const [flagging, setFlagging] = useState<string | null>(null)
  const [flagNote, setFlagNote] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  const pending = useRef<{ typeId: string; variants: string[] } | null>(null)

  function triggerUpload(typeId: string, variants: string[]) {
    pending.current = { typeId, variants }
    setError(null)
    fileRef.current?.click()
  }

  // Un PDF oppure più immagini (es. fronte e retro)
  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const target = pending.current
    if (!files.length || !target) return

    setBusy(target.typeId)
    const body = new FormData()
    body.append('type_id', target.typeId)
    if (canManage && studentId) body.append('student_id', studentId)
    if (target.variants.length) body.append('variant', variantByType[target.typeId] ?? target.variants[0])
    files.forEach(f => body.append('files', f))

    const res = await fetch('/api/documents/upload', { method: 'POST', body })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const messages: Record<string, string> = {
        pdf_alone: t('uploadPdfAlone'),
        too_many: t('uploadTooMany'),
        too_large: t('uploadTooLarge'),
        invalid_type: t('uploadInvalidType'),
      }
      setError(messages[data.error] ?? t('uploadFailed'))
    }
    await onReload()
    setBusy(null)
    pending.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  // Rimozione: l'allieva può togliere solo un documento non ancora approvato,
  // così la scuola non resta senza la copia buona.
  async function removeDoc(docId: string) {
    setBusy(docId)
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error === 'approved_locked' ? t('deleteApprovedLocked') : t('deleteFailed'))
    }
    await onReload()
    setBusy(null)
  }

  async function act(docId: string, body: Record<string, unknown>) {
    setBusy(docId)
    await fetch(`/api/school/documents/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await onReload()
    setBusy(null)
    setFlagging(null)
    setFlagNote('')
  }

  if (schools.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
        {t('notEnrolled')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <input ref={fileRef} type="file" multiple accept={DOC_ACCEPT} className="hidden" onChange={handleFiles} />

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <p className="text-xs text-gray-400">{t('uploadHint')}</p>

      {schools.map(school => (
        <div key={school.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {school.name && (
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">{school.name}</p>
            </div>
          )}

          {school.types.length === 0 ? (
            <p className="px-5 py-4 text-xs text-gray-400">{t('noDocumentsRequested')}</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {school.types.map(type => {
                const doc = documents.find(d => d.type_id === type.id && (!d.school_id || d.school_id === school.id))
                const count = doc ? (doc.files?.length || (doc.file_url ? 1 : 0)) : 0
                return (
                  <div key={type.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          {type.name}
                          {type.required && <span className="ml-1.5 text-xs text-red-500">*</span>}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {doc ? (
                            <>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[doc.status]}`}>
                                {t(`docStatus.${doc.status}` as Parameters<typeof t>[0])}
                              </span>
                              {doc.variant && <span className="text-xs text-gray-500">{doc.variant}</span>}
                              {doc.expires_at && (
                                <span className="text-xs text-gray-400">
                                  {t('docExpires', { date: new Date(doc.expires_at).toLocaleDateString(uiLocale, { day: '2-digit', month: 'short', year: 'numeric' }) })}
                                </span>
                              )}
                              {!doc.validated_at && <span className="text-xs text-amber-600">{t('pendingReview')}</span>}
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">{t('notUploaded')}</span>
                          )}
                        </div>

                        {/* Allegati: nome del file, link firmato valido pochi minuti */}
                        {doc && count > 0 && (
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {Array.from({ length: count }).map((_, i) => (
                              <a
                                key={i}
                                href={`/api/documents/${doc.id}/file?i=${i}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-brand hover:underline"
                              >
                                {doc.files?.[i]?.name ?? `${t('view')} ${count > 1 ? i + 1 : ''}`.trim()}
                              </a>
                            ))}
                          </div>
                        )}

                        {doc?.note && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-2">
                            {doc.note}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {type.variants.length > 0 && (
                          <select
                            value={variantByType[type.id] ?? doc?.variant ?? type.variants[0]}
                            onChange={e => setVariantByType(v => ({ ...v, [type.id]: e.target.value }))}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                          >
                            {type.variants.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        )}
                        <button
                          onClick={() => triggerUpload(type.id, type.variants)}
                          disabled={busy === type.id}
                          className="text-xs bg-brand text-white px-3 py-1.5 rounded-lg hover:bg-brand-hover transition disabled:opacity-50"
                        >
                          {busy === type.id ? t('uploading') : doc ? t('replace') : t('upload')}
                        </button>

                        {/* Approvato: solo la scuola può rimuoverlo */}
                        {doc && (canManage || !doc.validated_at) && (
                          <ConfirmDeleteButton
                            label={t('remove')}
                            armedLabel={t('removeConfirm')}
                            onDelete={() => removeDoc(doc.id)}
                          />
                        )}
                      </div>
                    </div>

                    {/* Solo scuola/HQ: scadenza e valutazione del documento */}
                    {canManage && doc && (
                      <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-gray-100">
                        {type.has_expiry && (
                          <label className="flex items-center gap-2 text-xs text-gray-500">
                            {tManage('expiryLabel')}
                            <input
                              type="date"
                              value={toDateInput(doc.expires_at)}
                              disabled={busy === doc.id}
                              onChange={e => act(doc.id, {
                                action: 'expiry',
                                expires_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null,
                              })}
                              className="border border-gray-200 rounded px-2 py-1"
                            />
                          </label>
                        )}

                        <div className="flex items-center gap-3 ml-auto">
                          <button onClick={() => act(doc.id, { action: 'validate' })} disabled={busy === doc.id}
                            className="text-xs text-green-600 hover:text-green-800 disabled:opacity-50">
                            {tManage('approve')}
                          </button>
                          <button onClick={() => act(doc.id, { action: 'reject' })} disabled={busy === doc.id}
                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">
                            {tManage('reject')}
                          </button>
                          <button onClick={() => { setFlagging(flagging === doc.id ? null : doc.id); setFlagNote(doc.note ?? '') }}
                            className="text-xs text-amber-600 hover:text-amber-800">
                            {tManage('flag')}
                          </button>
                        </div>

                        {/* Segnala: nota che l'allieva vede sotto al documento */}
                        {flagging === doc.id && (
                          <div className="w-full flex items-center gap-2">
                            <input
                              value={flagNote}
                              onChange={e => setFlagNote(e.target.value)}
                              placeholder={tManage('flagPlaceholder')}
                              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2"
                            />
                            <button onClick={() => act(doc.id, { action: 'flag', note: flagNote })}
                              disabled={busy === doc.id}
                              className="text-xs bg-amber-500 text-white px-3 py-2 rounded-lg hover:bg-amber-600 disabled:opacity-50">
                              {tManage('flagSend')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
