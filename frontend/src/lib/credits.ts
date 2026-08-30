/**
 * I crediti ammettono il mezzo passo (2,5) ma arrivano dall'API come decimali
 * con lo zero finale: "200.0", "20.0". Mostrarli cosi' e' solo rumore, e
 * troncarli a intero perderebbe il mezzo credito.
 */
export function formatCredits(value: number | string | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : String(value ?? '')
}
