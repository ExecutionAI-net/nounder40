// Reusable export utilities for XLS and PDF
// Dependencies: xlsx, jspdf, jspdf-autotable

export type ExportColumn = {
  header: string
  key: string
  width?: number // for xlsx column width
}

export type ExportRow = Record<string, string | number | null | undefined>

// ─── XLSX ───────────────────────────────────────────────────────────────────

export async function exportXLS(
  columns: ExportColumn[],
  rows: ExportRow[],
  filename: string
) {
  const XLSX = await import('xlsx')

  const worksheetData = [
    columns.map(c => c.header),
    ...rows.map(row => columns.map(c => row[c.key] ?? '')),
  ]

  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

  // Column widths
  worksheet['!cols'] = columns.map(c => ({ wch: c.width ?? 20 }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Data')
  XLSX.writeFile(workbook, `${filename}.xlsx`)
}

// ─── PDF ────────────────────────────────────────────────────────────────────

export async function exportPDF(
  columns: ExportColumn[],
  rows: ExportRow[],
  filename: string,
  title?: string
) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  if (title) {
    doc.setFontSize(14)
    doc.setTextColor(40)
    doc.text(title, 14, 16)
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text(`Exported: ${new Date().toLocaleDateString('en-GB')}`, 14, 22)
  }

  autoTable(doc, {
    startY: title ? 28 : 14,
    head: [columns.map(c => c.header)],
    body: rows.map(row => columns.map(c => String(row[c.key] ?? ''))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`${filename}.pdf`)
}
