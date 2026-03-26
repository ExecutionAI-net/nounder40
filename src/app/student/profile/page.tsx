'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Profile {
  name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  address: string | null
  city: string | null
  country: string | null
}

export default function StudentProfilePage() {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('name, city')
        .eq('id', user.id)
        .single()
      // Also get extended student info
      const { data: student } = await supabase
        .from('students')
        .select('name, phone, date_of_birth, address, city, country')
        .eq('user_id', user.id)
        .maybeSingle()

      const merged: Profile = {
        name: student?.name ?? data?.name ?? '',
        email: user.email ?? '',
        phone: student?.phone ?? null,
        date_of_birth: student?.date_of_birth ?? null,
        address: student?.address ?? null,
        city: student?.city ?? data?.city ?? null,
        country: student?.country ?? null,
      }
      setProfile(merged)
      setForm(merged)
      setLoading(false)
    }
    load()
  }, [supabase])

  async function handleSave() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Update profiles table
    await supabase
      .from('profiles')
      .update({ name: form.name, city: form.city })
      .eq('id', user.id)

    // Upsert students table
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

  if (loading || !form) {
    return <div className="animate-pulse h-8 bg-gray-100 rounded w-48" />
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile</h1>

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
    </div>
  )
}
