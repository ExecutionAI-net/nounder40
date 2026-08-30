'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import EmailRichEditor, { insertTextAtCursor } from '@/components/ui/EmailRichEditor'
import type { LexicalEditor } from 'lexical'
import { apiFetch, ApiError } from '@/lib/api/client'

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

const LOCALES = ['en', 'it', 'es', 'fr', 'de'] as const
type Locale = typeof LOCALES[number]

const LOCALE_LABELS: Record<Locale, string> = {
  en: '🇬🇧 EN', it: '🇮🇹 IT', es: '🇪🇸 ES', fr: '🇫🇷 FR', de: '🇩🇪 DE',
}

// wired: false = template ready but sending not hooked up in code yet.
// Lesson emails come in TWO variants: 📍 on-site and 🌐 online (different
// texts: address vs link). If the .online variant is empty the on-site one
// is used. Labels and triggers live in messages (hq.emails.tpl.<slug>),
// resolved via tplSlug() so the card follows the selected UI language.
// ("Subscription Expiring" removed: subscriptions are recurring packages —
// PACKAGE_TO_SUBSCRIPTION.md — Package Expiring covers their expiry.)
const TEMPLATE_KEYS = [
  // Account: these gate access to the platform itself, so they also ship a
  // built-in branded fallback in the backend (notifications/builtin_templates.py).
  // Filling them in here overrides that fallback; leaving them empty is safe.
  { key: 'password_reset',                             group: 'Account', icon: '🔑', wired: true },
  { key: 'team_invite',                                group: 'Account', icon: '✉️', wired: true },
  { key: 'student.welcome',                            group: 'Student', icon: '👋', wired: false },
  { key: 'student.booking_confirmed',                  group: 'Student', icon: '✅', wired: true },
  { key: 'student.booking_confirmed.online',           group: 'Student', icon: '✅', wired: true },
  { key: 'student.booking_cancelled',                  group: 'Student', icon: '❌', wired: true },
  { key: 'student.booking_cancelled.online',           group: 'Student', icon: '❌', wired: true },
  { key: 'student.lesson_cancelled_by_school',         group: 'Student', icon: '🚫', wired: false },
  { key: 'student.lesson_cancelled_by_school.online',  group: 'Student', icon: '🚫', wired: false },
  { key: 'student.lesson_reminder_1day',               group: 'Student', icon: '🔔', wired: true },
  { key: 'student.lesson_reminder_1day.online',        group: 'Student', icon: '🔔', wired: true },
  { key: 'student.lesson_reminder_2hour',              group: 'Student', icon: '⏰', wired: true },
  { key: 'student.lesson_reminder_2hour.online',       group: 'Student', icon: '⏰', wired: true },
  { key: 'student.no_show',                            group: 'Student', icon: '👻', wired: true },
  { key: 'student.credits_low',                        group: 'Student', icon: '💳', wired: true },
  { key: 'student.after_purchase',                     group: 'Student', icon: '🛍️', wired: true },
  { key: 'student.package_expiring',                   group: 'Student', icon: '⏳', wired: true },
  // We-miss-you: like the Account group these ship a built-in branded fallback
  // (builtin_templates.py), so the winback cron sends even with empty cards;
  // filling them in here overrides the built-in copy.
  { key: 'student.we_miss_you_1m',                     group: 'Student', icon: '💌', wired: true },
  { key: 'student.we_miss_you_3m',                     group: 'Student', icon: '🌹', wired: true },
  { key: 'school.new_booking',                         group: 'School',  icon: '📅', wired: true },
  { key: 'school.booking_cancelled',                   group: 'School',  icon: '❌', wired: false },
  { key: 'school.stripe_connected',                    group: 'School',  icon: '💰', wired: false },
  { key: 'hq.new_school_registered',                   group: 'HQ',      icon: '🏫', wired: false },
] as const

// Keys that ship a built-in fallback in the code (backend
// notifications/builtin_templates.py, all five locales): they are sent even
// with an empty card here. Keep aligned with _BUILTINS there.
const BUILTIN_KEYS = new Set<string>(['password_reset', 'team_invite', 'student.we_miss_you_1m', 'student.we_miss_you_3m'])
const hasBuiltin = (key: string) => BUILTIN_KEYS.has(key)

