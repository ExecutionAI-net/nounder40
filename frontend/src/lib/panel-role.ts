// Which panel is the user on? Derived from the URL: /<locale>/<panel>/...
// Sent to the chat API as the X-Panel-Role header (lib/api/client.ts) and to
// the WebSocket handshake as ?as= (lib/ws.ts), so a multi-role account acts
// as ONE role per panel instead of the union of everything it holds. The
// backend (chat/panel.py) only honours it when the user really has that role.
export type PanelRole = 'hq' | 'school' | 'teacher' | 'student'

const PANELS: ReadonlySet<string> = new Set(['hq', 'school', 'teacher', 'student'])

export function panelRoleFromPath(pathname: string): PanelRole | null {
  const [, , panel] = pathname.split('/') // "", locale, panel
  return PANELS.has(panel) ? (panel as PanelRole) : null
}

export function currentPanelRole(): PanelRole | null {
  if (typeof window === 'undefined') return null
  return panelRoleFromPath(window.location.pathname)
}
