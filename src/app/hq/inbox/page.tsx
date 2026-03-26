import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-orange-100 text-orange-600',
  high: 'bg-red-100 text-red-600',
}

export default async function HQInboxPage() {
  const supabase = await createClient()

  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, status, priority, created_at, last_message_at, school_id, schools(name)')
    .eq('type', 'hq_school')
    .order('last_message_at', { ascending: false })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
        <p className="text-gray-500 text-sm mt-1">Conversations with schools</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!conversations?.length ? (
          <div className="p-8 text-center text-sm text-gray-400">No conversations yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">School</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Priority</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">Last Activity</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {conversations.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-3">
                    <p className="font-medium text-gray-900 text-sm">
                      {(c.schools as unknown as { name: string } | null)?.name ?? 'Unknown School'}
                    </p>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[c.priority] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.priority}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400">
                    {c.last_message_at
                      ? new Date(c.last_message_at).toLocaleString()
                      : new Date(c.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <Link
                      href={`/hq/inbox/${c.id}`}
                      className="text-xs text-[#6B1F3A] hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
