/**
 * I crediti ammettono il mezzo passo (2,5) ma arrivano dall'API come decimali
 * con lo zero finale: "200.0", "20.0". Mostrarli cosi' e' solo rumore, e
 * troncarli a intero perderebbe il mezzo credito.
 */
export function formatCredits(value: number | string | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : String(value ?? '')
}

/** Una riga di GET /api/student/credits/ (una per scuola con pacchetti attivi). */
export type CreditRow = {
  school_id: string
  school_name: string
  credits: number | string
  /** null = saldo non esprimibile in lezioni (pacchetti illimitati o a costi diversi) */
  lessons: number | null
  credits_without_lessons: number | string
}

/**
 * `lessons` e' null SOLO quando c'e' davvero un saldo che non si puo' dire in
 * lezioni: allora chi chiama ricade sui crediti. Nessun pacchetto attivo
 * (lista vuota) o saldo a zero sono "0 lezioni": all'allieva non si mostra
 * mai "0 crediti" (Carlo, 20/09/2026 — si ragiona in lezioni, non in crediti).
 */
export function summarizeBalance(rows: CreditRow[]): { credits: number; lessons: number | null } {
  const credits = rows.reduce((sum, r) => sum + Number(r.credits || 0), 0)
  const convertible = rows.filter(r => r.lessons != null)
  if (convertible.length > 0) {
    return { credits, lessons: convertible.reduce((sum, r) => sum + (r.lessons ?? 0), 0) }
  }
  return { credits, lessons: credits === 0 ? 0 : null }
}