// Message key slug for a template key ('student.booking_confirmed.online' → 'student_booking_confirmed_online')
const tplSlug = (key: string) => key.replace(/\./g, '_')

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
  user_name: 'Maria Rossi',
  reset_url: '#',
  setup_url: '#',
  student_name: 'Maria Rossi',
  school_name: 'Dance Studio Roma',
  lesson_name: 'Ballet Fundamentals',
  lesson_date: '25-04-2026',
  lesson_time: '18:00',
  lesson_duration: '60 min',
  teacher_name: 'Sofia Ferrari',
  location_name: 'Studio Roma Centro',
  location_address: 'Via Roma 12, 00184 Roma',
  room_name: 'Sala A',
  online_link: 'https://zoom.us/j/123456789',
  credits_remaining: '3',
  credits_used: '7',
  credits_threshold: '5',
  package_name: 'Monthly 10 Credits',
  package_expiry: '30 April 2026',
  subscription_name: 'Monthly Unlimited',
  subscription_expiry: '30 April 2026',
  accesses_remaining: '5',
  amount: '€45.00',
  booking_url: '#',
  platform_name: 'No Under 40',
  days_absent: '30',
  last_lesson_date: '25 March 2026',
}

function renderPreview(html: string): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE_VARS[k] ?? `<span style="background:#fef3c7;padding:0 2px">{{${k}}}</span>`)
}

// Il corpo è HTML "vero" o testo semplice? (come fa il sender: se non ci sono
// tag, i ritorni a capo diventano <br> dentro il layout brandizzato)
function isHtmlBody(body: string): boolean {
  return /<[a-z][\s\S]*>/i.test(body)
}

