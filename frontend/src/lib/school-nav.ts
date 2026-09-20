// The school panel's sidebar sections, in their default order. One list for
// the layout (which draws them, filtered by the role matrix) and for
// Settings → Menu order (which lets the school reorder them with arrows).
// The keys double as `nav.school` message keys and as the role-matrix
// section keys; the order chosen by the school is `School.nav_order`.
export const SCHOOL_NAV: { key: string; href: string }[] = [
  { key: 'dashboard', href: '/school/dashboard' },
  { key: 'locations', href: '/school/locations' },
  { key: 'calendar', href: '/school/calendar' },
  { key: 'courses', href: '/school/courses' },
  { key: 'lessons', href: '/school/lessons' },
  // Special events (SPECIAL_EVENTS.md): workshops the school titles itself
  { key: 'events', href: '/school/events' },
  { key: 'teachers', href: '/school/teachers' },
  { key: 'compensation', href: '/school/compensation' },
  { key: 'students', href: '/school/students' },
  // One engine: subscriptions are recurring packages, managed from
  // "Packages" (PACKAGE_TO_SUBSCRIPTION.md — the dedicated section is retired).
  { key: 'packages', href: '/school/packages' },
  { key: 'payments', href: '/school/payments' },
  { key: 'documents', href: '/school/documents' },
  { key: 'inbox', href: '/school/inbox' },
  { key: 'reports', href: '/school/reports' },
  { key: 'settings', href: '/school/settings' },
  { key: 'attendanceStatuses', href: '/school/settings/statuses' },
  { key: 'manualCredits', href: '/school/credits' },
]

// Items in the school's order first (unknown keys ignored), then whatever the
// order does not mention, in the default order — so a section added after
// the school saved its order still shows up, at the end.
export function orderNav<T extends { key: string }>(items: T[], order: string[] | null | undefined): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((k, i) => [k, i]))
  // One stable sort: unlisted keys rank last and keep their default order
  const at = (key: string) => rank.get(key) ?? order.length
  return [...items].sort((a, b) => at(a.key) - at(b.key))
}

// Fired by Settings after saving a new order, so the open layout redraws
// without a reload.
export const NAV_ORDER_EVENT = 'nu40:nav-order-changed'
