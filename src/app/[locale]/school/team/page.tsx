'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatDate } from '@/lib/format-date'

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
      const res = await fetch('/api/school/team', { cache: 'no-store' })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to load team')
        setMembers([])
        setPending([])
      } else {
        setMembers(data.active || [])
        setPending(data.pending || [])
        setError(null)
      }
    } catch (err) {
      console.error('Error fetching team:', err)
      setError('Failed to load team')
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

      const res = await fetch('/api/school/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to invite team member')
        return
      }

      setSuccess(data.existing ? t('addedSuccess') : t('invitedSuccess'))
      setFormData({ email: '', name: '', school_sub_role: 'staff' })
      await fetchTeam()
    } catch (err) {
      console.error('Error inviting team member:', err)
      setError('Failed to invite team member')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(id: string, isPending: boolean = false) {
    if (!confirm(`Are you sure you want to remove this ${isPending ? 'pending invitation' : 'team member'}?`)) return

    try {
      const res = await fetch('/api/school/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, pending: isPending }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to remove')
        return
      }

      setSuccess(t('removedSuccess'))
      await fetchTeam()
    } catch (err) {
      console.error('Error removing:', err)
      setError('Failed to remove')
    }
  }

  async function handleResend(id: string) {
    try {
      const res = await fetch('/api/school/team/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to resend invitation')
        return
      }

      setSuccess(t('resentSuccess'))
    } catch (err) {
      console.error('Error resending:', err)
      setError('Failed to resend invitation')
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
                <option value="owner">{t('roleOwner')}</option>
                <option value="admin">{t('roleAdmin')}</option>
                <option value="staff">{t('roleStaff')}</option>
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
                    <td className="py-3 px-4 text-right">
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
    </div>
  )
}
