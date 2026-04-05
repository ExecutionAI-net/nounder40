'use client'

import { HQ_PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS } from '@/lib/hq-permissions'
import type { HQSubRole, Permission } from '@/lib/hq-permissions'

const ROLES: HQSubRole[] = ['owner', 'super_admin', 'operations', 'finance', 'tech_support', 'analytics', 'support']

const ALL_PERMISSIONS: Permission[] = [
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
]

export default function PermissionsPage() {
  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Permissions Matrix</h1>
        <p className="text-gray-600 mt-2">View HQ role permissions (read-only)</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">Permission</th>
              {ROLES.map((role) => (
                <th key={role} className="text-center px-4 py-3 font-medium text-gray-700 whitespace-nowrap">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PERMISSIONS.map((perm) => (
              <tr key={perm} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10">
                  {PERMISSION_LABELS[perm]}
                </td>
                {ROLES.map((role) => {
                  const hasIt = HQ_PERMISSIONS[role].includes(perm)
                  return (
                    <td key={`${role}-${perm}`} className="text-center px-4 py-3">
                      {hasIt ? (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100">
                          <svg className="w-3 h-3 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100">
                          <span className="text-gray-400">—</span>
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 p-6 bg-blue-50 rounded-lg border border-blue-200">
        <h2 className="font-semibold text-blue-900 mb-2">Role Overview</h2>
        <ul className="space-y-2 text-sm text-blue-800">
          <li><strong>Owner:</strong> Full platform control</li>
          <li><strong>Super Admin:</strong> Everything except Team and Permissions management</li>
          <li><strong>Operations:</strong> School management, content, settings</li>
          <li><strong>Finance:</strong> Payments, reports, platform fees</li>
          <li><strong>Tech Support:</strong> Inbox (technical issues)</li>
          <li><strong>Analytics:</strong> Reports and analytics</li>
          <li><strong>Support:</strong> Inbox (customer support)</li>
        </ul>
      </div>
    </div>
  )
}
