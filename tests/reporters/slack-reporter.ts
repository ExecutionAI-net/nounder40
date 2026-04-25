/**
 * Slack reporter — posts a run summary to SLACK_WEBHOOK_URL on finish.
 *
 * Wire up in playwright.config.ts:
 *   reporter: [
 *     ['html'],
 *     ['./tests/reporters/slack-reporter.ts'],
 *   ]
 *
 * Silently no-ops if SLACK_WEBHOOK_URL is not set — so local runs stay quiet.
 *
 * Report link strategy:
 *   - If PLAYWRIGHT_REPORT_URL env var is set, it's used as-is (point to a
 *     published report, e.g. Vercel / Netlify / GitHub Pages).
 *   - Else if running in GitHub Actions, link to the workflow run page so
 *     the user can download the report artifact.
 *   - Else (local dev), include a reminder to run `npm run test:e2e:report`.
 */

import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'

function secondsToReadable(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

function reportLink(): { text: string; url?: string } {
  const explicit = process.env.PLAYWRIGHT_REPORT_URL
  if (explicit) return { text: 'View full report', url: explicit }

  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server && repo && runId) {
    return {
      text: 'Open Actions run (download `playwright-report` artifact)',
      url: `${server}/${repo}/actions/runs/${runId}`,
    }
  }

  return { text: 'Run `npm run test:e2e:report` locally to view the HTML report' }
}

export default class SlackReporter implements Reporter {
  private passed = 0
  private failed = 0
  private skipped = 0
  private flaky = 0
  private failedTests: Array<{ title: string; project: string; error: string }> = []
  private startedAt = Date.now()

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? 'default'
    const fullTitle = test.titlePath().slice(1).join(' › ')

    if (result.status === 'passed') {
      this.passed++
    } else if (result.status === 'skipped') {
      this.skipped++
    } else if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
      this.failed++
      this.failedTests.push({
        title: fullTitle,
        project,
        error: (result.error?.message ?? '').split('\n')[0].slice(0, 200),
      })
    }
    if (result.retry > 0 && result.status === 'passed') this.flaky++
  }

  async onEnd(result: FullResult) {
    const webhook = process.env.SLACK_WEBHOOK_URL
    if (!webhook) return

    const duration = secondsToReadable(Math.round((Date.now() - this.startedAt) / 1000))
    const total = this.passed + this.failed + this.skipped
    const icon =
      result.status === 'passed' ? ':white_check_mark:' :
      result.status === 'failed' ? ':x:' :
      ':warning:'

    const branch = process.env.GITHUB_REF_NAME ?? process.env.BRANCH ?? 'local'
    const repo = process.env.GITHUB_REPOSITORY ?? 'No Under 40'
    const link = reportLink()

    // Slack Block Kit — renders as a compact card with headline, stats, and link
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${icon} *Playwright — ${repo}* _(${branch})_`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total*\n${total}` },
          { type: 'mrkdwn', text: `*Duration*\n${duration}` },
          { type: 'mrkdwn', text: `*:white_check_mark: Passed*\n${this.passed}` },
          { type: 'mrkdwn', text: `*:x: Failed*\n${this.failed}` },
          { type: 'mrkdwn', text: `*:next_track_button: Skipped*\n${this.skipped}` },
          { type: 'mrkdwn', text: `*:repeat: Flaky*\n${this.flaky}` },
        ],
      },
    ]

    if (this.failed > 0) {
      const rows = this.failedTests.slice(0, 10).map(t =>
        `• \`[${t.project}]\` ${t.title}${t.error ? `\n    _${t.error}_` : ''}`
      )
      const overflow = this.failedTests.length - rows.length
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed tests:*\n${rows.join('\n')}${overflow > 0 ? `\n… and ${overflow} more` : ''}`,
        },
      })
    }

    // Report link — as a button if we have a URL, otherwise as text
    if (link.url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: this.failed > 0 ? 'danger' : 'primary',
            text: { type: 'plain_text', text: link.text },
            url: link.url,
          },
        ],
      })
    } else {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `:information_source: ${link.text}` },
        ],
      })
    }

    // Fallback `text` for notifications + older Slack clients
    const fallback = `${icon} Playwright: ${this.passed}/${total} passed, ${this.failed} failed (${duration})`

    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fallback, blocks }),
      })
      if (!res.ok) {
        console.error('[slack-reporter] webhook responded', res.status, await res.text())
      }
    } catch (err) {
      console.error('[slack-reporter] failed to POST:', (err as Error).message)
    }
  }
}
