'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SchoolActions({ schoolId, active }: { schoolId: string; active: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function toggleActive() {
    setLoading(true)
    await fetch(`/api/hq/schools/${schoolId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    router.refresh()
    setLoading(false)
  }

  return (
    <button
      onClick={toggleActive}
      disabled={loading}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${
        active
          ? 'border border-red-200 text-red-600 hover:bg-red-50'
          : 'border border-green-200 text-green-700 hover:bg-green-50'
      }`}
    >
      {loading ? '...' : active ? 'Deactivate' : 'Activate'}
    </button>
  )
}
