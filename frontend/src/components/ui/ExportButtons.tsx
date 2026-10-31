'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Tooltip from '@/components/ui/Tooltip'

// "Export CSV" and "Print PDF" for a report table. The labels are shared; the
// tooltips are the caller's, since they say what goes out (how many rows).
// The buttons run the export themselves: busy while it runs, and a failure
// (the PDF library chunk missing after a deploy, the browser offline) says so
// next to them instead of dying in the console.
export default function ExportButtons({ onCSV, onPDF, csvTooltip, pdfTooltip }: {
  onCSV: () => void | Promise<void>
  onPDF: () => void | Promise<void>
  csvTooltip: string
  pdfTooltip: string
}) {
  const t = useTranslations('tableTools')
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)
  const [failed, setFailed] = useState(false)
  const run = (kind: 'csv' | 'pdf', fn: () => void | Promise<void>) => async () => {
    setBusy(kind)
    setFailed(false)
    try {
      await fn()
    } catch {
      setFailed(true)
    } finally {
      setBusy(null)
    }
  }
  const cls = 'text-sm text-[#6B1F3A] border border-[#6B1F3A]/30 px-3 py-1.5 rounded-lg hover:bg-[#6B1F3A]/5 transition disabled:opacity-50'
  return (
    <>
      {failed && <span role="alert" className="text-xs text-red-600">{t('exportFailed')}</span>}
      <Tooltip align="right" text={csvTooltip}>
        <button type="button" onClick={run('csv', onCSV)} disabled={busy !== null} className={cls}>
          {t('exportCSV')}{busy === 'csv' ? '…' : ''}
        </button>
      </Tooltip>
      <Tooltip align="right" text={pdfTooltip}>
        <button type="button" onClick={run('pdf', onPDF)} disabled={busy !== null} className={cls}>
          {t('exportPDF')}{busy === 'pdf' ? '…' : ''}
        </button>
      </Tooltip>
    </>
  )
}
