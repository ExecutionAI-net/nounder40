'use client'

import { useEffect, useState, useCallback } from 'react'

const LOCALES = ['en', 'it', 'es', 'fr', 'de'] as const
type Locale = typeof LOCALES[number]

const LOCALE_LABELS: Record<Locale, string> = {
  en: '🇬🇧 EN', it: '🇮🇹 IT', es: '🇪🇸 ES', fr: '🇫🇷 FR', de: '🇩🇪 DE',
}

const TEMPLATE_KEYS = [
  { key: 'student.welcome',               label: 'Welcome',                  group: 'Student', icon: '👋' },
  { key: 'student.booking_confirmed',     label: 'Booking Confirmed',        group: 'Student', icon: '✅' },
  { key: 'student.booking_cancelled',     label: 'Booking Cancelled',        group: 'Student', icon: '❌' },
  { key: 'student.lesson_cancelled_by_school', label: 'Lesson Cancelled by School', group: 'Student', icon: '🚫' },
  { key: 'student.lesson_reminder_1day',  label: 'Lesson Reminder — 1 Day',  group: 'Student', icon: '🔔' },
  { key: 'student.lesson_reminder_2hour', label: 'Lesson Reminder — 2 Hours',group: 'Student', icon: '⏰' },
  { key: 'student.no_show',               label: 'No Show',                  group: 'Student', icon: '👻' },
  { key: 'student.credits_low',           label: 'Credits Low',              group: 'Student', icon: '💳' },
  { key: 'student.after_purchase',        label: 'After Purchase',           group: 'Student', icon: '🛍️' },
  { key: 'student.package_expiring',      label: 'Package Expiring (7 days)',group: 'Student', icon: '⏳' },
  { key: 'school.new_booking',            label: 'New Booking',              group: 'School',  icon: '📅' },
  { key: 'school.booking_cancelled',      label: 'Booking Cancelled',        group: 'School',  icon: '❌' },
  { key: 'school.stripe_connected',       label: 'Stripe Connected',         group: 'School',  icon: '💰' },
  { key: 'hq.new_school_registered',      label: 'New School Registered',    group: 'HQ',      icon: '🏫' },
] as const

type TemplateKey = typeof TEMPLATE_KEYS[number]['key']

type TemplateRow = {
  key: string
  locale: string
  subject: string
  body_html: string
  updated_at: string
}

type DbMap = Map<string, Map<string, { subject: string; body_html: string }>>

const SAMPLE_VARS: Record<string, string> = {
  student_name: 'Maria Rossi',
  school_name: 'Dance Studio Roma',
  lesson_name: 'Ballet Fundamentals',
  lesson_date: '25 April 2026',
  lesson_time: '18:00',
  lesson_duration: '60 min',
  teacher_name: 'Sofia Ferrari',
  location_name: 'Studio Roma Centro',
  room_name: 'Sala A',
  credits_remaining: '3',
  credits_used: '7',
  credits_threshold: '5',
  package_name: 'Monthly 10 Credits',
  package_expiry: '30 April 2026',
  amount: '€45.00',
  booking_url: '#',
  platform_name: 'No Under 40',
}

function renderPreview(html: string): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE_VARS[k] ?? `<span style="background:#fef3c7;padding:0 2px">{{${k}}}</span>`)
}

const VARIABLE_CHIPS = Object.keys(SAMPLE_VARS).map(k => `{{${k}}}`)

