// HQ Role Permissions Matrix
// Hardcoded permissions by role (not DB-stored for simplicity and performance)

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
export const NAV_ITEMS = [
  { href: '/hq/dashboard', label: 'Dashboard', permission: 'dashboard' },
  { href: '/hq/schools', label: 'Schools', permission: 'schools_view' },
  { href: '/hq/team', label: 'Team', permission: 'team' },
  { href: '/hq/permissions', label: 'Permissions', permission: 'permissions' },
  { href: '/hq/packages', label: 'Packages', permission: 'packages' },
  { href: '/hq/lesson-types', label: 'Lesson Types', permission: 'lesson_types' },
  { href: '/hq/payments', label: 'Payments', permission: 'payments' },
  { href: '/hq/inbox', label: 'Inbox', permission: 'inbox' },
  { href: '/hq/library', label: 'Library', permission: 'library' },
  { href: '/hq/shop', label: 'Shop', permission: 'shop' },
  { href: '/hq/reports', label: 'Reports', permission: 'reports' },
  { href: '/hq/homepage-settings', label: 'Homepage Stats', permission: 'homepage_settings' },
  { href: '/hq/locations', label: 'Locations', permission: 'locations' },
  { href: '/hq/translations', label: 'Translations', permission: 'translations' },
]

// Helper function to check if a role has a permission
export function hasPermission(role: HQSubRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return HQ_PERMISSIONS[role]?.includes(permission) ?? false
}

// Helper to get filtered nav items for a role
export function getNavItemsForRole(role: HQSubRole | null | undefined) {
  if (!role) return []
  return NAV_ITEMS.filter((item) => hasPermission(role, item.permission as Permission))
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

// Helper to check multiple permissions (OR logic)
export function hasAnyPermission(role: HQSubRole | null | undefined, permissions: Permission[]): boolean {
  if (!role) return false
  return permissions.some((p) => hasPermission(role, p))
}

// Helper to check multiple permissions (AND logic)
export function hasAllPermissions(role: HQSubRole | null | undefined, permissions: Permission[]): boolean {
  if (!role) return false
  return permissions.every((p) => hasPermission(role, p))
}
