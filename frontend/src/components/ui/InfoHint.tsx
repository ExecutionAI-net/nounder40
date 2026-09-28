'use client'

// A small "i" that explains a column, a filter or a figure on hover, on
// keyboard focus or on tap. The bubble opens BELOW the icon and wraps, so it
// stays readable inside a table header that clips what sticks out above,
// and it does not inherit the header's uppercase. A click on it never
// reaches a sortable header behind it.
export default function InfoHint({ text, align = 'center' }: { text: string; align?: 'center' | 'right' }) {
  const pos = align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
  return (
    <span className="group/hint relative ml-1 inline-block align-middle">
      <button
        type="button"
        aria-label={text}
        onClick={e => e.stopPropagation()}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold normal-case leading-none tracking-normal text-gray-400 hover:border-gray-500 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-50 mt-1.5 hidden w-64 whitespace-normal rounded-md bg-gray-800 px-2.5 py-1.5 text-left text-xs font-normal normal-case tracking-normal text-white shadow-lg group-hover/hint:block group-focus-within/hint:block ${pos}`}
      >
        {text}
      </span>
    </span>
  )
}
