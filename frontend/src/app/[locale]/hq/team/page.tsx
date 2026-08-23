'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import { formatDate } from '@/lib/format-date'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

// Fallback while the dynamic role list loads
const DEFAULT_SUB_ROLES = [
  { value: 'owner',        label: 'Owner' },
  { value: 'super_admin',  label: 'Super Admin' },
  { value: 'operations',   label: 'Operations' },
  { value: 'finance',      label: 'Finance' },
  { value: 'tech_support', label: 'Tech Support' },
  { value: 'analytics',    label: 'Analytics' },
  { value: 'support',      label: 'Support' },
]

type Member = {
  id: string
  name: string
  email: string
  phone: string | null
  sub_role: string
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
  const { user } = useAuth()
  const callerSubRole = user?.hq_sub_role ?? null
  const [members, setMembers]   = useState<Member[]>([])
  const [pending, setPending]   = useState<Pending[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ name: '', email: '', hq_sub_role: 'operations' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState<string | null>(null)

  // Approve modal (manual activation fallback)
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  // Edit member modal (name + email + phone + role + password reset)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', phone: '', sub_role: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [resetSending, setResetSending] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Dynamic role list from the editable matrix (custom profiles included)
  const [dynamicRoles, setDynamicRoles] = useState<{ value: string; label: string }[] | null>(null)
  const SUB_ROLES = (dynamicRoles ?? DEFAULT_SUB_ROLES).map(r => ({ ...r, ownerOnly: r.value === 'owner' }))

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [membersData, pendingData, rolesData] = await Promise.all([
      apiFetch<Member[]>('/hq/team/').catch(() => []),
      apiFetch<Pending[]>('/hq/invitations/?type=hq_member').catch(() => []),
      apiFetch<{ key: string; label: string }[]>('/hq/permissions/').catch(() => []),
    ])
    setMembers(membersData)
    setPending(pendingData)
    setDynamicRoles(rolesData.map(r => ({ value: r.key, label: r.label })))
    setLoading(false)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await apiFetch('/hq/invitations/', {
        method: 'POST',
        body: JSON.stringify({ type: 'hq_member', name: form.name, email: form.email, role_detail: form.hq_sub_role }),
      })
      setSuccess(t('successInvitationSent', { email: form.email }))
      setForm({ name: '', email: '', hq_sub_role: 'operations' })
      setShowForm(false)
      await fetchData()
    } catch (err) {
      setError(errMsg(err, t('errorFailed')))
    }
    setSubmitting(false)
  }

  async function handleRemove(id: string, isPending = false) {
    await apiFetch(isPending ? `/hq/invitations/${id}/` : `/hq/team/${id}/`, { method: 'DELETE' }).catch(() => {})
    await fetchData()
  }

  async function handleRoleChange(id: string, newRole: string) {
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/hq/team/${id}/`, { method: 'PATCH', body: JSON.stringify({ sub_role: newRole }) })
      setSuccess(t('successRoleUpdated'))
      await fetchData()
    } catch (err) {
      setError(errMsg(err, t('errorRoleUpdate')))
    }
    setSubmitting(false)
  }

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault()
    if (!approveTarget) return
    setApproving(true)
    setApproveError(null)
    try {
      await apiFetch(`/hq/invitations/${approveTarget.id}/approve/`, { method: 'POST' })
      setApproveTarget(null)
      setSuccess(t('successActivated', { name: approveTarget.name }))
      await fetchData()
    } catch (err) {
      setApproveError(errMsg(err, t('errorActivate')))
    }
    setApproving(false)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditSaving(true)
    setEditError(null)
    try {
      const body: Record<string, string> = { name: editForm.name, phone: editForm.phone, email: editForm.email }
      // Il ruolo si cambia solo dove consentito (mai su un owner)
      if (editTarget.sub_role !== 'owner' && editForm.sub_role) body.sub_role = editForm.sub_role
      await apiFetch(`/hq/team/${editTarget.id}/`, { method: 'PATCH', body: JSON.stringify(body) })
      setEditTarget(null)
      setSuccess(t('successMemberUpdated'))
      await fetchData()
    } catch (err) {
      const raw = errMsg(err, t('errorFailed'))
      setEditError(raw === 'email_taken' ? t('errorEmailTaken') : raw)
    }
    setEditSaving(false)
  }

  // Invia al membro l'email con il link per impostare una nuova password
  async function handleResetPassword() {
    if (!editTarget) return
    setResetSending(true)
    try {
      await apiFetch('/auth/password-reset/', { method: 'POST', body: JSON.stringify({ email: editTarget.email }) })
      setResetSent(true)
    } catch {
      setEditError(t('errorFailed'))
    }
    setResetSending(false)
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
                <span className="mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  {roleLabel(approveTarget.role)}
                </span>
              </div>
              <form onSubmit={handleApprove} className="space-y-3">
                {approveError && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{approveError}</div>
                )}
                <p className="text-xs text-gray-400">{t('passwordNote')}</p>
                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={approving}
                    className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
                    {approving ? t('buttonActivating') : t('buttonGrantAccess')}
                  </button>
                  <button type="button"
                    onClick={() => { setApproveTarget(null); setApproveError(null) }}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="bg-white rounded-xl border border-amber-100 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-amber-50/50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnMember')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnRole')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnInvited')}</th>
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
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                        {roleLabel(p.role_detail)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-400 whitespace-nowrap">
                      {formatDate(p.created_at)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => { setApproveTarget({ id: p.id, name: p.name, email: p.email, role: p.role_detail }); setApproveError(null) }}
                          className="text-xs px-3 py-1.5 bg-[#6B1F3A] text-white rounded-lg hover:bg-[#5a1930] transition font-medium">
                          {t('buttonActivate')}
                        </button>
                        <ConfirmDeleteButton
                          label={t('buttonRemove')}
                          armedLabel={t('removeArmed')}
                          onDelete={() => handleRemove(p.id, true)}
                          className="text-red-400 hover:text-red-600 border-0 px-0"
                        />
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
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          {!members.length ? (
            <div className="p-8 text-center text-sm text-gray-400">{t('emptyState')}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnMember')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnRole')}</th>
                  <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide whitespace-nowrap">{t('columnAdded')}</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                      {m.phone && <p className="text-xs text-gray-400">{m.phone}</p>}
                    </td>
                    <td className="px-6 py-3">
                      {callerSubRole === 'owner' && m.sub_role !== 'owner' ? (
                        <select
                          value={m.sub_role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value)}
                          disabled={submitting}
                          className="text-xs px-2 py-0.5 rounded-lg border border-gray-200 bg-white font-medium focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 cursor-pointer disabled:opacity-50"
                        >
                          {SUB_ROLES.filter(r => !r.ownerOnly).map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                          m.sub_role === 'owner'
                            ? 'bg-amber-100 text-amber-700'
                            : m.sub_role === 'super_admin'
                            ? 'bg-[#6B1F3A]/10 text-[#6B1F3A]'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {roleLabel(m.sub_role)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-400 whitespace-nowrap">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {(() => {
                        if (m.id === undefined) return null
                        // Modifica: owner su tutti, super admin su tutti tranne owner
                        const canEdit =
                          callerSubRole === 'owner' ||
                          (callerSubRole === 'super_admin' && m.sub_role !== 'owner')
                        const canRemove =
                          (callerSubRole === 'owner' && m.sub_role !== 'owner') ||
                          (callerSubRole === 'super_admin' && m.sub_role !== 'owner' && m.sub_role !== 'super_admin')
                        if (!canEdit && !canRemove) return null
                        return (
                          <div className="flex items-center justify-end gap-3">
                            {canEdit && (
                              <button
                                onClick={() => {
                                  setEditTarget(m)
                                  setEditForm({ name: m.name, email: m.email, phone: m.phone ?? '', sub_role: m.sub_role })
                                  setEditError(null)
                                  setResetSent(false)
                                }}
                                className="text-xs text-gray-400 hover:text-gray-700"
                              >
                                {t('buttonEdit')}
                              </button>
                            )}
                            {canRemove && (
                              <ConfirmDeleteButton
                                label={t('buttonRemove')}
                                armedLabel={t('removeArmed')}
                                onDelete={() => handleRemove(m.id)}
                                className="text-red-400 hover:text-red-600 border-0 px-0"
                              />
                            )}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit member modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('modalEditTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editTarget.email}</p>
            </div>
            <form onSubmit={handleEditSave} className="px-6 py-5 space-y-4">
              {editError && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{editError}</div>}
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelFullName')}</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelEmail')}</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelPhone')}</label>
                <PhoneInput
                  value={editForm.phone}
                  onChange={phone => setEditForm(f => ({ ...f, phone }))}
                  inputClassName="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelRole')}</label>
                {editTarget.sub_role === 'owner' ? (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                    {roleLabel('owner')}
                  </span>
                ) : (
                  <select
                    value={editForm.sub_role}
                    onChange={e => setEditForm(f => ({ ...f, sub_role: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  >
                    {SUB_ROLES.filter(r => !r.ownerOnly || callerSubRole === 'owner').map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                )}
              </div>
              {/* Reset password: invia il link di reimpostazione via email */}
              <div className="pt-1 border-t border-gray-100">
                {resetSent ? (
                  <p className="text-xs text-green-600 pt-2">{t('resetPasswordSent', { email: editTarget.email })}</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetSending}
                    className="mt-2 text-xs text-[#6B1F3A] font-medium hover:underline disabled:opacity-50"
                  >
                    {resetSending ? t('buttonSending') : t('buttonResetPassword')}
                  </button>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={editSaving || !editForm.name.trim()}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
                  {editSaving ? t('buttonSaving') : t('buttonSaveChanges')}
                </button>
                <button type="button" onClick={() => setEditTarget(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                  {t('buttonCancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* The permissions matrix lives in HQ > Permissions (editable, custom profiles) */}
      <div className="mt-12 bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{t('permissionsMatrixTitle')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('permissionsMatrixDesc')}</p>
        </div>
        <Link href="/hq/permissions" className="text-sm text-[#6B1F3A] font-medium hover:underline whitespace-nowrap">
          {t('linkPermissions')} →
        </Link>
      </div>
    </div>
  )
}
