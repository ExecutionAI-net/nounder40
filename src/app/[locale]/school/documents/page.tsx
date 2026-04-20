'use client'

import { useEffect, useState, useCallback } from 'react'

type StudentDoc = {
  id: string
  type: 'medical_cert' | 'privacy' | 'image_release'
  file_url: string | null
  uploaded_at: string | null
  expires_at: string | null
  status: 'valid' | 'expiring' | 'expired'
  validated_by: string | null
  validated_at: string | null
  students: { id: string; name: string; email: string } | null
}

const DOC_LABELS: Record<string, string> = {
  medical_cert: 'Medical Certificate',
  privacy: 'Privacy Policy',
  image_release: 'Image Release',
}

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-600',
}

export default function SchoolDocumentsPage() {
  const [docs, setDocs] = useState<StudentDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [validating, setValidating] = useState<string | null>(null)
  // inline approve form state: docId -> expiry date string
  const [approveExpiry, setApproveExpiry] = useState<Record<string, string>>({})
  const [approveOpen, setApproveOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await fetch('/api/school/documents').then(r => r.json())
    setDocs(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleValidate(id: string, action: 'validate' | 'reject') {
    setValidating(id)
    const body: Record<string, unknown> = { action }
    if (action === 'validate' && approveExpiry[id]) {
      body.expires_at = new Date(approveExpiry[id]).toISOString()
    }
    await fetch(`/api/school/documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setApproveOpen(null)
    setApproveExpiry(prev => { const n = { ...prev }; delete n[id]; return n })
    await load()
    setValidating(null)
  }

  const filtered = docs.filter(d => {
    if (filterStatus === 'pending') {
      if (!(!d.validated_at && d.file_url)) return false
    } else if (filterStatus && d.status !== filterStatus) return false
    if (filterType && d.type !== filterType) return false
    return true
  })

  const pending = docs.filter(d => !d.validated_at && d.file_url).length
  const expiring = docs.filter(d => d.status === 'expiring').length
  const expired = docs.filter(d => d.status === 'expired').length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage and validate student documents</p>
      </div>

      {/* Summary — clickable filters */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <button
          onClick={() => setFilterStatus(filterStatus === 'pending' ? '' : 'pending')}
          className={`text-left bg-white rounded-xl border p-5 transition ${filterStatus === 'pending' ? 'border-gray-400 ring-1 ring-gray-300' : 'border-gray-100 hover:border-gray-300'}`}
        >
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Pending Validation</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{pending}</p>
        </button>
        <button
          onClick={() => setFilterStatus(filterStatus === 'expiring' ? '' : 'expiring')}
          className={`text-left bg-white rounded-xl border p-5 transition ${filterStatus === 'expiring' ? 'border-yellow-400 ring-1 ring-yellow-200' : 'border-gray-100 hover:border-gray-300'}`}
        >
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Expiring Soon</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{expiring}</p>
        </button>
        <button
          onClick={() => setFilterStatus(filterStatus === 'expired' ? '' : 'expired')}
          className={`text-left bg-white rounded-xl border p-5 transition ${filterStatus === 'expired' ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-100 hover:border-gray-300'}`}
        >
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Expired</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{expired}</p>
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All statuses</option>
          <option value="valid">Valid</option>
          <option value="expiring">Expiring</option>
          <option value="expired">Expired</option>
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="">All types</option>
          <option value="medical_cert">Medical Certificate</option>
          <option value="privacy">Privacy Policy</option>
          <option value="image_release">Image Release</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No documents found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Student</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Document</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Uploaded</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Expires</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    {doc.students ? (
                      <div>
                        <p className="font-medium text-gray-900">{doc.students.name}</p>
                        <p className="text-xs text-gray-400">{doc.students.email}</p>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-3 text-gray-700">
                    {DOC_LABELS[doc.type]}
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {doc.uploaded_at
                      ? new Date(doc.uploaded_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {doc.expires_at
                      ? new Date(doc.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[doc.status]}`}>
                      {doc.status}
                    </span>
                    {!doc.validated_at && doc.file_url && (
                      <span className="ml-2 text-xs text-amber-600 font-medium">Pending review</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        {doc.file_url && (
                          <a
                            href={doc.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[#6B1F3A] hover:underline"
                          >
                            View
                          </a>
                        )}
                        {!doc.validated_at && doc.file_url && (
                          <>
                            <button
                              onClick={() => setApproveOpen(approveOpen === doc.id ? null : doc.id)}
                              disabled={validating === doc.id}
                              className="text-xs text-green-600 hover:text-green-800 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleValidate(doc.id, 'reject')}
                              disabled={validating === doc.id}
                              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {doc.validated_at && (
                          <span className="text-xs text-gray-400">
                            Validated {new Date(doc.validated_at).toLocaleDateString('en-GB')}
                          </span>
                        )}
                      </div>
                      {/* Inline approve form */}
                      {approveOpen === doc.id && (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            type="date"
                            value={approveExpiry[doc.id] ?? ''}
                            onChange={e => setApproveExpiry(prev => ({ ...prev, [doc.id]: e.target.value }))}
                            className="text-xs border border-gray-200 rounded px-2 py-1"
                            placeholder="Expiry date (optional)"
                          />
                          <button
                            onClick={() => handleValidate(doc.id, 'validate')}
                            disabled={validating === doc.id}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setApproveOpen(null)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
