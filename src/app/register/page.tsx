'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type School = { id: string; name: string; city: string; country: string }

export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState<'school' | 'profile' | 'account'>('school')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const [schools, setSchools] = useState<School[]>([])

  const [schoolId, setSchoolId] = useState('')
  const [profile, setProfile] = useState({ name: '', phone: '', date_of_birth: '', city: '', country: 'IT' })
  const [account, setAccount] = useState({ email: '', password: '' })

  useEffect(() => {
    fetch('/api/schools/public')
      .then(r => r.json())
      .then(d => setSchools(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [])

  function handleSchoolNext() {
    if (!schoolId) { setError('Please select a school.'); return }
    setError(null)
    setStep('profile')
  }

  function handleProfileNext() {
    if (!profile.name) { setError('Full name is required.'); return }
    setError(null)
    setStep('account')
  }

  async function handleRegister() {
    if (!account.email) { setError('Email is required.'); return }
    if (!account.password) { setError('Password is required.'); return }
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: account.email,
      password: account.password,
      options: {
        data: {
          name: profile.name,
          school_id: schoolId,
          phone: profile.phone || null,
          date_of_birth: profile.date_of_birth || null,
          city: profile.city || null,
          country: profile.country,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (signUpError || !data.user) {
      const msg = signUpError?.message ?? 'Registration failed.'
      setError(
        msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already been registered')
          ? 'An account with this email already exists. Please sign in or use a different email.'
          : msg
      )
      setLoading(false)
      return
    }

    if (data.session) {
      // Session available — do everything client-side (user's own auth.uid() satisfies RLS)

      // Update profile (trigger already inserted it, just update name/role)
      await supabase.from('profiles')
        .update({ name: profile.name, email: account.email, role: 'student' })
        .eq('id', data.user.id)

      // Ensure student record exists
      const { data: existingStudent } = await supabase
        .from('students').select('id').eq('user_id', data.user.id).maybeSingle()
      let studentId = existingStudent?.id
      if (!studentId) {
        const { data: newStudent } = await supabase.from('students').insert({
          user_id: data.user.id,
          name: profile.name,
          email: account.email,
          phone: profile.phone || null,
          date_of_birth: profile.date_of_birth || null,
          city: profile.city || null,
          country: profile.country,
        }).select('id').single()
        studentId = newStudent?.id
      }

      // Link student to school
      if (studentId && schoolId) {
        await supabase.from('school_students').upsert(
          { school_id: schoolId, student_id: studentId, free_lesson_used: false },
          { onConflict: 'school_id,student_id', ignoreDuplicates: true }
        )
      }

      router.push('/student/dashboard')
      return
    }

    setVerifyEmail(account.email)
    setLoading(false)
  }

  const inputCls = 'w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

  const STEPS = ['school', 'profile', 'account']
  const stepIndex = STEPS.indexOf(step)

  if (verifyEmail) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6 p-8 bg-white rounded-2xl border border-gray-100">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Verify your email</h2>
            <p className="text-sm text-gray-500 mt-2">
              We sent a confirmation link to <strong>{verifyEmail}</strong>.<br />
              Click the link to activate your account and sign in automatically.
            </p>
          </div>
          <Link href="/login" className="inline-block text-sm text-[#6B1F3A] font-medium hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    )
  }

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
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                  i < stepIndex ? 'bg-[#6B1F3A] text-white' :
                  i === stepIndex ? 'bg-[#6B1F3A] text-white' :
                  'bg-gray-100 text-gray-400'
                }`}>
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                {i < 2 && <div className={`h-0.5 flex-1 mx-2 ${i < stepIndex ? 'bg-[#6B1F3A]' : 'bg-gray-200'}`} />}
              </div>
            ))}
          </div>

          {error && <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          {/* Step 1: School */}
          {step === 'school' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-1">Choose your school</h2>
              <p className="text-xs text-gray-400 mb-4">Select the school where you'll be taking classes.</p>

              {schools.length === 0 ? (
                <p className="text-sm text-gray-400">No schools available yet. Please contact support.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {schools.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSchoolId(s.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition ${
                        schoolId === s.id ? 'border-[#6B1F3A] bg-[#6B1F3A]/5' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${schoolId === s.id ? 'border-[#6B1F3A]' : 'border-gray-300'}`}>
                        {schoolId === s.id && <div className="w-2 h-2 rounded-full bg-[#6B1F3A]" />}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${schoolId === s.id ? 'text-[#6B1F3A]' : 'text-gray-900'}`}>{s.name}</p>
                        <p className="text-xs text-gray-400">{s.city}, {s.country}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <button onClick={handleSchoolNext} className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition mt-2">
                Continue →
              </button>
            </div>
          )}

          {/* Step 2: Profile */}
          {step === 'profile' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Your profile</h2>
              <div>
                <label className={labelCls}>Full Name *</label>
                <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} className={inputCls} placeholder="First and last name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Phone</label>
                  <input type="tel" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} className={inputCls} placeholder="+39..." />
                </div>
                <div>
                  <label className={labelCls}>Date of Birth</label>
                  <input type="date" value={profile.date_of_birth} onChange={e => setProfile(p => ({ ...p, date_of_birth: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>City</label>
                  <input value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} className={inputCls} placeholder="e.g. Milano" />
                </div>
                <div>
                  <label className={labelCls}>Country</label>
                  <select value={profile.country} onChange={e => setProfile(p => ({ ...p, country: e.target.value }))} className={inputCls}>
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
                <button onClick={() => { setStep('school'); setError(null) }} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  ← Back
                </button>
                <button onClick={handleProfileNext} className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition">
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Account */}
          {step === 'account' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Account details</h2>
              <div>
                <label className={labelCls}>Email *</label>
                <input type="email" value={account.email} onChange={e => setAccount(a => ({ ...a, email: e.target.value }))} className={inputCls} placeholder="you@example.com" />
              </div>
              <div>
                <label className={labelCls}>Password *</label>
                <input type="password" value={account.password} onChange={e => setAccount(a => ({ ...a, password: e.target.value }))} className={inputCls} placeholder="Create a password" />
              </div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => { setStep('profile'); setError(null) }} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
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
