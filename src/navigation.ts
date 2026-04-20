import { createNavigation } from 'next-intl/navigation'
import { routing } from './i18n/routing'

// Use these instead of next/navigation and next/link everywhere.
// They handle locale prefix automatically.
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing)
