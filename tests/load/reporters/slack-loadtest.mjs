#!/usr/bin/env node
/**
 * Posts a k6 summary to Slack via Block Kit.
 *
 * Reads a k6 JSON summary file (--summary <path>), formats key metrics,
 * and POSTs to SLACK_WEBHOOK_URL. Designed to be called from CI after a
 * `k6 run --summary-export <file>` invocation.
 *
 * Usage:
 *   node tests/load/reporters/slack-loadtest.mjs \
 *     --summary tests/load/results/booking-race.json \
 *     --scenario "Booking race" \
 *     --status pass
 */

import { readFileSync, existsSync } from 'node:fs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const summaryPath = arg('summary')
const scenario = arg('scenario', 'Load test')
const status = arg('status', 'pass')
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : null

if (!summaryPath || !existsSync(summaryPath)) {
  console.error(`Summary file not found: ${summaryPath}`)
  process.exit(1)
}
if (!process.env.SLACK_WEBHOOK_URL) {
  console.error('SLACK_WEBHOOK_URL not set — skipping')
  process.exit(0)
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
const m = summary.metrics ?? {}

function metric(key) {
  return m[key]?.values ?? {}
}

const httpReqs = metric('http_reqs').count ?? 0
const httpFailRate = (metric('http_req_failed').rate ?? 0) * 100
const reqP95 = metric('http_req_duration')['p(95)'] ?? 0
const reqAvg = metric('http_req_duration').avg ?? 0
const vus = metric('vus_max').max ?? 0

const emoji = status === 'pass' ? ':white_check_mark:' : ':x:'
const color = status === 'pass' ? '#22c55e' : '#ef4444'

const blocks = [
  {
    type: 'header',
    text: { type: 'plain_text', text: `${emoji} k6 — ${scenario}` },
  },
  {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Requests*\n${httpReqs.toLocaleString()}` },
      { type: 'mrkdwn', text: `*Fail rate*\n${httpFailRate.toFixed(2)}%` },
      { type: 'mrkdwn', text: `*p95 latency*\n${reqP95.toFixed(0)} ms` },
      { type: 'mrkdwn', text: `*avg latency*\n${reqAvg.toFixed(0)} ms` },
      { type: 'mrkdwn', text: `*Max VUs*\n${vus}` },
      { type: 'mrkdwn', text: `*Status*\n${status.toUpperCase()}` },
    ],
  },
]

const customMetrics = ['booking_success', 'booking_rejected', 'booking_overflow_5xx', 'login_success']
const extraFields = []
for (const k of customMetrics) {
  if (m[k]) {
    const v = m[k].values
    const label = v.count !== undefined ? `${v.count}` : `${(v.rate * 100).toFixed(2)}%`
    extraFields.push({ type: 'mrkdwn', text: `*${k}*\n${label}` })
  }
}
if (extraFields.length) {
  blocks.push({ type: 'section', fields: extraFields })
}

if (runUrl) {
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', text: { type: 'plain_text', text: 'View run' }, url: runUrl, style: 'primary' },
    ],
  })
}

const payload = {
  attachments: [{ color, blocks }],
}

const res = await fetch(process.env.SLACK_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

if (!res.ok) {
  console.error(`Slack post failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.error('Slack notified.')
