import { revalidatePath } from 'next/cache'

/**
 * Invalidate every server-rendered page's cache. Called from mutation
 * API routes so the next navigation re-runs the server fetch instead of
 * serving the stale snapshot Next.js cached on the previous render.
 *
 * Over-invalidating is intentional: pages only re-render when actually
 * visited, so the cost is "first visit after a write is one extra DB
 * query" — much cheaper than tracking which mutation affects which page.
 */
export function revalidateAll() {
  revalidatePath('/', 'layout')
}
