'use client'

import { useRouter } from 'next/navigation'

// Top-left back arrow (platform-wide pattern, as in Svolgo).
// Goes to `href` when provided, otherwise browser history back.
export default function BackButton({ href, label }: { href?: string; label?: string }) {
  const router = useRouter()
  return (
    <button
      onClick={() => (href ? router.push(href) : router.back())}
      className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition mb-2"
      aria-label={label ?? 'Back'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
      </svg>
      {label && <span>{label}</span>}
    </button>
  )
}
