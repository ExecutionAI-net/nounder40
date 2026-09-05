// Stessa logica dello slugify Django lato backend: minuscole, accenti rimossi,
// tutto ciò che non è alfanumerico diventa trattino. Usato dai form HQ scuola
// (creazione e modifica) per suggerire e normalizzare lo slug del link prenotazioni.
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Normalizzazione leggera mentre si digita: minuscole, niente accenti,
// spazi → trattini (il trattino finale resta, quella completa avviene al submit).
export function slugifyWhileTyping(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
}
