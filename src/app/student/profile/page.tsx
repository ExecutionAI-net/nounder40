'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import SchoolSelectModal from '@/components/SchoolSelectModal'

interface Profile {
  name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  address: string | null
  city: string | null
  country: string | null
}

interface School { id: string; name: string; city: string; country: string }

interface StudentDoc {
  id: string
  type: 'medical_cert' | 'privacy' | 'image_release'
  file_url: string | null
  uploaded_at: string | null
  expires_at: string | null
  status: 'valid' | 'expiring' | 'expired'
  validated_at: string | null
  school_id: string
  schools: { name: string } | null
}

const DOC_LABELS: Record<string, string> = {
  medical_cert: 'Medical Certificate',
  privacy: 'Privacy Policy',
  image_release: 'Image Release',
}

const DOC_TYPES = ['medical_cert', 'privacy', 'image_release'] as const

const STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-100 text-green-700',
  expiring: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-600',
}

export default function StudentProfilePage() {
  const supabase = createClient()
  const [tab, setTab] = useState<'profile' | 'documents'>('profile')

  // Profile state
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentSchool, setCurrentSchool] = useState<School | null>(null)
  const [schoolModalOpen, setSchoolModalOpen] = useState(false)

  // Documents state
  const [docs, setDocs] = useState<StudentDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [enrolledSchools, setEnrolledSchools] = useState<{ id: string; name: string }[]>([])
  const [uploading, setUploading] = useState<string | null>(null) // 'schoolId-type'
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUpload, setPendingUpload] = useState<{ schoolId: string; type: string } | null>(null)

  useEffect(() => {
    fetch('/api/student/school')
      .then(r => r.json())
      .then(d => setCurrentSchool(d.school ?? null))
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase
        .from('profiles')
        .select('name, city')
        .eq('id', user.id)
        .single()

      let { data: student } = await supabase
        .from('students')
        .select('name, phone, date_of_birth, address, city, country')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!student) {
        const meta = user.user_metadata ?? {}
        const name = meta.name ?? profileData?.name ?? user.email!.split('@')[0]
        console.log('[profile] student not found, creating:', user.id)
        const { error: insertErr } = await supabase.from('students').insert({
          user_id: user.id,
          name,
          email: user.email!,
          phone: meta.phone ?? null,
          date_of_birth: meta.date_of_birth ?? null,
          city: meta.city ?? null,
          country: meta.country ?? null,
        })
        if (insertErr) {
          console.error('[profile] student insert error:', insertErr.message)
        } else {
          const { data: newStudent } = await supabase
            .from('students')
            .select('name, phone, date_of_birth, address, city, country')
            .eq('user_id', user.id)
            .maybeSingle()
          student = newStudent
        }
      }

      const merged: Profile = {
        name: student?.name ?? profileData?.name ?? '',
        email: user.email ?? '',
        phone: student?.phone ?? null,
        date_of_birth: student?.date_of_birth ?? null,
        address: student?.address ?? null,
        city: student?.city ?? profileData?.city ?? null,
        country: student?.country ?? null,
      }
      setProfile(merged)
      setForm(merged)
      setLoading(false)
    }
    load()
  }, [supabase])

  async function loadDocs() {
    setDocsLoading(true)
    try {
      const res = await fetch('/api/student/documents')
      const data = await res.json()
      setDocs(Array.isArray(data) ? data : [])

      // Get enrolled schools from school_students
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // school_students.student_id = auth.users.id
        const { data: enrollments } = await supabase
          .from('school_students')
          .select('school_id, schools(id, name)')
          .eq('student_id', user.id)
        const schools = (enrollments ?? []).map((e: { school_id: string; schools: { id: string; name: string } | null }) => ({
          id: e.school_id,
          name: (e.schools as { name: string } | null)?.name ?? e.school_id,
        }))
        setEnrolledSchools(schools)
      }
    } catch (e) {
      console.error('[profile/documents] load error:', e)
    }
    setDocsLoading(false)
  }

  useEffect(() => {
    if (tab === 'documents') loadDocs()
  }, [tab])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('profiles')
      .update({ name: form.name, city: form.city })
      .eq('id', user.id)

    const { error: err } = await supabase
      .from('students')
      .upsert({
        user_id: user.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        date_of_birth: form.date_of_birth || null,
        address: form.address,
        city: form.city,
        country: form.country,
      }, { onConflict: 'user_id' })

    if (err) {
      setError(err.message)
    } else {
      setSuccess(true)
      setProfile(form)
    }
    setSaving(false)
  }

  function triggerUpload(schoolId: string, type: string) {
    setPendingUpload({ schoolId, type })
    setUploadError(null)
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !pendingUpload) return

    const { schoolId, type } = pendingUpload
    const key = `${schoolId}-${type}`
    setUploading(key)
    setUploadError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const ext = file.name.split('.').pop()
      const path = `${user.id}/${schoolId}/${type}-${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: true })

      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
      const file_url = urlData.publicUrl

      const res = await fetch('/api/student/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, type, file_url }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Upload failed')

      await loadDocs()
    } catch (err: unknown) {
      console.error('[documents] upload error:', err)
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    }

    setUploading(null)
    setPendingUpload(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (loading || !form) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-100">
        {(['profile', 'documents'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition border-b-2 -mb-px ${
              tab === t ? 'border-[#6B1F3A] text-[#6B1F3A]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400"
                value={form.email}
                disabled
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.phone ?? ''}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date of Birth</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.date_of_birth ?? ''}
                onChange={e => setForm({ ...form, date_of_birth: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.address ?? ''}
                onChange={e => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.city ?? ''}
                  onChange={e => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.country ?? ''}
                  onChange={e => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {success && <p className="text-green-600 text-sm">Profile updated.</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#6B1F3A] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          {/* School */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">My School</p>
                {currentSchool ? (
                  <p className="text-sm text-gray-500 mt-0.5">{currentSchool.name} — {currentSchool.city}</p>
                ) : (
                  <p className="text-sm text-gray-400 mt-0.5">No school selected</p>
                )}
              </div>
              <button
                onClick={() => setSchoolModalOpen(true)}
                className="text-sm text-[#6B1F3A] font-medium hover:underline"
              >
                {currentSchool ? 'Change' : 'Select School'}
              </button>
            </div>
          </div>

          <SchoolSelectModal
            open={schoolModalOpen}
            currentSchoolId={currentSchool?.id}
            onSaved={(school) => { setCurrentSchool(school); setSchoolModalOpen(false) }}
          />
        </>
      )}

      {tab === 'documents' && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={handleFileChange}
          />

          {docsLoading ? (
            <div className="text-sm text-gray-400 py-8 text-center">Loading...</div>
          ) : enrolledSchools.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              You are not enrolled in any school yet.
            </div>
          ) : (
            <div className="space-y-6">
              {uploadError && (
                <p className="text-red-600 text-sm">{uploadError}</p>
              )}
              {enrolledSchools.map(school => (
                <div key={school.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-700">{school.name}</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {DOC_TYPES.map(type => {
                      const doc = docs.find(d => d.school_id === school.id && d.type === type)
                      const key = `${school.id}-${type}`
                      const isUploading = uploading === key
                      return (
                        <div key={type} className="flex items-center justify-between px-5 py-4">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{DOC_LABELS[type]}</p>
                            {doc ? (
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[doc.status]}`}>
                                  {doc.status}
                                </span>
                                {doc.expires_at && (
                                  <span className="text-xs text-gray-400">
                                    Expires {new Date(doc.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </span>
                                )}
                                {!doc.validated_at && (
                                  <span className="text-xs text-amber-600">Pending review</span>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 mt-0.5">Not uploaded</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            {doc?.file_url && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#6B1F3A] hover:underline"
                              >
                                View
                              </a>
                            )}
                            <button
                              onClick={() => triggerUpload(school.id, type)}
                              disabled={isUploading}
                              className="text-xs bg-[#6B1F3A] text-white px-3 py-1.5 rounded-lg hover:bg-[#5a1930] transition disabled:opacity-50"
                            >
                              {isUploading ? 'Uploading...' : doc ? 'Replace' : 'Upload'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
