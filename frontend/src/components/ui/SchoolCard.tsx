import type { ReactNode } from 'react'

/**
 * "La mia scuola" dentro un profilo: card tinta brand, nome in nero e città
 * in grigio, azione facoltativa a destra. Stesso componente per allieva e
 * insegnante, così i due profili si somigliano.
 *
 * Mobile: nome su riga intera (senza troncare) e azione sotto; su schermi
 * larghi restano affiancati.
 */
export default function SchoolCard({
  label,
  name,
  city,
  emptyText,
  action,
}: {
  label?: string
  name?: string | null
  city?: string | null
  emptyText?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        {label && <p className="text-xs font-semibold uppercase tracking-wide text-brand">{label}</p>}
        {name ? (
          <p className="text-base font-semibold text-gray-900 mt-0.5">
            {name}
            {city && <span className="font-normal text-gray-500"> — {city}</span>}
          </p>
        ) : (
          <p className="text-sm text-gray-500 mt-0.5">{emptyText}</p>
        )}
      </div>
      {action}
    </div>
  )
}
