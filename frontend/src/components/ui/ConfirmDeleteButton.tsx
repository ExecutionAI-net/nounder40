'use client'

import { useEffect, useRef, useState } from 'react'

// Two-click delete pattern (platform-wide rule — no native confirm dialogs):
// 1st click arms the button (shows armedLabel, e.g. "Sure? 3 students linked — click again")
// 2nd click within `disarmAfterMs` actually deletes; otherwise it disarms.
// `onArm` (optional, async) runs on first click — use it to fetch linked-record
// counts and return the armed label; return null to abort arming (e.g. blocked).
export default function ConfirmDeleteButton({
  label,
  armedLabel,
  onArm,
  onDelete,
  disarmAfterMs = 5000,
  className = '',
  armedClassName = '',
}: {
  label: string
  armedLabel: string
  onArm?: () => Promise<string | null>
  onDelete: () => Promise<void>
  disarmAfterMs?: number
  className?: string
  armedClassName?: string
}) {
  const [armed, setArmed] = useState(false)
  const [dynamicLabel, setDynamicLabel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function handleClick() {
    if (busy) return
    if (!armed) {
      setBusy(true)
      let nextLabel: string | null = armedLabel
      if (onArm) nextLabel = await onArm()
      setBusy(false)
      if (nextLabel === null) return // arming aborted (e.g. deletion blocked)
      setDynamicLabel(nextLabel)
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), disarmAfterMs)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setBusy(true)
    try {
      await onDelete()
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  const base = 'text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50'
  const idle = className || 'border border-red-200 text-red-500 hover:bg-red-50'
  const armedCls = armedClassName || 'bg-red-600 text-white hover:bg-red-700 animate-pulse'

  return (
    <button onClick={handleClick} disabled={busy} className={`${base} ${armed ? armedCls : idle}`}>
      {busy ? '…' : armed ? (dynamicLabel ?? armedLabel) : label}
    </button>
  )
}
