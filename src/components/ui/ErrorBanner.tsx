// Shared dismissable error banner. Renders nothing when message is empty,
// so callers can pass their error state directly.
export default function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null
  onDismiss?: () => void
}) {
  if (!message) return null
  return (
    <div className="mb-4 flex items-start justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400 hover:text-red-600 shrink-0" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
