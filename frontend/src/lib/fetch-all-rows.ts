// Supabase/PostgREST tronca le query a max 1000 righe per richiesta.
// Con corsi lunghi (centinaia di lezioni future) il troncamento faceva
// perdere le date di fine (es. 31/07/2027 → dicembre 2026).
// Questo helper pagina con .range() finché non arriva una pagina corta.
// ATTENZIONE: se la query fallisce viene lanciato un errore — mai restituire
// silenziosamente una lista vuota (un [] "finto" ha quasi causato salvataggi
// distruttivi sulla pagina di modifica corso).
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>
): Promise<T[]> {
  const size = 1000
  const all: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(`fetchAllRows: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < size) return all
  }
}
