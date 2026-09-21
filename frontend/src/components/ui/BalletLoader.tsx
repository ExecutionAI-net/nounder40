// Loading indicator: a ballerina turning a pirouette, centred. Use it where a
// list is being fetched instead of a spinner or a bare "Loading" line.
export default function BalletLoader({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-2 py-16 ${className}`}>
      <svg
        className="ballet-pirouette text-[#6B1F3A]"
        width="56" height="72" viewBox="0 0 56 72" fill="currentColor" aria-hidden="true"
      >
        {/* head + bun */}
        <circle cx="28" cy="8" r="5" />
        <circle cx="28" cy="2.5" r="2.5" />
        {/* arms in fifth position */}
        <path d="M27 14 C17 12 14 4 18 1 C19 7 23 10 28 12 C33 10 37 7 38 1 C42 4 39 12 29 14 Z" />
        {/* torso */}
        <path d="M24 14 h8 l-1.5 16 h-5 Z" />
        {/* tutu */}
        <path d="M28 28 C14 28 6 34 4 38 C12 38 20 36 28 36 C36 36 44 38 52 38 C50 34 42 28 28 28 Z" />
        {/* supporting leg, en pointe */}
        <path d="M27 36 h3 l-0.5 26 h-2 Z" />
        <path d="M27.6 62 h1.8 l-0.9 8 Z" />
        {/* working leg, passé */}
        <path d="M30 36 l9 10 l-9 5 l-1 -2.5 l6 -3 l-6 -7 Z" />
      </svg>
      {label ? <p className="text-sm text-gray-400">{label}</p> : null}
    </div>
  )
}
