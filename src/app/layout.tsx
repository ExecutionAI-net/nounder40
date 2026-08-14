// Root layout — minimal pass-through.
// html/body/lang are handled by src/app/[locale]/layout.tsx
// This file is required by Next.js but [locale]/layout.tsx is the effective root.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
