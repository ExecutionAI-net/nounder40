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
 */

import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'

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

    const duration = Math.round((Date.now() - this.startedAt) / 1000)
    const total = this.passed + this.failed + this.skipped
    const icon =
      result.status === 'passed' ? ':white_check_mark:' :
      result.status === 'failed' ? ':x:' :
      ':warning:'

    const branch = process.env.GITHUB_REF_NAME ?? process.env.BRANCH ?? 'local'
    const project = process.env.GITHUB_REPOSITORY ?? 'No Under 40'

    const lines: string[] = [
      `${icon}  *Playwright — ${project}* _(${branch})_`,
      `Total ${total}  •  ✅ ${this.passed}  •  ❌ ${this.failed}  •  ⏭ ${this.skipped}` +
        (this.flaky ? `  •  🔁 ${this.flaky} flaky` : '') +
        `  •  ⏱ ${duration}s`,
    ]

    if (this.failed > 0) {
      lines.push(`\n*Failed (showing up to 10):*`)
      for (const t of this.failedTests.slice(0, 10)) {
        lines.push(`• \`[${t.project}]\` ${t.title}${t.error ? ` — _${t.error}_` : ''}`)
      }
      if (this.failedTests.length > 10) {
        lines.push(`… and ${this.failedTests.length - 10} more`)
      }
    }

    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lines.join('\n') }),
      })
    } catch (err) {
      // Don't break the test run if Slack is unreachable
      console.error('[slack-reporter] failed to POST:', (err as Error).message)
    }
  }
}
