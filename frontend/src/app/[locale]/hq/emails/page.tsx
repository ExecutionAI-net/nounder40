'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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

// `trigger` = quando parte davvero; `wired: false` = template pronto ma invio non ancora collegato nel codice
// Le email legate a una lezione sono SDOPPIATE: 📍 in sede e 🌐 online (testi
// diversi: indirizzo vs link). Se la variante .online non è compilata, il
// sistema usa automaticamente quella in sede.
const TEMPLATE_KEYS = [
  { key: 'student.welcome',               label: 'Welcome',                  group: 'Student', icon: '👋', trigger: 'Alla registrazione di una nuova allieva', wired: false },
  { key: 'student.booking_confirmed',     label: 'Booking Confirmed — 📍 In sede', group: 'Student', icon: '✅', trigger: "Appena l'allieva prenota una lezione IN SEDE", wired: true },
  { key: 'student.booking_confirmed.online', label: 'Booking Confirmed — 🌐 Online', group: 'Student', icon: '✅', trigger: "Appena l'allieva prenota una lezione ONLINE (se vuoto usa la versione In sede)", wired: true },
  { key: 'student.booking_cancelled',     label: 'Booking Cancelled — 📍 In sede', group: 'Student', icon: '❌', trigger: "Quando l'allieva cancella una prenotazione di lezione IN SEDE", wired: true },
  { key: 'student.booking_cancelled.online', label: 'Booking Cancelled — 🌐 Online', group: 'Student', icon: '❌', trigger: "Quando l'allieva cancella una prenotazione di lezione ONLINE (se vuoto usa la versione In sede)", wired: true },
  { key: 'student.lesson_cancelled_by_school', label: 'Lesson Cancelled by School — 📍 In sede', group: 'Student', icon: '🚫', trigger: 'Quando la scuola cancella una lezione IN SEDE con allieve prenotate', wired: false },
  { key: 'student.lesson_cancelled_by_school.online', label: 'Lesson Cancelled by School — 🌐 Online', group: 'Student', icon: '🚫', trigger: 'Quando la scuola cancella una lezione ONLINE con allieve prenotate (se vuoto usa la versione In sede)', wired: false },
  { key: 'student.lesson_reminder_1day',  label: 'Reminder 1 Day — 📍 In sede',  group: 'Student', icon: '🔔', trigger: 'Automatica (cron): 24 ore prima della lezione IN SEDE', wired: true },
  { key: 'student.lesson_reminder_1day.online',  label: 'Reminder 1 Day — 🌐 Online',  group: 'Student', icon: '🔔', trigger: 'Automatica (cron): 24 ore prima della lezione ONLINE (se vuoto usa la versione In sede)', wired: true },
  { key: 'student.lesson_reminder_2hour', label: 'Reminder 2 Hours — 📍 In sede',group: 'Student', icon: '⏰', trigger: 'Automatica (cron): 2 ore prima della lezione IN SEDE', wired: true },
  { key: 'student.lesson_reminder_2hour.online', label: 'Reminder 2 Hours — 🌐 Online',group: 'Student', icon: '⏰', trigger: 'Automatica (cron): 2 ore prima della lezione ONLINE (se vuoto usa la versione In sede)', wired: true },
  { key: 'student.no_show',               label: 'No Show',                  group: 'Student', icon: '👻', trigger: "Quando l'insegnante segna l'allieva come assente all'appello", wired: true },
  { key: 'student.credits_low',           label: 'Credits Low',              group: 'Student', icon: '💳', trigger: 'Dopo una prenotazione, se i crediti scendono sotto la soglia impostata', wired: true },
  { key: 'student.after_purchase',        label: 'After Purchase',           group: 'Student', icon: '🛍️', trigger: 'Dopo un acquisto completato con successo (webhook Stripe)', wired: true },
  // "Subscription Expiring" rimosso: gli abbonamenti sono pacchetti ricorrenti
  // (PACKAGE_TO_SUBSCRIPTION.md), la scadenza è coperta da Package Expiring.
  { key: 'student.package_expiring',      label: 'Package Expiring',         group: 'Student', icon: '⏳', trigger: 'Automatica (cron): {days} giorni prima della scadenza di un pacchetto non ricorrente con crediti residui', wired: true },
  { key: 'student.we_miss_you_1m',        label: 'We Miss You — 1 mese',     group: 'Student', icon: '💌', trigger: "Automatica (cron, giornaliera): l'ultima lezione dell'allieva risale a 30 giorni fa e non ha prenotazioni future in quella scuola", wired: true },
  { key: 'student.we_miss_you_3m',        label: 'We Miss You — 3 mesi',     group: 'Student', icon: '🌹', trigger: "Automatica (cron, giornaliera): l'ultima lezione dell'allieva risale a 90 giorni fa e non ha prenotazioni future in quella scuola", wired: true },
  { key: 'school.new_booking',            label: 'New Booking',              group: 'School',  icon: '📅', trigger: 'Alla scuola: appena arriva una nuova prenotazione', wired: true },
  { key: 'school.booking_cancelled',      label: 'Booking Cancelled',        group: 'School',  icon: '❌', trigger: "Alla scuola: quando un'allieva cancella una prenotazione", wired: false },
  { key: 'school.stripe_connected',       label: 'Stripe Connected',         group: 'School',  icon: '💰', trigger: 'Alla scuola: quando completa il collegamento Stripe', wired: false },
  { key: 'hq.new_school_registered',      label: 'New School Registered',    group: 'HQ',      icon: '🏫', trigger: 'Al team HQ: quando si registra una nuova scuola', wired: false },
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
// (testo semplice → <br>, card bianca, header No Under 40)
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
        <p style="margin:0;font-size:12px;color:#9ca3af;">© No Under 40 · You received this email because you are registered on our platform.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

export default function EmailTemplatesPage() {
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
  const [translateResult, setTranslateResult] = useState<string | null>(null)
  const [testEmail, setTestEmail] = useState('')
  const [sendingTest, setSendingTest] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
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
      setTranslateResult(data.translated > 0 ? `✓ ${data.translated} locales translated` : '✓ All locales already filled')
    } catch (err) {
      setTranslateResult(`Error: ${errMsg(err, 'try again')}`)
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
        body: JSON.stringify({ subject, body_html: bodyHtml, to_email: testEmail }),
      })
      setTestResult('✓ Test email sent')
    } catch (err) {
      setTestResult(`Error: ${errMsg(err, 'try again')}`)
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

  // Trigger con i valori correnti delle impostazioni ({days} → giorni di preavviso)
  function triggerText(trigger: string) {
    return trigger.replace('{days}', settings.expiry_reminder_days || '7')
  }

  async function toggleTemplate(key: string) {
    const next = isTemplateEnabled(key) ? 'false' : 'true'
    setSettings(s => ({ ...s, [`enabled.${key}`]: next }))
    await apiFetch('/hq/email-settings/', {
      method: 'POST',
      body: JSON.stringify({ [`enabled.${key}`]: next }),
    }).catch(() => {})
  }

  // Locale completeness for current key
  function localeStatus(locale: string) {
    const data = dbMap.get(selectedKey)?.get(locale)
    return data?.subject?.trim() && data?.body_html?.trim()
  }

  const groups = ['Student', 'School', 'HQ']
  const selectedMeta = TEMPLATE_KEYS.find(t => t.key === selectedKey)!

  return (
    // Su mobile la pagina scorre in larghezza mantenendo il layout desktop:
    // l'editor email è un lavoro da PC (scelta di Carlo)
    <div className="h-[calc(100dvh-56px)] md:h-full max-md:overflow-x-auto bg-gray-50">
    <div className="flex h-full overflow-hidden bg-gray-50 max-md:min-w-[900px]">

      {/* ── Left sidebar: template list ── */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b border-gray-100">
          <h1 className="text-base font-semibold text-gray-900">Email Templates</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {TEMPLATE_KEYS.length} templates · 5 lingue · {TEMPLATE_KEYS.filter(t => isTemplateEnabled(t.key)).length} attive
          </p>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {groups.map(group => {
            const items = TEMPLATE_KEYS.filter(t => t.group === group)
            return (
              <div key={group} className="mb-1">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2 flex items-center justify-between">
                  <span>{group}</span>
                  <span className="text-gray-300 normal-case">{items.filter(t => isTemplateEnabled(t.key)).length}/{items.length} on</span>
                </p>
                {items.map(t => {
                  const isSelected = t.key === selectedKey
                  const enabled = isTemplateEnabled(t.key)
                  return (
                    <div
                      key={t.key}
                      title={`⚡ ${triggerText(t.trigger)}${t.wired ? '' : ' — invio non ancora collegato'}`}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer ${
                        isSelected ? 'bg-[#6B1F3A]/8 border-r-2 border-[#6B1F3A]' : 'hover:bg-gray-50'
                      } ${!enabled ? 'opacity-50' : ''}`}
                      onClick={() => setSelectedKey(t.key as TemplateKey)}
                    >
                      <span className="text-sm leading-none flex-shrink-0">{t.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm truncate ${isSelected ? 'font-semibold text-[#6B1F3A]' : 'text-gray-700'} ${!enabled ? 'line-through decoration-gray-300' : ''}`}>
                          {t.label}{!t.wired && <span className="ml-1 text-amber-500" title="Invio non ancora collegato">⚠</span>}
                        </p>
                        <div className="flex gap-0.5 mt-1">
                          {LOCALES.map(l => (
                            <div key={l} className={`w-1.5 h-1.5 rounded-full ${
                              dbMap.get(t.key)?.get(l)?.subject?.trim() ? 'bg-green-400' : 'bg-gray-200'
                            }`} />
                          ))}
                        </div>
                      </div>
                      {/* Toggle standard attiva/disattiva singola email */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleTemplate(t.key) }}
                        title={enabled ? 'Disattiva questa email' : 'Attiva questa email'}
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
              <label className="text-xs text-gray-500 block mb-1">Expiry reminder (days before)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={settings.expiry_reminder_days ?? '7'}
                  onChange={e => setSettings(s => ({ ...s, expiry_reminder_days: e.target.value }))}
                  className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
                <span className="text-xs text-gray-400">days</span>
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

        {/* Top bar — 3 righe: titolo+azioni / trigger / lingue */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex-shrink-0 space-y-2">

          {/* Riga 1: titolo a sinistra, bottoni a destra */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none">{selectedMeta.icon}</span>
              <h2 className="text-sm font-semibold text-gray-900 truncate">{selectedMeta.label}</h2>
              <span className="text-[10px] text-gray-300 font-mono hidden xl:inline">{selectedKey}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {translateResult && (
                <span className={`text-xs whitespace-nowrap ${translateResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
                  {translateResult}
                </span>
              )}
              <button
                onClick={handleAutoTranslate}
                disabled={translating || !subject.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-40 transition whitespace-nowrap"
              >
                {translating
                  ? <><span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />Translating...</>
                  : <>✦ Auto-Translate</>}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-[#6B1F3A] text-white text-xs font-semibold hover:bg-[#5a1830] disabled:opacity-50 transition whitespace-nowrap"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Riga 2: quando parte questa email */}
          <p className="text-xs text-gray-500">
            ⚡ {triggerText(selectedMeta.trigger)}
            {!selectedMeta.wired && (
              <span className="ml-1.5 text-amber-600 font-medium">⚠ invio non ancora collegato</span>
            )}
          </p>

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
                  <span className={`w-1.5 h-1.5 rounded-full ${filled ? 'bg-green-400' : 'bg-red-300'} ${selectedLocale === l ? 'opacity-80' : ''}`} />
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
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Subject line</label>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Your lesson is tomorrow, {{student_name}}"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
              />
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-500">Email body</label>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                  {([['text', '✍️ Editor'], ['html', '</> HTML'], ['preview', '👁 Anteprima']] as const).map(([k, lbl]) => (
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
                  placeholder="HTML avanzato (facoltativo) — nell'Editor basta scrivere normalmente"
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
          <aside className="w-64 flex-shrink-0 border-l border-gray-100 bg-white overflow-y-auto p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Variables</p>
            <p className="text-xs text-gray-400 mb-3">Click per inserire nel corpo</p>
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

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-5 mb-3">Base HTML</p>
            <button
              onClick={() => setBodyHtml(BASE_HTML_TEMPLATE)}
              disabled={editorTab === 'preview'}
              className="w-full py-2 rounded-lg border border-dashed border-gray-200 text-xs text-gray-400 hover:border-[#6B1F3A] hover:text-[#6B1F3A] transition disabled:opacity-40"
            >
              Load base template
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
