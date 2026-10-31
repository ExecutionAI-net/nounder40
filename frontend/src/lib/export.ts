import { formatDate } from '@/lib/format-date'
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

// Extras for a report table (School › Reports › Lessons, Carlo 2026-10-31):
// a totals row under the header on every page (like the screen), right-aligned
// numbers, a second caption line with the period, and the merged-lesson rows
// styled like the screen.
export type PdfRowStyle = {
  fillColor?: [number, number, number]
  textColor?: number | [number, number, number]
  fontStyle?: 'normal' | 'bold' | 'italic'
}
export type PdfOptions = {
  caption?: string
  totals?: ExportRow
  align?: Record<string, 'left' | 'right' | 'center'>
  rowStyle?: (rowIndex: number) => PdfRowStyle | undefined
}

export async function exportPDF(
  columns: ExportColumn[],
  rows: ExportRow[],
  filename: string,
  title?: string,
  exportedLine?: string,
  opts: PdfOptions = {},
) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  let startY = 14
  if (title) {
    doc.setFontSize(14)
    doc.setTextColor(40)
    doc.text(title, 14, 16)
    doc.setFontSize(9)
    doc.setTextColor(120)
    // I18N-R3-09: "Exported:" and en-GB were hardcoded, so an Italian
    // school's PDF carried an English caption. The caller passes its own
    // translated line; the fallback keeps the old text for any caller that
    // has not been updated.
    doc.text(exportedLine ?? `Exported: ${formatDate(new Date())}`, 14, 22)
    startY = 28
    if (opts.caption) {
      doc.text(opts.caption, 14, 27)
      startY = 33
    }
  }

  // Twenty columns on a landscape A4 only fit at the smaller size
  const fontSize = columns.length > 14 ? 7 : 8
  const cell = (row: ExportRow, c: ExportColumn) => String(row[c.key] ?? '')

  const head = [columns.map(c => c.header)]
  const totals = opts.totals
  if (totals) head.push(columns.map(c => cell(totals, c)))

  autoTable(doc, {
    startY,
    head,
    body: rows.map(row => columns.map(c => cell(row, c))),
    showHead: 'everyPage',
    styles: { fontSize, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
    didParseCell: data => {
      // halign through the hook, not columnStyles: it must reach the head
      // and the totals row too, so a money column lines up top to bottom
      const align = opts.align?.[columns[data.column.index]?.key]
      if (align) data.cell.styles.halign = align
      // the totals row is the second header row: grey, dark text
      if (data.section === 'head' && data.row.index === 1) {
        data.cell.styles.fillColor = [229, 231, 235]
        data.cell.styles.textColor = 40
      }
      if (data.section === 'body' && opts.rowStyle) {
        const style = opts.rowStyle(data.row.index)
        if (style) Object.assign(data.cell.styles, style)
      }
    },
  })

  doc.save(`${filename}.pdf`)
}

// ─── PDF of a table given by position ───────────────────────────────────────

// What a report page holds once it has flattened its visible columns: the
// headers, each row's cells in the same order, a totals row, and which
// positions hold numbers (right-aligned). Wraps exportPDF, which wants keyed
// rows, so the two report tables (School › Reports › Lessons, HQ › Shop ›
// Sales) share the plumbing.
export type PositionalTable = {
  headers: string[]
  rows: (string | number)[][]
  totals?: (string | number)[]
  right?: boolean[]
}

export async function exportTablePDF(
  table: PositionalTable,
  filename: string,
  title: string,
  exportedLine: string,
  opts: Omit<PdfOptions, 'totals' | 'align'> = {},
) {
  const columns: ExportColumn[] = table.headers.map((header, i) => ({ header, key: String(i) }))
  const keyed = (cells: (string | number)[]): ExportRow => Object.fromEntries(cells.map((v, i) => [String(i), v]))
  const align: Record<string, 'right'> = {}
  table.right?.forEach((isRight, i) => { if (isRight) align[String(i)] = 'right' })
  await exportPDF(columns, table.rows.map(keyed), filename, title, exportedLine, {
    ...opts,
    totals: table.totals ? keyed(table.totals) : undefined,
    align,
  })
}
