'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

type Profile = {
  id: string
  email: string
  name: string
  phone: string | null
  role: string
  roles: string[]
  hq_sub_role: string | null
  school_sub_role: string | null
  school_id: string | null
  language_preference: string
  created_at: string
  schools?: {
    name: string
    city: string | null
    country: string | null
    logo_url: string | null
    active: boolean
  } | null
}

type Tab = 'account' | 'security' | 'danger'

export function AccountPage({ org }: { org: 'hq' | 'school' }) {
  const t = useTranslations('account')
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('account')

  useEffect(() => {
    fetch('/api/account')
      .then(r => r.json())
      .then(d => { setProfile(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-2 border-[#6B1F3A] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return <p className="text-gray-500 text-sm">{t('notFound')}</p>
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      {/* Avatar + identity card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[#6B1F3A] text-white flex items-center justify-center text-xl font-semibold">
          {profile.name?.[0]?.toUpperCase() ?? profile.email[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900 truncate">{profile.name || profile.email}</p>
          <p className="text-sm text-gray-500 truncate">{profile.email}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {org === 'hq' && profile.hq_sub_role && (
              <span className="text-[10px] uppercase tracking-wide bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded-full font-medium">
                {profile.hq_sub_role.replace('_', ' ')}
              </span>
            )}
            {org === 'school' && profile.school_sub_role && (
              <span className="text-[10px] uppercase tracking-wide bg-[#6B1F3A]/10 text-[#6B1F3A] px-2 py-0.5 rounded-full font-medium">
                {profile.school_sub_role}
              </span>
            )}
            {org === 'school' && profile.schools?.name && (
              <span className="text-xs text-gray-500">@ {profile.schools.name}</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        <TabButton current={tab} value="account" onClick={setTab}>{t('tabAccount')}</TabButton>
        <TabButton current={tab} value="security" onClick={setTab}>{t('tabSecurity')}</TabButton>
        <TabButton current={tab} value="danger" onClick={setTab}>{t('tabMembership')}</TabButton>
      </div>

      {tab === 'account' && <AccountTab profile={profile} onUpdated={setProfile} />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'danger' && <MembershipTab org={org} profile={profile} router={router} />}
    </div>
  )
}

function TabButton({ current, value, onClick, children }: {
  current: Tab; value: Tab; onClick: (t: Tab) => void; children: React.ReactNode
}) {
  const active = current === value
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
        active
          ? 'border-[#6B1F3A] text-[#6B1F3A]'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ────────────────────────────────────────────────────────────────
// Account tab
// ────────────────────────────────────────────────────────────────

function AccountTab({ profile, onUpdated }: { profile: Profile; onUpdated: (p: Profile) => void }) {
  const t = useTranslations('account')
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [lang, setLang] = useState(profile.language_preference)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const dirty = name !== profile.name || phone !== (profile.phone ?? '') || lang !== profile.language_preference

  async function save() {
    setSaving(true); setMsg(null)
    const res = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone: phone || null, language_preference: lang }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setMsg({ kind: 'err', text: data.error ?? t('saveFailed') }); return }
    onUpdated({ ...profile, name, phone: phone || null, language_preference: lang })
    setMsg({ kind: 'ok', text: t('saved') })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <div>
        <label htmlFor="acc-name" className="block text-xs font-medium text-gray-600 mb-1">{t('labelFullName')}</label>
        <input id="acc-name" value={name} onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
      </div>

      <div>
        <label htmlFor="acc-email" className="block text-xs font-medium text-gray-600 mb-1">{t('labelEmail')}</label>
        <input id="acc-email" value={profile.email} disabled
          className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500" />
        <p className="text-[11px] text-gray-400 mt-1">{t('emailHint')}</p>
      </div>

      <div>
        <label htmlFor="acc-phone" className="block text-xs font-medium text-gray-600 mb-1">{t('labelPhone')}</label>
        <input id="acc-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          placeholder="+39 ..." />
      </div>

      <div>
        <label htmlFor="acc-lang" className="block text-xs font-medium text-gray-600 mb-1">{t('labelLanguage')}</label>
        <select id="acc-lang" value={lang} onChange={e => setLang(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20">
          <option value="en">English</option>
          <option value="it">Italiano</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
        </select>
      </div>

      {msg && (
        <div className={`text-sm rounded-lg p-2 ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="px-4 py-2 bg-[#6B1F3A] text-white text-sm font-medium rounded-lg hover:bg-[#5a1930] disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {saving ? t('saving') : t('saveChanges')}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Security tab
// ────────────────────────────────────────────────────────────────

function SecurityTab() {
  const t = useTranslations('account')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function changePassword() {
    setMsg(null)
    if (next.length < 6) { setMsg({ kind: 'err', text: t('passwordTooShort') }); return }
    if (next !== confirm) { setMsg({ kind: 'err', text: t('passwordMismatch') }); return }

    setSaving(true)
    const res = await fetch('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current, new_password: next }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setMsg({ kind: 'err', text: data.error ?? t('passwordChangeFailed') }); return }

    setCurrent(''); setNext(''); setConfirm('')
    setMsg({ kind: 'ok', text: t('passwordUpdated') })
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">{t('changePassword')}</h3>

      <div>
        <label htmlFor="sec-current" className="block text-xs font-medium text-gray-600 mb-1">{t('labelCurrentPassword')}</label>
        <input id="sec-current" type="password" value={current} onChange={e => setCurrent(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
      </div>
      <div>
        <label htmlFor="sec-next" className="block text-xs font-medium text-gray-600 mb-1">{t('labelNewPassword')}</label>
        <input id="sec-next" type="password" value={next} onChange={e => setNext(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
          placeholder={t('passwordPlaceholder')} />
      </div>
      <div>
        <label htmlFor="sec-confirm" className="block text-xs font-medium text-gray-600 mb-1">{t('labelConfirmPassword')}</label>
        <input id="sec-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
      </div>

      {msg && (
        <div className={`text-sm rounded-lg p-2 ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      <button
        onClick={changePassword}
        disabled={saving || !current || !next || !confirm}
        className="px-4 py-2 bg-[#6B1F3A] text-white text-sm font-medium rounded-lg hover:bg-[#5a1930] disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        {saving ? t('updatingPassword') : t('updatePassword')}
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Membership tab (leave org + delete account)
// ────────────────────────────────────────────────────────────────

function MembershipTab({
  org, profile, router,
}: {
  org: 'hq' | 'school'
  profile: Profile
  router: ReturnType<typeof useRouter>
}) {
  const t = useTranslations('account')
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [typedConfirm, setTypedConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function leaveOrg() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/account/leave-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? t('leaveFailed')); return }
    if (data.account_deleted) router.replace('/login?error=account_deleted')
    else router.replace('/login')
  }

  async function deleteAccount() {
    setBusy(true); setErr(null)
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: typedConfirm }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? t('deleteFailed')); return }
    router.replace('/login?error=account_deleted')
  }

  const isOwner = org === 'school' && profile.school_sub_role === 'owner'
  const leaveTitle = org === 'hq' ? t('leaveHQTitle') : t('leaveSchoolTitle')
  const leaveDesc = org === 'hq' ? t('leaveHQDesc') : t('leaveSchoolDesc')
  const leaveBtn = org === 'hq' ? t('leaveHQ') : t('leaveSchool')
  const leaveBtnConfirm = org === 'hq' ? t('confirmLeaveHQ') : t('confirmLeaveSchool')

  return (
    <div className="space-y-6">
      {/* Leave org */}
      <div className="bg-white rounded-xl border border-amber-200 p-6 space-y-3">
        <h3 className="text-sm font-semibold text-amber-900">{leaveTitle}</h3>
        <p className="text-xs text-gray-600">{leaveDesc}</p>

        {isOwner && (
          <p className="text-xs text-red-600">⚠ {t('ownerWarning')}</p>
        )}

        {!leaveConfirm ? (
          <button
            onClick={() => setLeaveConfirm(true)}
            className="px-4 py-2 bg-amber-50 text-amber-800 border border-amber-200 text-sm font-medium rounded-lg hover:bg-amber-100 transition"
          >
            {leaveBtn}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={leaveOrg}
              disabled={busy}
              className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition"
            >
              {busy ? t('leaving') : leaveBtnConfirm}
            </button>
            <button
              onClick={() => setLeaveConfirm(false)}
              className="px-4 py-2 bg-white text-gray-600 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition"
            >
              {t('cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Delete account */}
      <div className="bg-white rounded-xl border border-red-200 p-6 space-y-3">
        <h3 className="text-sm font-semibold text-red-900">{t('deleteAccountTitle')}</h3>
        <p className="text-xs text-gray-600">{t('deleteAccountDesc')}</p>

        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 transition"
          >
            {t('deleteAccount')}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-600">{t('deleteConfirmPrompt')}</p>
            <input
              value={typedConfirm}
              onChange={e => setTypedConfirm(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20"
              placeholder={t('deleteConfirmPhrase')}
            />
            <div className="flex gap-2">
              <button
                onClick={deleteAccount}
                disabled={busy || typedConfirm.trim().toLowerCase() !== t('deleteConfirmPhrase').toLowerCase()}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {busy ? t('deleting') : t('permanentlyDelete')}
              </button>
              <button
                onClick={() => { setDeleteConfirm(false); setTypedConfirm('') }}
                className="px-4 py-2 bg-white text-gray-600 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 transition"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {err}
        </div>
      )}
    </div>
  )
}
