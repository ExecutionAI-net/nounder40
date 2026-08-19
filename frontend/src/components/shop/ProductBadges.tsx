import { readableOn } from '@/lib/brand'
import { productBadges, type ShopProduct } from '@/lib/shop'

// Etichette in evidenza (NEW, In offerta, …) definite da HQ per ogni prodotto.
export default function ProductBadges({
  product,
  className = '',
}: {
  product: Pick<ShopProduct, 'badges'>
  className?: string
}) {
  const badges = productBadges(product)
  if (badges.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {badges.map((b, i) => (
        <span
          key={`${b.label}-${i}`}
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: b.color, color: readableOn(b.color) }}
        >
          {b.label}
        </span>
      ))}
    </div>
  )
}