// Corpo (testo o HTML) → HTML per l'editor visuale
function toEditorHtml(body: string): string {
  if (isHtmlBody(body)) return body
  return body
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

// Anteprima fedele all'email reale: replica il layout brandizzato del sender
// (testo semplice → <br>, card bianca, header No Under 40). Il gemello
// backend è to_html_body() in notifications/emails.py: tenerli allineati.
function previewDoc(body: string): string {
  const content = isHtmlBody(body) ? body : body.replace(/\n/g, '<br>')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="display:inline-block;background:#6B1F3A;border-radius:12px;padding:12px 24px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">No Under 40</span>
        </div>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:16px;padding:40px 36px;box-shadow:0 1px 4px rgba(0,0,0,0.08);font-size:15px;color:#374151;line-height:1.7;">
        ${renderPreview(content)}
      </td></tr>
      <tr><td align="center" style="padding-top:24px;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">© No Under 40 · Classical Dance Network</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

export default function EmailTemplatesPage() {
  const t = useTranslations('hq.emails')
  const [dbMap, setDbMap] = useState<DbMap>(new Map())
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [selectedKey, setSelectedKey] = useState<TemplateKey>(TEMPLATE_KEYS[0].key)
  const [selectedLocale, setSelectedLocale] = useState<Locale>('en')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  // Tab editor: Editor (visuale) · HTML (sorgente) · Anteprima (resa reale)
  const [editorTab, setEditorTabRaw] = useState<'text' | 'html' | 'preview'>('text')
  const lexicalRef = useRef<LexicalEditor | null>(null)
  // contenuto iniziale dell'editor visuale (non aggiornato a ogni battuta: evita salti del cursore)
  const [editorSeed, setEditorSeed] = useState('')
  const [editorKey, setEditorKey] = useState(0)
  function setEditorTab(tab: 'text' | 'html' | 'preview') {
    // entrando nell'editor visuale, riallinea il contenuto (es. dopo modifiche nel tab HTML)
    if (tab === 'text') { setEditorSeed(toEditorHtml(bodyHtml)); setEditorKey(k => k + 1) }
    setEditorTabRaw(tab)
  }
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateResult, setTranslateResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  const load = useCallback(async () => {
    const [tmplRes, settingsRes] = await Promise.all([
      apiFetch<TemplateRow[]>('/hq/email-templates/').catch(() => []),
      apiFetch<Record<string, string>>('/hq/email-settings/').catch(() => ({})),
    ])
    const map: DbMap = new Map()
    for (const row of tmplRes) {
      if (!map.has(row.key)) map.set(row.key, new Map())
      map.get(row.key)!.set(row.locale, { subject: row.subject, body_html: row.body_html })
    }
    setDbMap(map)
    setSettings(settingsRes)
  }, [])

  useEffect(() => { load() }, [load])

  // Load editor content when key/locale changes
  useEffect(() => {
    const localeMap = dbMap.get(selectedKey)
    const data = localeMap?.get(selectedLocale)
    setSubject(data?.subject ?? '')
    setBodyHtml(data?.body_html ?? '')
    setEditorSeed(toEditorHtml(data?.body_html ?? ''))
    setEditorKey(k => k + 1)
    setEditorTabRaw('text')
    setTranslateResult(null)
    setTestResult(null)
  }, [selectedKey, selectedLocale, dbMap])

  async function handleSave() {
    setSaving(true)
    await apiFetch('/hq/email-templates/', {
      method: 'POST',
      body: JSON.stringify({ key: selectedKey, locale: selectedLocale, subject, body_html: bodyHtml }),
    }).catch(() => {})
    await load()
    setSaving(false)
  }

  async function handleAutoTranslate() {
    setTranslating(true)
    setTranslateResult(null)
    try {
      const data = await apiFetch<{ translated: number }>('/hq/email-templates/auto-translate/', {
        method: 'POST',
        body: JSON.stringify({ key: selectedKey, source: selectedLocale }),
      })
      setTranslateResult({ ok: true, msg: data.translated > 0 ? t('translatedCount', { count: data.translated }) : t('allFilled') })
    } catch (err) {
      setTranslateResult({ ok: false, msg: t('errorWithMsg', { msg: errMsg(err, t('tryAgain')) }) })
    }
    await load()
    setTranslating(false)
  }

  async function handleTestSend() {
    if (!testEmail) return
    setSendingTest(true)
    setTestResult(null)
    try {
      await apiFetch('/hq/email-templates/test-send/', {
        method: 'POST',
        body: JSON.stringify({ subject, body_html: bodyHtml, to_email: testEmail, locale: selectedLocale }),
      })
      setTestResult({ ok: true, msg: t('testSent') })
    } catch (err) {
      setTestResult({ ok: false, msg: t('errorWithMsg', { msg: errMsg(err, t('tryAgain')) }) })
    }
    setSendingTest(false)
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    await apiFetch('/hq/email-settings/', { method: 'POST', body: JSON.stringify(settings) }).catch(() => {})
    setSavingSettings(false)
  }

  function insertVariable(v: string) {
    if (editorTab === 'text' && lexicalRef.current) {
      insertTextAtCursor(lexicalRef.current, v)
      return
    }
    setBodyHtml(prev => prev + v)
  }

  // On/off per singolo template (email_settings: enabled.<key>, default attivo)
  function isTemplateEnabled(key: string) {
    return settings[`enabled.${key}`] !== 'false'
  }

  // Label/trigger localizzati (hq.emails.tpl.<slug>); {days} = giorni di preavviso correnti
  const tplLabel = (key: string) => t(`tpl.${tplSlug(key)}.label` as Parameters<typeof t>[0])
  const tplTrigger = (key: string) =>
    t(`tpl.${tplSlug(key)}.trigger` as Parameters<typeof t>[0], { days: settings.expiry_reminder_days || '7' })

  async function toggleTemplate(key: string) {
    const next = isTemplateEnabled(key) ? 'false' : 'true'
    setSettings(s => ({ ...s, [`enabled.${key}`]: next }))
    await apiFetch('/hq/email-settings/', {
      method: 'POST',
      body: JSON.stringify({ [`enabled.${key}`]: next }),
    }).catch(() => {})
  }

  // Interruttore generale: riga assente = acceso (come lo legge il backend);
  // salva subito come i singoli, senza passare da "Salva impostazioni".
  const allEmailsOn = settings.emails_enabled !== 'false'
  async function toggleAllEmails() {
    const next = allEmailsOn ? 'false' : 'true'
    setSettings(s => ({ ...s, emails_enabled: next }))
    await apiFetch('/hq/email-settings/', { method: 'POST', body: JSON.stringify({ emails_enabled: next }) }).catch(() => {})
  }

  // Locale completeness for current key
  function localeStatus(locale: string) {
    const data = dbMap.get(selectedKey)?.get(locale)
    return data?.subject?.trim() && data?.body_html?.trim()
  }

  const groups = ['Account', 'Student', 'School', 'HQ']
  const selectedMeta = TEMPLATE_KEYS.find(t => t.key === selectedKey)!

  return (
    // Su mobile la pagina scorre in larghezza mantenendo il layout desktop:
    // l'editor email è un lavoro da PC (scelta di Carlo)
    <div className="h-[calc(100dvh-56px)] md:h-full max-md:overflow-x-auto bg-gray-50">
    <div className="flex h-full overflow-hidden bg-gray-50 max-md:min-w-[900px]">

      {/* ── Left sidebar: template list ── */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">{t('title')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('subtitle', { total: TEMPLATE_KEYS.length, active: TEMPLATE_KEYS.filter(k => isTemplateEnabled(k.key)).length })}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {groups.map(group => {
            const items = TEMPLATE_KEYS.filter(t => t.group === group)
            return (
              <div key={group} className="mb-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2 flex items-center justify-between">
                  <span>{t(`group${group}` as Parameters<typeof t>[0])}</span>
                  <span className="text-gray-300 normal-case">{t('groupOnCount', { on: items.filter(k => isTemplateEnabled(k.key)).length, total: items.length })}</span>
                </p>
                {items.map(item => {
                  const isSelected = item.key === selectedKey
                  const enabled = isTemplateEnabled(item.key)
                  return (
                    <div
                      key={item.key}
                      title={`⚡ ${tplTrigger(item.key)}${item.wired ? '' : ` — ${t('notWired')}`}`}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#6B1F3A]/8 border-r-2 border-[#6B1F3A]' : 'hover:bg-gray-50'
                      } ${!enabled ? 'opacity-50' : ''}`}
                      onClick={() => setSelectedKey(item.key as TemplateKey)}
                    >
                      <span className="text-sm leading-none flex-shrink-0">{item.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${isSelected ? 'font-semibold text-[#6B1F3A]' : 'text-gray-700'} ${!enabled ? 'line-through decoration-gray-300' : ''}`}>
                          {tplLabel(item.key)}{!item.wired && <span className="ml-1 text-amber-500" title={t('notWired')}>⚠</span>}
                        </p>
                        <div className="flex gap-0.5 mt-1">
                          {LOCALES.map(l => (
                            <div key={l} className={`w-1.5 h-1.5 rounded-full ${
                              dbMap.get(item.key)?.get(l)?.subject?.trim() ? 'bg-green-400' : hasBuiltin(item.key) ? 'bg-blue-300' : 'bg-gray-200'
                            }`} />
                          ))}
                        </div>
                      </div>
                      {/* Toggle standard attiva/disattiva singola email */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleTemplate(item.key) }}
                        title={enabled ? t('disableTemplate') : t('enableTemplate')}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-green-500' : 'bg-gray-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Settings panel */}
        <div className="border-t border-gray-100 p-4 flex-shrink-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('settings')}</p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('creditsLowThreshold')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={settings.credits_low_threshold ?? '5'}
                  onChange={e => setSettings(s => ({ ...s, credits_low_threshold: e.target.value }))}
                  className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <span className="text-xs text-gray-400">{t('creditsUnit')}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('expiryReminderDays')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.expiry_reminder_days ?? '7'}
                  onChange={e => setSettings(s => ({ ...s, expiry_reminder_days: e.target.value }))}
                  className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <span className="text-xs text-gray-400">{t('daysUnit')}</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">{t('allEmailsToggle')}</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleAllEmails}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${allEmailsOn ? 'bg-green-500' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${allEmailsOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <span className={`text-xs font-medium ${allEmailsOn ? 'text-green-600' : 'text-red-500'}`}>
                  {allEmailsOn ? t('allEmailsOn') : t('allEmailsOff')}
                </span>
              </div>
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="w-full py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700 disabled:opacity-50 transition"
            >
              {savingSettings ? t('saving') : t('saveSettings')}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main editor ── */}
      <main className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar — 3 righe: titolo+azioni / trigger / lingue */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex-shrink-0 space-y-2">

          {/* Riga 1: titolo a sinistra, bottoni a destra */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none">{selectedMeta.icon}</span>
              <h2 className="text-sm font-semibold text-gray-900 truncate">{tplLabel(selectedKey)}</h2>
              <span className="text-[10px] text-gray-300 font-mono hidden xl:inline">{selectedKey}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {translateResult && (
                <span className={`text-xs whitespace-nowrap ${translateResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {translateResult.msg}
                </span>
              )}
              <button
                onClick={handleAutoTranslate}
                disabled={translating || !subject.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-40 transition whitespace-nowrap"
              >
                {translating
                  ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />{t('translating')}</>
                  : <>{t('autoTranslate')}</>}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-[#6B1F3A] text-white text-xs font-semibold hover:bg-[#5a1830] disabled:opacity-50 transition whitespace-nowrap"
              >
                {saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>

          {/* Riga 2: quando parte questa email */}
          <p className="text-xs text-gray-500">
            ⚡ {tplTrigger(selectedKey)}
            {!selectedMeta.wired && (
              <span className="ml-1.5 text-amber-600 font-medium">⚠ {t('notWired')}</span>
            )}
          </p>

          {hasBuiltin(selectedKey) && (
            <p className="text-xs text-blue-600">🛟 {t('builtinHint')}</p>
          )}

          {/* Riga 3: lingue */}
          <div className="flex items-center gap-1 flex-wrap">
            {LOCALES.map(l => {
              const filled = localeStatus(l)
              return (
                <button
                  key={l}
                  onClick={() => setSelectedLocale(l)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                    selectedLocale === l
                      ? 'bg-[#6B1F3A] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {LOCALE_LABELS[l]}
                  <span className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-green-400' : hasBuiltin(selectedKey) ? 'bg-blue-300' : 'bg-red-300'} ${selectedLocale === l ? 'opacity-80' : ''}`} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">

          {/* Editor / Preview */}
          <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4">

            {/* Subject */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('subjectLine')}</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={t('subjectPlaceholder')}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
              />
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-500">{t('emailBody')}</label>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                  {/* "</>" resta hardcoded: dentro un messaggio ICU verrebbe letto come tag di chiusura */}
                  {([['text', t('tabEditor')], ['html', '</> HTML'], ['preview', t('tabPreview')]] as ['text' | 'html' | 'preview', string][]).map(([k, lbl]) => (
                    <button key={k} onClick={() => setEditorTab(k)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition ${editorTab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              {editorTab === 'preview' ? (
                <div className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-white">
                  <iframe srcDoc={previewDoc(bodyHtml)} className="w-full h-full rounded-xl" title="Email preview" />
                </div>
              ) : editorTab === 'html' ? (
                <textarea
                  value={bodyHtml}
                  onChange={e => setBodyHtml(e.target.value)}
                  placeholder={t('htmlPlaceholder')}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 resize-none"
                />
              ) : (
                <EmailRichEditor
                  key={editorKey}
                  initialHtml={editorSeed}
                  onChange={setBodyHtml}
                  editorRef={lexicalRef}
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
                {sendingTest ? t('sendingTest') : t('sendTest')}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {testResult.msg}
                </span>
              )}
            </div>
          </div>

          {/* Right panel: variables */}
          <aside className="w-64 flex-shrink-0 border-l border-gray-100 bg-white overflow-y-auto p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{t('variables')}</p>
            <p className="text-xs text-gray-400 mb-3">{t('variablesHint')}</p>
            <div className="space-y-1">
              {Object.entries(SAMPLE_VARS).map(([k, sample]) => (
                <button
                  key={k}
                  onClick={() => insertVariable(`{{${k}}}`)}
                  disabled={editorTab === 'preview'}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-gray-50 hover:bg-[#6B1F3A]/8 transition disabled:opacity-40 group"
                >
                  <span className="block text-xs font-mono text-[#6B1F3A]">{`{{${k}}}`}</span>
                  <span className="block text-[10px] text-gray-400 truncate group-hover:text-gray-500">{sample}</span>
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-5 mb-3">{t('baseHtml')}</p>
            <button
              onClick={() => setBodyHtml(BASE_HTML_TEMPLATE)}
              disabled={editorTab === 'preview'}
              className="w-full py-2 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 hover:border-[#6B1F3A] hover:text-[#6B1F3A] transition disabled:opacity-40"
            >
              {t('loadBaseTemplate')}
            </button>
          </aside>
        </div>
      </main>
    </div>
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
