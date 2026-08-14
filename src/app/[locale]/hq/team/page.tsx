'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { HQ_PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS } from '@/lib/hq-permissions'
import type { HQSubRole, Permission } from '@/lib/hq-permissions'

const ALL_PERMISSIONS: Permission[] = [
  'dashboard',
  'schools_view',
  'schools_create_edit',
  'schools_activate',
  'schools_platform_fee',
  'payments',
  'reports',
  'inbox',
  'library',
  'shop',
  'packages',
  'lesson_types',
  'team',
  'permissions',
  'homepage_settings',
]

const ROLES: HQSubRole[] = ['owner', 'super_admin', 'operations', 'finance', 'tech_support', 'analytics', 'support']

type Member = {
  id: string
  name: string
  email: string
  hq_sub_role: string
  created_at: string
}

type Pending = {
  id: string
  name: string
  email: string
  role_detail: string
  created_at: string
}

type ApproveTarget = { id: string; name: string; email: string; role: string }

export default function HQTeamPage() {
  const t = useTranslations('hq.team')
  const [members, setMembers]   = useState<Member[]>([])
  const [pending, setPending]   = useState<Pending[]>([])
  const [callerSubRole, setCallerSubRole] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ name: '', email: '', hq_sub_role: 'operations' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<string | null>(null)

  // Approve modal (manual activation fallback)
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null)
  const [approvePassword, setApprovePassword] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const SUB_ROLES = [
    { value: 'owner',       label: 'Owner',        ownerOnly: true },
    { value: 'super_admin', label: 'Super Admin',   ownerOnly: false },
    { value: 'operations',  label: 'Operations',    ownerOnly: false },
    { value: 'finance',     label: 'Finance',       ownerOnly: false },
    { value: 'tech_support', label: 'Tech Support', ownerOnly: false },
    { value: 'analytics',   label: 'Analytics',     ownerOnly: false },
    { value: 'support',     label: 'Support',       ownerOnly: false },
  ]

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const res = await fetch('/api/hq/team', { cache: 'no-store' })
    if (res.ok) {
      const d = await res.json()
      setMembers(d.active ?? [])
      setPending(d.pending ?? [])
      setCallerSubRole(d.callerSubRole ?? null)
    }
    setLoading(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    const res = await fetch('/api/hq/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? t('errorFailed'))
    } else {
      if (data.existing) {
        setSuccess(t('successExisting', { name: form.name }))
      } else {
        setSuccess(t('successInvitationSent', { email: form.email }))
      }
      setForm({ name: '', email: '', hq_sub_role: 'operations' })
      setShowForm(false)
      await fetchData()
    }
    setSubmitting(false)
  }

  async function handleRemove(id: string, name: string, isPending = false) {
    if (!confirm(t('confirmRemove', { name }))) return
    await fetch('/api/hq/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pending: isPending }),
    })
    await fetchData()
  }

  async function handleRoleChange(id: string, newRole: string) {
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/hq/team', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, hq_sub_role: newRole }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? t('errorRoleUpdate'))
    } else {
      setSuccess(t('successRoleUpdated'))
      await fetchData()
    }
    setSubmitting(false)
  }

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault()
    if (!approveTarget) return
    setApproving(true)
    setApproveError(null)
    const res = await fetch('/api/hq/team/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: approveTarget.id, password: approvePassword || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      setApproveError(data.error ?? t('errorActivate'))
      setApproving(false)
      return
    }
    setApproveTarget(null)
    setApprovePassword('')
    setSuccess(t('successActivated', { name: approveTarget.name }))
    await fetchData()
    setApproving(false)
  }

  function roleLabel(val: string) {
    return SUB_ROLES.find((r) => r.value === val)?.label ?? val
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-3xl">
      {/* Approve modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('modalActivateTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{t('modalActivateSubtitle')}</p>
            </div>
            <div className="px-6 py-4">
              <div className="bg-gray-50 rounded-xl p-4 mb-4">
                <p className="font-medium text-gray-900 text-sm">{approveTarget.name}</p>
                <p className="text-xs text-gray-400">{approveTarget.email}</p>
                <span className="mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {roleLabel(approveTarget.role)}
                </span>
              </div>
              <form onSubmit={handleApprove} className="space-y-3">
                {approveError && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{approveError}</div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelPassword')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={approvePassword}
                      onChange={e => setApprovePassword(e.target.value)}
                      placeholder={t('placeholderPassword')}
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                    />
                    <button type="button"
                      onClick={() => {
                        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
                        setApprovePassword('Nu40_' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''))
                      }}
                      className="px-3 py-2 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 whitespace-nowrap">
                      {t('buttonGenerate')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{t('passwordNote')}</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={approving}
                    className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
                    {approving ? t('buttonActivating') : t('buttonGrantAccess')}
                  </button>
                  <button type="button"
                    onClick={() => { setApproveTarget(null); setApprovePassword(''); setApproveError(null) }}
                    className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    {t('buttonCancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle', { active: members.length, pending: pending.length })}</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setSuccess(null) }}
          className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
        >
          {t('buttonInviteMember')}
        </button>
      </div>

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between">
          {success}
          <button onClick={() => setSuccess(null)} className="text-green-500 hover:text-green-700 text-xs ml-4">✕</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleInvite} className="bg-white rounded-xl border border-gray-100 p-5 mb-5 space-y-4">
          <h3 className="font-medium text-gray-900">{t('formInviteTitle')}</h3>
          <p className="text-xs text-gray-400">
            {t('formInviteDescription')}
          </p>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelFullName')}</label>
              <input required value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderName')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelEmail')}</label>
              <input required type="email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                placeholder={t('placeholderEmail')} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelRole')}</label>
            <select value={form.hq_sub_role}
              onChange={(e) => setForm((f) => ({ ...f, hq_sub_role: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20">
              {SUB_ROLES.filter(r => !r.ownerOnly || callerSubRole === 'owner').map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={submitting}
              className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {submitting ? t('buttonSending') : t('buttonSendInvitation')}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(null) }}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
              {t('buttonCancel')}
            </button>
          </div>
        </form>
      )}

      {/* Pending invitations */}
      {pending.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-700">{t('sectionPending')}</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{pending.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-amber-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-amber-50/50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnMember')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnRole')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnInvited')}</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pending.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900 text-sm">{p.name}</p>
                      <p className="text-xs text-gray-400">{p.email}</p>
                    </td>
                    <td className="px-6 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {roleLabel(p.role_detail)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-400">
                      {new Date(p.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => { setApproveTarget({ id: p.id, name: p.name, email: p.email, role: p.role_detail }); setApprovePassword(''); setApproveError(null) }}
                          className="text-xs px-3 py-1.5 bg-[#6B1F3A] text-white rounded-lg hover:bg-[#5a1930] transition font-medium">
                          {t('buttonActivate')}
                        </button>
                        <button onClick={() => handleRemove(p.id, p.name, true)}
                          className="text-xs text-red-400 hover:text-red-600">
                          {t('buttonRemove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active members */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('sectionActiveMembers')}</h2>
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {!members.length ? (
            <div className="p-8 text-center text-sm text-gray-400">{t('emptyState')}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnMember')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnRole')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnAdded')}</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                    </td>
                    <td className="px-6 py-3">
                      {callerSubRole === 'owner' && m.hq_sub_role !== 'owner' ? (
                        <select
                          value={m.hq_sub_role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value)}
                          disabled={submitting}
                          className="text-xs px-2 py-0.5 rounded-lg border border-gray-200 bg-white font-medium focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 cursor-pointer disabled:opacity-50"
                        >
                          {SUB_ROLES.filter(r => !r.ownerOnly).map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          m.hq_sub_role === 'owner'
                            ? 'bg-amber-100 text-amber-700'
                            : m.hq_sub_role === 'super_admin'
                            ? 'bg-[#6B1F3A]/10 text-[#6B1F3A]'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {roleLabel(m.hq_sub_role)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-400">
                      {new Date(m.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {(() => {
                        if (m.id === undefined) return null
                        if (callerSubRole === 'owner' && m.hq_sub_role !== 'owner') return (
                          <button onClick={() => handleRemove(m.id, m.name)} className="text-xs text-red-400 hover:text-red-600">{t('buttonRemove')}</button>
                        )
                        if (callerSubRole === 'super_admin' && m.hq_sub_role !== 'owner' && m.hq_sub_role !== 'super_admin') return (
                          <button onClick={() => handleRemove(m.id, m.name)} className="text-xs text-red-400 hover:text-red-600">{t('buttonRemove')}</button>
                        )
                        return null
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Permissions Matrix */}
      <div className="mt-12">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('permissionsMatrixTitle')}</h2>
          <p className="text-sm text-gray-600 mt-1">{t('permissionsMatrixDesc')}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-6 py-3 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">{t('columnPermission')}</th>
                {ROLES.map((role) => (
                  <th key={role} className="text-center px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10">
                    {PERMISSION_LABELS[perm]}
                  </td>
                  {ROLES.map((role) => {
                    const hasIt = HQ_PERMISSIONS[role].includes(perm)
                    return (
                      <td key={`${role}-${perm}`} className="text-center px-4 py-3">
                        {hasIt ? (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
                            <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100">
                            <span className="text-gray-400">—</span>
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
