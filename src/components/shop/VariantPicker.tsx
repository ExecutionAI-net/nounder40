'use client'

import { useTranslations } from 'next-intl'
import { availability, type ShopProduct } from '@/lib/shop'

// Selettore taglia/colore condiviso fra card e scheda prodotto.
// Le opzioni senza stock restano visibili ma barrate e non cliccabili.
export default function VariantPicker({
  product,
  size,
  color,
  onChange,
  sizeError,
  colorError,
  showLabels = false,
}: {
  product: ShopProduct
  size: string
  color: string
  onChange: (next: { size: string; color: string }) => void
  sizeError?: boolean
  colorError?: boolean
  showLabels?: boolean
}) {
  const t = useTranslations('student.shop')
  const sizes = product.sizes ?? []
  const colors = product.colors ?? []
  const { tracked, sizeHasStock, colorHasStock } = availability(product, size, color)
  const variants = product.shop_product_variants ?? []

  const optionCls = (selected: boolean, available: boolean) =>
    `min-w-8 px-2.5 py-1 rounded-md text-xs font-medium border transition ${
      selected
        ? 'bg-brand text-brand-fg border-brand'
        : available
          ? 'bg-white text-gray-600 border-gray-200 hover:border-brand/40'
          : 'bg-gray-50 text-gray-300 border-gray-100 line-through cursor-not-allowed'
    }`

  return (
    <>
      {sizes.length > 0 && (
        <div className="mt-2">
          {showLabels && <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1.5">{t('sizeLabel')}</p>}
          <div className="flex flex-wrap gap-1.5">
            {sizes.map((s) => {
              const available = sizeHasStock(s)
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    // Il colore scelto potrebbe non esistere per questa taglia
                    const keepColor = !color || !tracked || variants.some(v => v.size === s && v.color === color && v.stock > 0)
                    onChange({ size: s, color: keepColor ? color : '' })
                  }}
                  className={optionCls(size === s, available)}
                >
                  {s}
                </button>
              )
            })}
          </div>
          {sizeError && <p className="text-[11px] text-red-500 mt-1">{t('chooseSize')}</p>}
        </div>
      )}

      {colors.length > 0 && (
        <div className="mt-2">
          {showLabels && <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1.5">{t('colorLabel')}</p>}
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => {
              const available = colorHasStock(c)
              return (
                <button
                  key={c}
                  type="button"
                  disabled={!available}
                  onClick={() => onChange({ size, color: c })}
                  className={optionCls(color === c, available)}
                >
                  {c}
                </button>
              )
            })}
          </div>
          {colorError && <p className="text-[11px] text-red-500 mt-1">{t('chooseColor')}</p>}
        </div>
      )}
    </>
  )
}
