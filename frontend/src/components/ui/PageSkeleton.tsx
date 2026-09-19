// Neutral first-paint placeholder for pages that are client-rendered: shown by
// Suspense fallbacks / loading.tsx so a slow first visit never stays white.
export default function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-busy="true">
      <div className="h-9 w-2/3 rounded-lg bg-gray-200" />
      <div className="h-5 w-1/2 rounded-lg bg-gray-200" />
      <div className="h-12 w-1/3 rounded-lg bg-gray-200" />
      <div className="h-64 rounded-2xl bg-gray-200" />
      <div className="h-20 rounded-2xl bg-gray-200" />
      <div className="h-20 rounded-2xl bg-gray-200" />
    </div>
  )
}
