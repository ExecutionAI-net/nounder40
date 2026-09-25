'use client'

import { useState } from 'react'

// One row of a shareable link: the URL in a read-only field that selects
// itself on focus, next to a Copy button that reads "copied" for two
// seconds. The labels come from the caller so each screen keeps its own
// i18n namespace.
export function ShareLinkField({
  url, label, copyLabel, copiedLabel,
}: {
  url: string
  label?: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div>
      {label && <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>}
      <div className="flex gap-2">
        <input readOnly value={url} onFocus={e => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs font-mono text-gray-700" />
        <button type="button" onClick={copy}
          className="shrink-0 px-3 py-2 rounded-lg bg-[#6B1F3A] text-white text-xs font-medium hover:bg-[#5a1930] transition">
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  )
}

export type ShareLink = { key: string; label?: string; url: string }

// The "links to share" box born on the school profile ("Link al calendario"):
// a title, an optional hint and one ShareLinkField per link, in the platform
// pink. The same box now sits on the event form and the events list, so a
// shareable link looks the same wherever the school meets one.
export default function ShareLinksBox({
  title, hint, links, copyLabel, copiedLabel,
}: {
  title: string
  hint?: string
  links: ShareLink[]
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <div className="rounded-xl border border-[#6B1F3A]/20 bg-[#6B1F3A]/5 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[#6B1F3A]">{title}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {links.map(l => (
        <ShareLinkField key={l.key} url={l.url} label={l.label} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      ))}
    </div>
  )
}
