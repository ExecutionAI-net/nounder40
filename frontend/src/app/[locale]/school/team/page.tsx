'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatDate } from '@/lib/format-date'
import PhoneInput from '@/components/ui/PhoneInput'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

interface TeamMember {
  id: string
  name: string
  email: string
  school_sub_role: string
  created_at: string
}

interface PendingInvite {
  id: string
  name: string
  email: string
  role_detail: string
  created_at: string
}

export default function TeamPage() {
  const t = useTranslations('school.team')
  const uiLocale = useLocale()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [pending, setPending] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({ email: '', name: '', school_sub_role: 'staff' })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  // Legenda ruoli → permessi: definita da HQ, qui in sola lettura
  const tNav = useTranslations('nav.school')
  const [roleMatrix, setRoleMatrix] = useState<{ key: string; label: string; permissions: string[] }[]>([])
  useEffect(() => {
    apiFetch<{ key: string; label: string; permissions: string[] }[]>('/school/permissions/')
      .then(setRoleMatrix)
      .catch(() => {})
  }, [])

  // Modifica membro (nome/cognome, email, telefono, ruolo, reset password)
  const { user } = useAuth()
  const callerRole = user?.school_sub_role ?? ''
  const [editTarget, setEditTarget] = useState<TeamMember | null>(null)
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', phone: '', school_sub_role: 'staff' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetSending, setResetSending] = useState(false)

  function openEdit(m: TeamMember) {
    const [head, ...rest] = (m.name || '').split(' ')
    setEditForm({ first_name: head || '', last_name: rest.join(' '), email: m.email, phone: '', school_sub_role: m.school_sub_role })
    setEditTarget(m)
    setEditError(null)
    setResetSent(false)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    setEditSaving(true)
    setEditError(null)
    try {
      const body: Record<string, string> = {
        id: editTarget.id,
        first_name: editForm.first_name, last_name: editForm.last_name,
        email: editForm.email, phone: editForm.phone,
      }
      if (editTarget.school_sub_role !== 'owner') body.school_sub_role = editForm.school_sub_role
      await apiFetch('/school/team/', { method: 'PATCH', body: JSON.stringify(body) })
      setEditTarget(null)
      setSuccess(t('memberUpdated'))
      await fetchTeam()
    } catch (err) {
      const code = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setEditError(code === 'email_taken' ? t('errorEmailTaken') : code ?? t('errorGeneric'))
    }
    setEditSaving(false)
  }

  async function handleResetPassword() {
    if (!editTarget) return
    setResetSending(true)
    try {
      await apiFetch('/auth/password-reset/', { method: 'POST', body: JSON.stringify({ email: editTarget.email }) })
      setResetSent(true)
    } catch {
      setEditError(t('errorGeneric'))
    }
    setResetSending(false)
  }

  const SUB_ROLE_LABELS: Record<string, string> = {
    owner: t('roleOwner'),
    admin: t('roleAdmin'),
    staff: t('roleStaff'),
  }

  useEffect(() => {
    fetchTeam()
   
  }, [])

  async function fetchTeam() {
    try {
      setLoading(true)
      const data = await apiFetch<{ active: TeamMember[]; pending: PendingInvite[] }>('/school/team/')
      setMembers(data.active || [])
      setPending(data.pending || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching team:', err)
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Failed to load team')
      setMembers([])
      setPending([])
    } finally {
      setLoading(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!formData.email || !formData.name) {
      setError('Email and name are required')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      setSuccess(null)

      const data = await apiFetch<{ existing: boolean }>('/school/team/', {
        method: 'POST',
        body: JSON.stringify(formData),
      })

      setSuccess(data.existing ? t('addedSuccess') : t('invitedSuccess'))
      setFormData({ email: '', name: '', school_sub_role: 'staff' })
      await fetchTeam()
    } catch (err) {
      console.error('Error inviting team member:', err)
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Failed to invite team member')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id: string, isPending: boolean = false) {
    if (!confirm(`Are you sure you want to remove this ${isPending ? 'pending invitation' : 'team member'}?`)) return

    try {
      await apiFetch('/school/team/', { method: 'DELETE', body: JSON.stringify({ id, pending: isPending }) })
      setSuccess(t('removedSuccess'))
      await fetchTeam()
    } catch (err) {
      console.error('Error removing:', err)
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Failed to remove')
    }
  }

  async function handleResend(id: string) {
    try {
      await apiFetch('/school/team/resend/', { method: 'POST', body: JSON.stringify({ id }) })
      setSuccess(t('resentSuccess'))
    } catch (err) {
      console.error('Error resending:', err)
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string }).error : undefined
      setError(errCode ?? 'Failed to resend invitation')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">{t('loading')}</div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-600 mt-2">{t('subtitle')}</p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* Invite Form */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('inviteTitle')}</h2>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelEmail')}</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="team@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelName')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelRole')}</label>
              <select
                value={formData.school_sub_role}
                onChange={(e) => setFormData({ ...formData, school_sub_role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={submitting}
              >
                {(roleMatrix.length ? roleMatrix : [
                  { key: 'owner', label: t('roleOwner'), permissions: [] },
                  { key: 'admin', label: t('roleAdmin'), permissions: [] },
                  { key: 'staff', label: t('roleStaff'), permissions: [] },
                ]).map(r => (
                  <option key={r.key} value={r.key}>{SUB_ROLE_LABELS[r.key] ?? r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:bg-gray-400 transition"
          >
            {submitting ? t('sending') : t('sendInvitation')}
          </button>
        </form>
      </div>

      {/* Active Members */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('activeMembers', { count: members.length })}</h2>
        {members.length === 0 ? (
          <p className="text-gray-500 text-sm">{t('noMembers')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colName')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colEmail')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colRole')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colAdded')}</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">{member.name}</td>
                    <td className="py-3 px-4 text-gray-600">{member.email}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {SUB_ROLE_LABELS[member.school_sub_role] || member.school_sub_role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500">
                      {new Date(member.created_at).toLocaleDateString(uiLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap space-x-3">
                      {(callerRole === 'owner' || (callerRole === 'admin' && member.school_sub_role !== 'owner')) && (
                        <button
                          onClick={() => openEdit(member)}
                          className="text-gray-500 hover:text-gray-700 text-xs font-medium transition"
                        >
                          {t('edit')}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(member.id)}
                        className="text-red-600 hover:text-red-700 text-xs font-medium transition"
                      >
                        {t('remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      {pending.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">{t('pendingInvitations', { count: pending.length })}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colName')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colEmail')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colRole')}</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">{t('colInvited')}</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((invite) => (
                  <tr key={invite.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">{invite.name}</td>
                    <td className="py-3 px-4 text-gray-600">{invite.email}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        {SUB_ROLE_LABELS[invite.role_detail] || invite.role_detail}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500">
                      {formatDate(invite.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleResend(invite.id)}
                        className="text-blue-600 hover:text-blue-700 text-xs font-medium transition"
                      >
                        {t('resend')}
                      </button>
                      <button
                        onClick={() => handleRemove(invite.id, true)}
                        className="text-red-600 hover:text-red-700 text-xs font-medium transition"
                      >
                        {t('remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legenda ruoli: cosa può fare ogni profilo (definito da HQ, sola lettura) */}
      {roleMatrix.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mt-8">
          <h2 className="text-lg font-bold text-gray-900 mb-1">{t('rolesLegendTitle')}</h2>
          <p className="text-sm text-gray-500 mb-4">{t('rolesLegendHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {roleMatrix.map(role => (
              <div key={role.key} className="border border-gray-100 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-900 mb-2">
                  {SUB_ROLE_LABELS[role.key] ?? role.label}
                </p>
                <ul className="space-y-1">
                  {role.permissions.map(p => (
                    <li key={p} className="text-xs text-gray-600 flex items-center gap-1.5">
                      <span className="text-green-500">✓</span> {tNav(p as Parameters<typeof tNav>[0])}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modale modifica membro (stesso schema del Team HQ) */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-lg">{t('editTitle')}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{editTarget.email}</p>
            </div>
            <form onSubmit={handleEditSave} className="px-6 py-5 space-y-4">
              {editError && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{editError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelFirstName')}</label>
                  <input
                    value={editForm.first_name}
                    onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('labelLastName')}</label>
                  <input
                    value={editForm.last_name}
                    onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelEmail')}</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelPhone')}</label>
                <PhoneInput
                  value={editForm.phone}
                  onChange={phone => setEditForm(f => ({ ...f, phone }))}
                  inputClassName="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('labelRole')}</label>
                {editTarget.school_sub_role === 'owner' ? (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">{t('roleOwner')}</span>
                ) : (
                  <select
                    value={editForm.school_sub_role}
                    onChange={e => setEditForm(f => ({ ...f, school_sub_role: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  >
                    {(roleMatrix.length ? roleMatrix : [
                      { key: 'owner', label: t('roleOwner'), permissions: [] },
                      { key: 'admin', label: t('roleAdmin'), permissions: [] },
                      { key: 'staff', label: t('roleStaff'), permissions: [] },
                    ])
                      .filter(r => r.key !== 'owner' || callerRole === 'owner')
                      .map(r => (
                        <option key={r.key} value={r.key}>{SUB_ROLE_LABELS[r.key] ?? r.label}</option>
                      ))}
                  </select>
                )}
              </div>
              <div className="pt-1 border-t border-gray-100">
                {resetSent ? (
                  <p className="text-xs text-green-600 pt-2">{t('resetPasswordSent', { email: editTarget.email })}</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetSending}
                    className="mt-2 text-xs text-purple-700 font-medium hover:underline disabled:opacity-50"
                  >
                    {resetSending ? t('sending') : t('buttonResetPassword')}
                  </button>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={editSaving || !editForm.first_name.trim()}
                  className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50">
                  {editSaving ? t('saving') : t('saveChanges')}
                </button>
                <button type="button" onClick={() => setEditTarget(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
