'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState<'account' | 'profile'>('account')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [account, setAccount] = useState({ email: '', password: '', confirmPassword: '' })
  const [profile, setProfile] = useState({ name: '', phone: '', date_of_birth: '', city: '', country: 'IT' })

  async function handleAccountNext() {
    if (!account.email || !account.password) { setError('Email and password are required.'); return }
    if (account.password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (account.password !== account.confirmPassword) { setError('Passwords do not match.'); return }
    setError(null)
    setStep('profile')
  }

  async function handleRegister() {
    if (!profile.name) { setError('Full name is required.'); return }
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: account.email,
      password: account.password,
      options: {
        data: { name: profile.name },
      },
    })

    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'Registration failed.')
      setLoading(false)
      return
    }

    // Update profile with student role and details
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: data.user.id,
      name: profile.name,
      email: account.email,
      phone: profile.phone || null,
      date_of_birth: profile.date_of_birth || null,
      city: profile.city || null,
      country: profile.country,
      role: 'student',
    })

    if (profileError) {
      setError(profileError.message)
      setLoading(false)
      return
    }

    router.push('/student/dashboard')
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#6B1F3A]">No Under 40</h1>
          <p className="text-gray-500 text-sm mt-1">Create your student account</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-8">
          {/* Step indicator */}
          <div className="flex items-center mb-6">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === 'account' || step === 'profile' ? 'bg-[#6B1F3A] text-white' : 'bg-gray-100 text-gray-400'}`}>
              {step === 'profile' ? '✓' : '1'}
            </div>
            <div className={`h-0.5 flex-1 mx-2 ${step === 'profile' ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === 'profile' ? 'bg-[#6B1F3A] text-white' : 'bg-gray-100 text-gray-400'}`}>2</div>
          </div>

          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {step === 'account' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Account details</h2>
              <div>
                <label className={labelCls}>Email *</label>
                <input type="email" value={account.email} onChange={(e) => setAccount(a => ({ ...a, email: e.target.value }))} className={inputCls} placeholder="you@example.com" />
              </div>
              <div>
                <label className={labelCls}>Password *</label>
                <input type="password" value={account.password} onChange={(e) => setAccount(a => ({ ...a, password: e.target.value }))} className={inputCls} placeholder="Min. 6 characters" />
              </div>
              <div>
                <label className={labelCls}>Confirm Password *</label>
                <input type="password" value={account.confirmPassword} onChange={(e) => setAccount(a => ({ ...a, confirmPassword: e.target.value }))} className={inputCls} placeholder="Repeat password" />
              </div>
              <button onClick={handleAccountNext} className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition mt-2">
                Continue →
              </button>
            </div>
          )}

          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Your profile</h2>
              <div>
                <label className={labelCls}>Full Name *</label>
                <input value={profile.name} onChange={(e) => setProfile(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="First and last name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="tel" value={profile.phone} onChange={(e) => setProfile(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="+39..." />
                </div>
                <div>
                  <label className={labelCls}>Date of Birth</label>
                  <input type="date" value={profile.date_of_birth} onChange={(e) => setProfile(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>City</label>
                  <input value={profile.city} onChange={(e) => setProfile(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="e.g. Milano" />
                </div>
                <div>
                  <label className={labelCls}>Country</label>
                  <select value={profile.country} onChange={(e) => setProfile(p => ({ ...p, country: e.target.value }))} className={inputCls}>
                    <option value="IT">Italy</option>
                    <option value="FR">France</option>
                    <option value="ES">Spain</option>
                    <option value="DE">Germany</option>
                    <option value="GB">United Kingdom</option>
                    <option value="US">United States</option>
                    <option value="TR">Turkey</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => { setStep('account'); setError(null) }} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  ← Back
                </button>
                <button onClick={handleRegister} disabled={loading} className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] disabled:opacity-50 transition">
                  {loading ? 'Creating account...' : 'Create Account'}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-[#6B1F3A] font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
