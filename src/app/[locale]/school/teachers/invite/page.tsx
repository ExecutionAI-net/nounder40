'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import PhoneInput from '@/components/ui/PhoneInput'

export default function InviteTeacherPage() {
  const t = useTranslations('school.teachers.invite')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [form, setForm]       = useState({ name: '', email: '', phone: '' })

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/school/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        setLoading(false)
        return
      }
      // Teacher created — redirect with success message (email may have failed)
      router.push(`/school/teachers?added=${encodeURIComponent(form.name)}&emailSent=${data.email_sent ? '1' : '0'}`)
    } catch {
      setError('Request failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <Link href="/school/teachers" className="text-sm text-gray-400 hover:text-gray-600">{t('backToTeachers')}</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('description')}</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelFullName')}</label>
          <input name="name" required value={form.name} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="Marco Rossi" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelEmail')}</label>
          <input name="email" type="email" required value={form.email} onChange={handleChange}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]"
            placeholder="teacher@example.com" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelPhone')}</label>
          <PhoneInput value={form.phone} onChange={phone => setForm(f => ({ ...f, phone }))}
            inputClassName="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 focus:border-[#6B1F3A]" />
        </div>

        <div className="pt-2 flex gap-3">
          <button type="submit" disabled={loading}
            className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50">
            {loading ? t('adding') : t('title')}
          </button>
          <Link href="/school/teachers"
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
            {t('cancel')}
          </Link>
        </div>
      </form>
    </div>
  )
}
