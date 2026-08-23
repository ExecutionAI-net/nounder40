// Impostazioni di aspetto configurabili da HQ (Aspetto e barra).
// Vivono in platform_settings (key/value, lettura pubblica, scrittura HQ):
// nessuna migrazione necessaria, le chiavi mancanti ricadono sui default.
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

export type BrandLink = { label: string; url: string }

export type SidebarRole = 'hq' | 'school' | 'teacher' | 'student'
export type SidebarColors = { bg: string; text: string }

export type BrandSettings = {
  logoUrl: string
  /** Sfondo del pannello studente */
  colorBg: string
  /** Colore di accento: bottoni, link attivi, prezzi */
  colorPrimary: string
  /** Voci della barra in alto (link esterni al sito vetrina) */
  navLinks: BrandLink[]
  /** Colori barra laterale/header per ruolo (sfondo + testo) */
  sidebars: Record<SidebarRole, SidebarColors>
}

export const BRAND_KEYS = {
  logoUrl: 'brand_logo_url',
  colorBg: 'brand_color_bg',
  colorPrimary: 'brand_color_primary',
  navLinks: 'brand_nav_links',
} as const

export const SIDEBAR_ROLES: SidebarRole[] = ['hq', 'school', 'teacher', 'student']
export const sidebarKey = (role: SidebarRole, part: 'bg' | 'text') => `sidebar_${role}_${part}`

export const BRAND_DEFAULTS: BrandSettings = {
  logoUrl: '/Logo.png',
  colorBg: '#FFFFFF',
  colorPrimary: '#3D3D3D',
  navLinks: [
    { label: 'Home', url: 'https://alinaquintana.com' },
    { label: 'Blog', url: 'https://alinaquintana.com/blog/' },
  ],
  sidebars: {
    hq: { bg: '#6B1F3A', text: '#E8A0B4' },
    school: { bg: '#111827', text: '#9CA3AF' },
    // Insegnante: blu petrolio, distinto dal quasi-nero della scuola
    teacher: { bg: '#1E3A5F', text: '#A9C1DB' },
    student: { bg: '#FFFFFF', text: '#4B5563' },
  },
}

const HEX = /^#[0-9a-fA-F]{6}$/

function safeColor(value: string | undefined, fallback: string) {
  return value && HEX.test(value.trim()) ? value.trim().toUpperCase() : fallback
}

export function parseBrandSettings(raw: Record<string, string | null | undefined>): BrandSettings {
  let navLinks = BRAND_DEFAULTS.navLinks
  const rawLinks = raw[BRAND_KEYS.navLinks]
  if (rawLinks) {
    try {
      const parsed = JSON.parse(rawLinks)
      if (Array.isArray(parsed)) {
        navLinks = parsed
          .filter((l): l is BrandLink => !!l && typeof l.label === 'string' && typeof l.url === 'string')
          .map(l => ({ label: l.label.trim(), url: l.url.trim() }))
          .filter(l => l.label && l.url)
      }
    } catch {
      // valore corrotto: si torna ai default invece di rompere il layout
    }
  }

  const sidebars = Object.fromEntries(
    SIDEBAR_ROLES.map(role => [role, {
      bg: safeColor(raw[sidebarKey(role, 'bg')] ?? undefined, BRAND_DEFAULTS.sidebars[role].bg),
      text: safeColor(raw[sidebarKey(role, 'text')] ?? undefined, BRAND_DEFAULTS.sidebars[role].text),
    }])
  ) as BrandSettings['sidebars']

  return {
    logoUrl: raw[BRAND_KEYS.logoUrl]?.trim() || BRAND_DEFAULTS.logoUrl,
    colorBg: safeColor(raw[BRAND_KEYS.colorBg] ?? undefined, BRAND_DEFAULTS.colorBg),
    colorPrimary: safeColor(raw[BRAND_KEYS.colorPrimary] ?? undefined, BRAND_DEFAULTS.colorPrimary),
    navLinks,
    sidebars,
  }
}

/** Variabili CSS della barra laterale: usate dai layout con bg-[var(--sb-bg)] ecc. */
export function sidebarCssVars(sb: SidebarColors): React.CSSProperties {
  return {
    ['--sb-bg' as string]: sb.bg,
    ['--sb-text' as string]: sb.text,
  }
}

/** Hook: colori barra per ruolo, letti dalle impostazioni pubbliche. */
export function useSidebarColors(role: SidebarRole): SidebarColors {
  const [colors, setColors] = useState<SidebarColors>(BRAND_DEFAULTS.sidebars[role])
  useEffect(() => {
    apiFetch<Record<string, string>>('/platform-stats/')
      .then(raw => setColors(parseBrandSettings(raw).sidebars[role]))
      .catch(() => {})
  }, [role])
  return colors
}

/** Schiarisce (amount > 0) o scurisce (amount < 0) un colore esadecimale. */
function shade(hex: string, amount: number): string {
  if (!HEX.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)
    return Math.max(0, Math.min(255, Math.round(next)))
  })
  return `#${ch.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

/** Testo leggibile sopra un fondo pieno del colore dato. */
export function readableOn(hex: string): string {
  if (!HEX.test(hex)) return '#FFFFFF'
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#1F1F1F' : '#FFFFFF'
}

/**
 * Variabili CSS del tema: applicate sul contenitore del pannello studente
 * (e sull'anteprima HQ). Ogni classe Tailwind usa `var(--brand,#6B1F3A)`,
 * così fuori dal tema gli altri pannelli restano bordeaux.
 */
export function brandCssVars(brand: BrandSettings): React.CSSProperties {
  return {
    ['--brand' as string]: brand.colorPrimary,
    ['--brand-hover' as string]: shade(brand.colorPrimary, -0.18),
    ['--brand-fg' as string]: readableOn(brand.colorPrimary),
    ['--brand-bg' as string]: brand.colorBg,
  }
}
