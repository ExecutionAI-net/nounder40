'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ALL_PERMISSIONS, PERMISSION_LABELS } from '@/lib/hq-permissions'
import type { Permission } from '@/lib/hq-permissions'
import ErrorBanner from '@/components/ui/ErrorBanner'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useAuth } from '@/lib/api/auth-context'

type Role = { key: string; label: string; builtin: boolean; permissions: string[]; memberCount: number }

// Sezioni del pannello scuola (stesse key della nav.school)
const SCHOOL_SECTIONS = [
  'dashboard', 'locations', 'calendar', 'courses', 'lessons', 'teachers',
  'compensation', 'students', 'packages', 'payments', 'documents', 'inbox',
  'reports', 'settings', 'attendanceStatuses', 'manualCredits', 'team',
] as const

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

export default function PermissionsPage() {
  const t = useTranslations('hq.permissions')
  const tSchoolNav = useTranslations('nav.school')
  const { user } = useAuth()
  const callerSubRole = user?.hq_sub_role ?? null
  const [roles, setRoles] = useState<Role[]>([])
  // Matrice ruoli SCUOLA: configurata qui (accentrata), letta dalle scuole
  const [schoolRoles, setSchoolRoles] = useState<Role[]>([])
  const [schoolDirty, setSchoolDirty] = useState<Set<string>>(new Set())
  const allPermissions: readonly string[] = ALL_PERMISSIONS
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [showAddRole, setShowAddRole] = useState(false)
  const [newRoleLabel, setNewRoleLabel] = useState('')
  const [addingRole, setAddingRole] = useState(false)

  const canEdit = callerSubRole === 'owner' || callerSubRole === 'super_admin'

  async function load() {
    try {
      setRoles(await apiFetch<Role[]>('/hq/permissions/'))
      setSchoolRoles(await apiFetch<Role[]>('/hq/school-permissions/').catch(() => []))
    } catch {
      setError(t('errorLoad')); setLoading(false); return
    }
    setDirty(new Set())
    setSchoolDirty(new Set())
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(roleKey: string, perm: string) {
    if (!canEdit || roleKey === 'owner') return
    setSavedMsg(null)
    setRoles(rs => rs.map(r => {
      if (r.key !== roleKey) return r
      const has = r.permissions.includes(perm)
      return { ...r, permissions: has ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm] }
    }))
    setDirty(d => new Set(d).add(roleKey))
  }

  function toggleSchool(roleKey: string, perm: string) {
    // owner scuola sempre completo; dashboard sempre visibile
    if (!canEdit || roleKey === 'owner' || perm === 'dashboard') return
    setSavedMsg(null)
    setSchoolRoles(rs => rs.map(r => {
      if (r.key !== roleKey) return r
      const has = r.permissions.includes(perm)
      return { ...r, permissions: has ? r.permissions.filter(p => p !== perm) : [...r.permissions, perm] }
    }))
    setSchoolDirty(d => new Set(d).add(roleKey))
  }

  async function saveAll() {
    setSaving(true)
    setError(null)
    for (const key of dirty) {
      const role = roles.find(r => r.key === key)
      if (!role) continue
      try {
        await apiFetch(`/hq/permissions/${key}/`, { method: 'PATCH', body: JSON.stringify({ permissions: role.permissions }) })
      } catch (err) {
        setError(errMsg(err, t('errorSave')))
        setSaving(false)
        return
      }
    }
    for (const key of schoolDirty) {
      const role = schoolRoles.find(r => r.key === key)
      if (!role) continue
      try {
        await apiFetch(`/hq/school-permissions/${key}/`, { method: 'PATCH', body: JSON.stringify({ permissions: role.permissions }) })
      } catch (err) {
        setError(errMsg(err, t('errorSave')))
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setSavedMsg(t('saved'))
    await load()
  }

  async function addRole() {
    if (!newRoleLabel.trim()) return
    setAddingRole(true)
    setError(null)
    try {
      await apiFetch('/hq/permissions/', { method: 'POST', body: JSON.stringify({ label: newRoleLabel }) })
      setNewRoleLabel('')
      setShowAddRole(false)
      await load()
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string } : null
      setError(body?.error === 'role_exists' ? t('errorRoleExists') : body?.error ?? t('errorSave'))
    }
    setAddingRole(false)
  }

  async function deleteRole(key: string) {
    setError(null)
    try {
      await apiFetch(`/hq/permissions/${key}/`, { method: 'DELETE' })
      await load()
    } catch (err) {
      const body = err instanceof ApiError ? err.body as { error?: string; count?: number } : null
      setError(body?.error === 'role_in_use' ? t('errorRoleInUse', { count: body.count ?? 0 }) : body?.error ?? t('errorSave'))
    }
  }

  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('pageTitle')}</h1>
          <p className="text-gray-500 text-sm mt-1">{canEdit ? t('pageDescriptionEditable') : t('pageDescriptionReadOnly')}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddRole(true)}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              + {t('buttonAddProfile')}
            </button>
            <button
              onClick={saveAll}
              disabled={(!dirty.size && !schoolDirty.size) || saving}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-40"
            >
              {saving ? t('buttonSaving') : t('buttonSave', { count: dirty.size + schoolDirty.size })}
            </button>
          </div>
        )}
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {savedMsg && (
        <div className="mb-4 flex items-start justify-between gap-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">
          <span>{savedMsg}</span>
          <button onClick={() => setSavedMsg(null)} className="text-green-400 hover:text-green-600 shrink-0">×</button>
        </div>
      )}

      {showAddRole && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 flex items-center gap-2">
          <input
            value={newRoleLabel}
            onChange={e => setNewRoleLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRole()}
            placeholder={t('placeholderProfileName')}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
            autoFocus
          />
          <button onClick={addRole} disabled={addingRole || !newRoleLabel.trim()}
            className="px-4 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm disabled:opacity-50">
            {addingRole ? '…' : t('buttonCreate')}
          </button>
          <button onClick={() => setShowAddRole(false)}
            className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600">
            {t('buttonCancel')}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">{t('columnPermission')}</th>
              {roles.map((role) => (
                <th key={role.key} className="text-center px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                  <div className="flex flex-col items-center gap-1">
                    <span className={dirty.has(role.key) ? 'text-[#6B1F3A]' : ''}>
                      {role.label}{dirty.has(role.key) ? ' *' : ''}
                    </span>
                    <span className="text-[10px] font-normal text-gray-400">{t('memberCount', { count: role.memberCount })}</span>
                    {!role.builtin && canEdit && (
                      <ConfirmDeleteButton
                        label={t('buttonDeleteProfile')}
                        armedLabel={t('deleteProfileArmed')}
                        onArm={async () => {
                          if (role.memberCount > 0) {
                            setError(t('errorRoleInUse', { count: role.memberCount }))
                            return null
                          }
                          return t('deleteProfileArmed')
                        }}
                        onDelete={() => deleteRole(role.key)}
                        className="border border-red-100 text-red-400 hover:bg-red-50 text-[10px] px-2 py-0.5"
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allPermissions.map((perm) => (
              <tr key={perm} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">
                  {PERMISSION_LABELS[perm as Permission] ?? perm}
                </td>
                {roles.map((role) => {
                  const hasIt = role.permissions.includes(perm)
                  const locked = !canEdit || role.key === 'owner'
                  return (
                    <td key={`${role.key}-${perm}`} className="text-center px-4 py-2.5">
                      <button
                        onClick={() => toggle(role.key, perm)}
                        disabled={locked}
                        title={role.key === 'owner' ? t('ownerLocked') : undefined}
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition ${
                          hasIt ? 'bg-green-100 hover:bg-green-200' : 'bg-gray-100 hover:bg-gray-200'
                        } ${locked ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                      >
                        {hasIt ? (
                          <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <p className="mt-4 text-xs text-gray-400">{t('hintAntiLockout')}</p>
      )}

      {/* Matrice ruoli SCUOLA: decisa qui da HQ, le scuole la leggono in Team */}
      {schoolRoles.length > 0 && (
        <div className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-gray-900">{t('schoolSectionTitle')}</h2>
            <p className="text-gray-500 text-sm mt-1">{t('schoolSectionHint')}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-6 py-3 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10 whitespace-nowrap">{t('columnSection')}</th>
                  {schoolRoles.map((role) => (
                    <th key={role.key} className="text-center px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <span className={schoolDirty.has(role.key) ? 'text-[#6B1F3A]' : ''}>
                          {role.label}{schoolDirty.has(role.key) ? ' *' : ''}
                        </span>
                        <span className="text-[10px] font-normal text-gray-400">{t('memberCount', { count: role.memberCount })}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SCHOOL_SECTIONS.map((perm) => (
                  <tr key={perm} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">
                      {tSchoolNav(perm)}
                    </td>
                    {schoolRoles.map((role) => {
                      const hasIt = role.permissions.includes(perm)
                      const locked = !canEdit || role.key === 'owner' || perm === 'dashboard'
                      return (
                        <td key={`${role.key}-${perm}`} className="text-center px-4 py-2.5">
                          <button
                            onClick={() => toggleSchool(role.key, perm)}
                            disabled={locked}
                            title={role.key === 'owner' ? t('ownerLocked') : undefined}
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition ${
                              hasIt ? 'bg-green-100 hover:bg-green-200' : 'bg-gray-100 hover:bg-gray-200'
                            } ${locked ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                          >
                            {hasIt ? (
                              <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <span className="text-gray-400 text-xs">—</span>
                            )}
                          </button>
                        </td>
                      )
                    })}
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