export default function EmailTemplatesPage() {
  const [dbMap, setDbMap] = useState<DbMap>(new Map())
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<TemplateKey>(TEMPLATE_KEYS[0].key)
  const [selectedLocale, setSelectedLocale] = useState<Locale>('en')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateResult, setTranslateResult] = useState<string | null>(null)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [tmplRes, settingsRes] = await Promise.all([
      fetch('/api/hq/email-templates').then(r => r.json()).catch(() => []),
      fetch('/api/hq/email-settings').then(r => r.json()).catch(() => ({})),
    ])
    const map: DbMap = new Map()
    const rows = Array.isArray(tmplRes) ? tmplRes : []
    for (const row of (rows as TemplateRow[])) {
      if (!map.has(row.key)) map.set(row.key, new Map())
      map.get(row.key)!.set(row.locale, { subject: row.subject, body_html: row.body_html })
    }
    setDbMap(map)
    setSettings(typeof settingsRes === 'object' && !Array.isArray(settingsRes) ? settingsRes : {})
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Load editor content when key/locale changes
  useEffect(() => {
    const localeMap = dbMap.get(selectedKey)
    const data = localeMap?.get(selectedLocale)
    setSubject(data?.subject ?? '')
    setBodyHtml(data?.body_html ?? '')
    setPreviewMode(false)
    setTranslateResult(null)
    setTestResult(null)
  }, [selectedKey, selectedLocale, dbMap])

  async function handleSave() {
    setSaving(true)
    await fetch('/api/hq/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: selectedKey, locale: selectedLocale, subject, body_html: bodyHtml }),
    })
    await load()
    setSaving(false)
  }

  async function handleAutoTranslate() {
    setTranslating(true)
    setTranslateResult(null)
    const res = await fetch('/api/hq/email-templates/auto-translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: selectedKey }),
    })
    const data = await res.json()
    if (!res.ok) setTranslateResult(`Error: ${data.error}`)
    else setTranslateResult(data.translated > 0 ? `✓ ${data.translated} locales translated` : '✓ All locales already filled')
    await load()
    setTranslating(false)
  }

  async function handleTestSend() {
    if (!testEmail) return
    setSendingTest(true)
    setTestResult(null)
    const res = await fetch('/api/hq/email-templates/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body_html: bodyHtml, to_email: testEmail }),
    })
    const data = await res.json()
    setTestResult(res.ok ? '✓ Test email sent' : `Error: ${data.error}`)
    setSendingTest(false)
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    await fetch('/api/hq/email-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSavingSettings(false)
  }

  function insertVariable(v: string) {
    setBodyHtml(prev => prev + v)
  }

  // Locale completeness for current key
  function localeStatus(locale: string) {
    const data = dbMap.get(selectedKey)?.get(locale)
    return data?.subject?.trim() && data?.body_html?.trim()
  }

  const groups = ['Student', 'School', 'HQ']
  const selectedMeta = TEMPLATE_KEYS.find(t => t.key === selectedKey)!

  return (
    <div className="flex h-full overflow-hidden bg-gray-50">

      {/* ── Left sidebar: template list ── */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Email Templates</h1>
          <p className="text-xs text-gray-400 mt-0.5">{TEMPLATE_KEYS.length} templates · 5 languages</p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {groups.map(group => {
            const items = TEMPLATE_KEYS.filter(t => t.group === group)
            return (
              <div key={group} className="mb-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">{group}</p>
                {items.map(t => {
                  const filled = LOCALES.filter(l => localeStatus(l)).length
                  const isSelected = t.key === selectedKey
                  return (
                    <button
                      key={t.key}
                      onClick={() => setSelectedKey(t.key as TemplateKey)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? 'bg-[#6B1F3A]/8 border-r-2 border-[#6B1F3A]' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-base flex-shrink-0">{t.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${isSelected ? 'font-semibold text-[#6B1F3A]' : 'text-gray-700'}`}>
                          {t.label}
                        </p>
                      </div>
                      <div className="flex gap-0.5 flex-shrink-0">
                        {LOCALES.map(l => (
                          <div key={l} className={`w-1.5 h-1.5 rounded-full ${
                            dbMap.get(t.key)?.get(l)?.subject?.trim() ? 'bg-green-400' : 'bg-gray-200'
                          }`} />
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Settings panel */}
        <div className="border-t border-gray-100 p-4 flex-shrink-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Settings</p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Credits low threshold</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={settings.credits_low_threshold ?? '5'}
                  onChange={e => setSettings(s => ({ ...s, credits_low_threshold: e.target.value }))}
                  className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <span className="text-xs text-gray-400">credits</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">All emails on/off</label>
              <button
                onClick={() => setSettings(s => ({ ...s, emails_enabled: s.emails_enabled === 'true' ? 'false' : 'true' }))}
                className={`relative w-9 h-5 rounded-full transition-colors ${settings.emails_enabled === 'true' ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.emails_enabled === 'true' ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="w-full py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main editor ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{selectedMeta.icon}</span>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{selectedMeta.label}</h2>
              <p className="text-xs text-gray-400 font-mono">{selectedKey}</p>
            </div>
          </div>

          {/* Locale tabs */}
          <div className="flex items-center gap-1 ml-4">
            {LOCALES.map(l => {
              const filled = localeStatus(l)
              return (
                <button
                  key={l}
                  onClick={() => setSelectedLocale(l)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                    selectedLocale === l
                      ? 'bg-[#6B1F3A] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {LOCALE_LABELS[l]}
                  <span className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-green-400' : 'bg-red-300'} ${selectedLocale === l ? 'opacity-80' : ''}`} />
                </button>
              )
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {translateResult && (
              <span className={`text-xs ${translateResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                {translateResult}
              </span>
            )}
            <button
              onClick={handleAutoTranslate}
              disabled={translating || !subject.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-40 transition"
            >
              {translating
                ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Translating...</>
                : <>✦ Auto-Translate All</>}
            </button>
            <button
              onClick={() => setPreviewMode(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${previewMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {previewMode ? 'Edit' : 'Preview'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-[#6B1F3A] text-white text-xs font-semibold hover:bg-[#5a1830] disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">

          {/* Editor / Preview */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">

            {/* Subject */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Subject line</label>
              {previewMode ? (
                <div className="px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800"
                  dangerouslySetInnerHTML={{ __html: renderPreview(subject) }} />
              ) : (
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. Your lesson is tomorrow, {{student_name}}"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
              )}
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email body (HTML)</label>
              {previewMode ? (
                <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white">
                  <iframe
                    srcDoc={renderPreview(bodyHtml)}
                    className="w-full h-full rounded-xl"
                    title="Email preview"
                  />
                </div>
              ) : (
                <textarea
                  value={bodyHtml}
                  onChange={e => setBodyHtml(e.target.value)}
                  placeholder="Paste your HTML email template here..."
                  className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 resize-none"
                />
              )}
            </div>

            {/* Test send */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="test@example.com"
                className="flex-1 max-w-xs px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
              />
              <button
                onClick={handleTestSend}
                disabled={sendingTest || !testEmail || !subject.trim()}
                className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-40 transition"
              >
                {sendingTest ? 'Sending...' : 'Send Test'}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                  {testResult}
                </span>
              )}
            </div>
          </div>

          {/* Right panel: variables */}
          <aside className="w-56 flex-shrink-0 border-l border-gray-100 bg-white overflow-y-auto p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Variables</p>
            <p className="text-xs text-gray-400 mb-3">Click to insert into body</p>
            <div className="space-y-1">
              {VARIABLE_CHIPS.map(v => (
                <button
                  key={v}
                  onClick={() => insertVariable(v)}
                  disabled={previewMode}
                  className="w-full text-left px-2 py-1.5 rounded-lg bg-gray-50 hover:bg-[#6B1F3A]/8 text-xs font-mono text-[#6B1F3A] transition disabled:opacity-40"
                >
                  {v}
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-5 mb-3">Base HTML</p>
            <button
              onClick={() => setBodyHtml(BASE_HTML_TEMPLATE)}
              disabled={previewMode}
              className="w-full py-2 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 hover:border-[#6B1F3A] hover:text-[#6B1F3A] transition disabled:opacity-40"
            >
              Load base template
            </button>
          </aside>
        </div>
      </main>
    </div>
  )
}

const BASE_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 20px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06)">

        <!-- Header -->
        <tr>
          <td style="background:#6B1F3A;padding:28px 40px;text-align:center">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px">No Under 40</h1>
            <p style="margin:6px 0 0;color:#f3d4de;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Classical Dance Network</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px">
            <h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600">Hi {{student_name}},</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7">
              Your message here.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin-bottom:32px">
              <tr>
                <td style="background:#6B1F3A;border-radius:10px">
                  <a href="{{booking_url}}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">
                    View Details →
                  </a>
                </td>
              </tr>
            </table>

            <!-- Info card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;margin-bottom:24px">
              <tr>
                <td style="padding:20px 24px">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;color:#6b7280;font-size:13px;width:40%">Lesson</td>
                      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500">{{lesson_name}}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#6b7280;font-size:13px">Date</td>
                      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500">{{lesson_date}} · {{lesson_time}}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#6b7280;font-size:13px">Teacher</td>
                      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500">{{teacher_name}}</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;color:#6b7280;font-size:13px">Location</td>
                      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500">{{location_name}} · {{room_name}}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:#9ca3af;font-size:13px;line-height:1.6">
              If you have any questions, reply to this email or contact {{school_name}}.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;background:#f9fafb;border-top:1px solid #f3f4f6;text-align:center">
            <p style="margin:0;color:#9ca3af;font-size:12px">{{platform_name}} · Classical Dance Network</p>
            <p style="margin:4px 0 0;color:#d1d5db;font-size:11px">{{school_name}}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
