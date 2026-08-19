import type { BrandSettings } from '@/lib/brand'

// Barra del sito vetrina, stessa struttura di alinaquintana.com:
// banda bianca col logo centrato, sotto una barra piena (colore di accento)
// con le voci in maiuscolo bianche. Le voci si configurano in HQ > Aspetto e barra.
export default function BrandTopBar({ brand, compact = false }: { brand: BrandSettings; compact?: boolean }) {
  const home = brand.navLinks[0]?.url ?? '/'
  const isExternal = (url: string) => /^https?:\/\//i.test(url)

  return (
    <header className="w-full">
      {/* Banda logo */}
      <div className={`bg-white flex justify-center ${compact ? 'py-3' : 'py-5 md:py-6'}`}>
        <a
          href={home}
          target={isExternal(home) ? '_blank' : undefined}
          rel={isExternal(home) ? 'noopener noreferrer' : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand.logoUrl}
            alt="No Under 40"
            className={`w-auto object-contain ${compact ? 'h-10' : 'h-14 md:h-[72px]'}`}
          />
        </a>
      </div>

      {/* Barra voci */}
      {brand.navLinks.length > 0 && (
        <nav
          className={`bg-brand flex flex-wrap items-center justify-center gap-x-8 md:gap-x-12 gap-y-1 px-4 ${
            compact ? 'py-2.5' : 'py-3.5 md:py-4'
          }`}
        >
          {brand.navLinks.map((link, i) => (
            <a
              key={`${link.url}-${i}`}
              href={link.url}
              target={isExternal(link.url) ? '_blank' : undefined}
              rel={isExternal(link.url) ? 'noopener noreferrer' : undefined}
              className={`font-semibold uppercase tracking-[0.08em] text-white/90 hover:text-white transition whitespace-nowrap ${
                compact ? 'text-[11px]' : 'text-xs md:text-sm'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  )
}
