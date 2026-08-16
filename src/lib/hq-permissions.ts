// HQ Role Permissions Matrix
// The live matrix is stored in the hq_roles table (editable from HQ > Permissions,
// custom profiles included). This static map is the seed and the FALLBACK when the
// DB is unreachable. Server-side lookups: src/lib/api/role-permissions.ts.

export type HQSubRole = 'owner' | 'super_admin' | 'operations' | 'finance' | 'tech_support' | 'analytics' | 'support'

export type Permission =
  | 'dashboard'
  | 'schools_view'
  | 'schools_create_edit'
  | 'schools_activate'
  | 'schools_platform_fee'
  | 'payments'
  | 'reports'
  | 'inbox'
  | 'library'
  | 'shop'
  | 'packages'
  | 'lesson_types'
  | 'team'
  | 'permissions'
  | 'homepage_settings'
  | 'locations'
  | 'translations'
  | 'email_templates'

export const HQ_PERMISSIONS: Record<HQSubRole, Permission[]> = {
  owner: [
    'dashboard',
    'schools_view',
    'schools_create_edit',
    'schools_activate',
    'schools_platform_fee',
    'payments',
    'reports',
    'inbox',
    'library',
    'shop',
    'packages',
    'lesson_types',
    'team',
    'permissions',
    'homepage_settings',
    'locations',
    'translations',
    'email_templates',
  ],
  super_admin: [
    'dashboard',
    'schools_view',
    'schools_create_edit',
    'schools_activate',
    'payments',
    'reports',
    'inbox',
    'library',
    'shop',
    'packages',
    'lesson_types',
    'team',
    'permissions',
    'homepage_settings',
    'locations',
    'translations',
    'email_templates',
  ],
  operations: [
    'dashboard',
    'schools_view',
    'schools_create_edit',
    'schools_activate',
    'inbox',
    'library',
    'shop',
    'packages',
    'lesson_types',
    'homepage_settings',
    'locations',
  ],
  finance: [
    'dashboard',
    'schools_view',
    'schools_platform_fee',
    'payments',
    'reports',
  ],
  tech_support: [
    'dashboard',
    'inbox',
  ],
  analytics: [
    'dashboard',
    'schools_view',
    'reports',
  ],
  support: [
    'dashboard',
    'inbox',
  ],
}

// Navigation items mapped to permissions
// `key` is used by HQLayout to look up the translation via useTranslations('nav.hq')
export const NAV_ITEMS = [
  { href: '/hq/dashboard', label: 'Dashboard', permission: 'dashboard', key: 'dashboard' },
  { href: '/hq/schools', label: 'Schools', permission: 'schools_view', key: 'schools' },
  { href: '/hq/team', label: 'Team', permission: 'team', key: 'team' },
  { href: '/hq/permissions', label: 'Permissions', permission: 'permissions', key: 'permissions' },
  { href: '/hq/packages', label: 'Packages', permission: 'packages', key: 'packages' },
  { href: '/hq/lesson-types', label: 'Lesson Types', permission: 'lesson_types', key: 'lessonTypes' },
  { href: '/hq/payments', label: 'Payments', permission: 'payments', key: 'payments' },
  { href: '/hq/inbox', label: 'Inbox', permission: 'inbox', key: 'inbox' },
  { href: '/hq/library', label: 'Library', permission: 'library', key: 'library' },
  { href: '/hq/shop', label: 'Shop', permission: 'shop', key: 'shop' },
  { href: '/hq/reports', label: 'Reports', permission: 'reports', key: 'reports' },
  { href: '/hq/homepage-settings', label: 'Homepage Stats', permission: 'homepage_settings', key: 'homepageSettings' },
  // Aspetto del pannello studente: logo, colori e voci della barra in alto
  { href: '/hq/brand-settings', label: 'Look & Top Bar', permission: 'homepage_settings', key: 'brandSettings' },
  { href: '/hq/locations', label: 'Locations', permission: 'locations', key: 'locations' },
  { href: '/hq/translations', label: 'Translations', permission: 'translations', key: 'translations' },
  { href: '/hq/emails', label: 'Email Templates', permission: 'email_templates', key: 'emailTemplates' },
]

// Every known permission key (used to validate matrix edits)
export const ALL_PERMISSIONS = [
  'dashboard', 'schools_view', 'schools_create_edit', 'schools_activate',
  'schools_platform_fee', 'payments', 'reports', 'inbox', 'library', 'shop',
  'packages', 'lesson_types', 'team', 'permissions', 'homepage_settings',
  'locations', 'translations', 'email_templates',
] as const satisfies readonly Permission[]

// Helper function to check if a role has a permission (static fallback matrix)
export function hasPermission(role: HQSubRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return HQ_PERMISSIONS[role]?.includes(permission) ?? false
}

// Helper to get filtered nav items for a role (static fallback matrix)
export function getNavItemsForRole(role: HQSubRole | null | undefined) {
  if (!role) return []
  return NAV_ITEMS.filter((item) => hasPermission(role, item.permission as Permission))
}

// Nav items for an explicit permission list (the DB-backed dynamic matrix)
export function getNavItemsForPermissions(permissions: string[]) {
  return NAV_ITEMS.filter((item) => permissions.includes(item.permission))
}

// Permissions metadata for display
export const PERMISSION_LABELS: Record<Permission, string> = {
  dashboard: 'Dashboard',
  schools_view: 'View Schools',
  schools_create_edit: 'Create/Edit Schools',
  schools_activate: 'Activate/Deactivate Schools',
  schools_platform_fee: 'Configure Platform Fees',
  payments: 'Payments',
  reports: 'Reports',
  inbox: 'Inbox',
  library: 'Metodo Library',
  shop: 'Shop',
  packages: 'Packages',
  lesson_types: 'Lesson Types',
  team: 'Team Management',
  permissions: 'Permissions',
  homepage_settings: 'Homepage Settings',
  locations: 'Locations',
  translations: 'Translations',
  email_templates: 'Email Templates',
}

// Role labels for display
export const ROLE_LABELS: Record<HQSubRole, string> = {
  owner: 'Owner',
  super_admin: 'Super Admin',
  operations: 'Operations',
  finance: 'Finance',
  tech_support: 'Tech Support',
  analytics: 'Analytics',
  support: 'Support',
}
