#!/usr/bin/env node
/**
 * Walk tests/e2e/*.spec.ts, pull every test()/test.skip()/test.describe() call,
 * and emit a single xlsx file grouped by suite.
 *
 * Usage:  node scripts/export-test-catalog.mjs  [out.xlsx]
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, relative, sep } from 'path'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const TESTS_DIR = join(ROOT, 'tests', 'e2e')
const OUT = process.argv[2] ?? join(ROOT, 'test-catalog.xlsx')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (/\.(spec|setup)\.ts$/.test(entry)) out.push(p)
  }
  return out
}

/**
 * Naive parser: walks the file by line order, tracks describe() blocks by
 * brace depth, and records every test(...)/test.skip(...) call with its
 * enclosing describes as the "context".
 */
function extractTests(filePath) {
  const src = readFileSync(filePath, 'utf8')
  const lines = src.split('\n')

  const results = []
  const describeStack = []  // stack of { name, depth }
  let depth = 0

  function extractString(line, callPrefix) {
    const idx = line.indexOf(callPrefix)
    if (idx < 0) return null
    const rest = line.slice(idx + callPrefix.length)
    // Match the first string argument in single, double, or template quote
    const m = rest.match(/^\s*[(`]?[`'"]([^`'"]*)[`'"]/)
    if (m) return m[1]
    // Template literal with expressions — capture raw
    const m2 = rest.match(/^\s*\(\s*`([^`]*)`/)
    if (m2) return m2[1].replace(/\$\{[^}]+\}/g, '<var>')
    return null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Count brace depth on this line (crude but enough for our files)
    const open = (line.match(/\{/g) || []).length
    const close = (line.match(/\}/g) || []).length

    // Pop describes whose scope has just ended
    while (describeStack.length > 0 && depth <= describeStack[describeStack.length - 1].depth) {
      // only pop if we're definitely below the recorded depth
      if (depth < describeStack[describeStack.length - 1].depth) {
        describeStack.pop()
      } else {
        break
      }
    }

    // test.describe
    let m = line.match(/test\.describe\s*\(\s*[`'"]([^`'"]*)[`'"]/)
    if (m) {
      describeStack.push({ name: m[1], depth })
    }

    // test(...) / setup(...)
    for (const callPrefix of ['setup(', 'test(', 'test.skip(', 'test.only(']) {
      if (line.includes(callPrefix)) {
        const name = extractString(line, callPrefix)
        if (name) {
          const isSkip = callPrefix === 'test.skip('
          results.push({
            describe: describeStack.map(d => d.name).join(' › '),
            name,
            skipped: isSkip,
          })
          break
        }
      }
    }

    depth += open - close
  }

  return results
}

const files = walk(TESTS_DIR)
const rows = []

for (const filePath of files.sort()) {
  const rel = relative(ROOT, filePath).split(sep).join('/')
  const parts = rel.split('/')
  // tests/e2e/<suite>/<file.spec.ts>  OR  tests/e2e/<file.spec.ts>
  const suite = parts[2].includes('.') ? 'setup' : parts[2]
  const file = parts[parts.length - 1]

  const tests = extractTests(filePath)
  for (const t of tests) {
    rows.push({
      Suite: suite,
      File: file,
      Describe: t.describe,
      Test: t.name,
      Status: t.skipped ? 'skipped' : 'active',
      Path: rel,
    })
  }
}

// Sort by suite, then file, then describe
const SUITE_ORDER = ['setup', 'auth', 'hq', 'school', 'teacher', 'student', 'journeys', 'cross-cutting']
rows.sort((a, b) => {
  const sa = SUITE_ORDER.indexOf(a.Suite)
  const sb = SUITE_ORDER.indexOf(b.Suite)
  if (sa !== sb) return (sa < 0 ? 999 : sa) - (sb < 0 ? 999 : sb)
  if (a.File !== b.File) return a.File.localeCompare(b.File)
  if (a.Describe !== b.Describe) return a.Describe.localeCompare(b.Describe)
  return a.Test.localeCompare(b.Test)
})

console.log(`Collected ${rows.length} tests across ${files.length} files\n`)

// Summary per suite
const perSuite = {}
for (const r of rows) perSuite[r.Suite] = (perSuite[r.Suite] ?? 0) + 1
console.log('Tests per suite:')
for (const s of SUITE_ORDER) {
  if (perSuite[s]) console.log(`  ${s.padEnd(15)} ${perSuite[s]}`)
}

// Build workbook: one master sheet + one sheet per suite
const wb = XLSX.utils.book_new()

// Master "All" sheet
const allSheet = XLSX.utils.json_to_sheet(rows, {
  header: ['Suite', 'File', 'Describe', 'Test', 'Status', 'Path'],
})
allSheet['!cols'] = [
  { wch: 14 }, { wch: 36 }, { wch: 50 }, { wch: 72 }, { wch: 10 }, { wch: 60 },
]
XLSX.utils.book_append_sheet(wb, allSheet, 'All tests')

// Summary sheet
const summaryRows = []
let total = 0
let totalSkipped = 0
for (const s of SUITE_ORDER) {
  const suiteRows = rows.filter(r => r.Suite === s)
  if (!suiteRows.length) continue
  const skipped = suiteRows.filter(r => r.Status === 'skipped').length
  summaryRows.push({
    Suite: s,
    'Test count': suiteRows.length,
    Active: suiteRows.length - skipped,
    Skipped: skipped,
    Files: new Set(suiteRows.map(r => r.File)).size,
  })
  total += suiteRows.length
  totalSkipped += skipped
}
summaryRows.push({
  Suite: 'TOTAL',
  'Test count': total,
  Active: total - totalSkipped,
  Skipped: totalSkipped,
  Files: new Set(rows.map(r => r.File)).size,
})
const sumSheet = XLSX.utils.json_to_sheet(summaryRows)
sumSheet['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }]
XLSX.utils.book_append_sheet(wb, sumSheet, 'Summary')

// One sheet per suite
for (const s of SUITE_ORDER) {
  const suiteRows = rows.filter(r => r.Suite === s)
  if (!suiteRows.length) continue
  const sheet = XLSX.utils.json_to_sheet(
    suiteRows.map(r => ({
      File: r.File,
      Describe: r.Describe,
      Test: r.Test,
      Status: r.Status,
    })),
    { header: ['File', 'Describe', 'Test', 'Status'] }
  )
  sheet['!cols'] = [{ wch: 36 }, { wch: 50 }, { wch: 72 }, { wch: 10 }]
  // Sheet names must be ≤31 chars and avoid some special chars
  const name = s.slice(0, 31)
  XLSX.utils.book_append_sheet(wb, sheet, name)
}

const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
writeFileSync(OUT, buf)
console.log(`\n✅ Wrote ${OUT}`)
