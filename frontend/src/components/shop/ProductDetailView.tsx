'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import ProductGallery from '@/components/shop/ProductGallery'
import ProductDescription from '@/components/shop/ProductDescription'
import ProductBadges from '@/components/shop/ProductBadges'
import VariantPicker from '@/components/shop/VariantPicker'
import { useCart } from '@/lib/shop-cart'
import { availability, discountPct, SHOP_CATEGORIES, type ShopProduct } from '@/lib/shop'

// Scheda prodotto a schermo pieno: foto verticali, prezzo, descrizione,
// informazioni aggiuntive e aggiunta al carrello.
// `readOnly` = anteprima HQ (mostra tutto ma non tocca il carrello).
export default function ProductDetailView({
  product,
  readOnly = false,
  onGoToCart,
}: {
  product: ShopProduct
  readOnly?: boolean
  onGoToCart?: () => void
}) {
  const t = useTranslations('student.shop')
  const { add } = useCart()
  const [size, setSize] = useState('')
  const [color, setColor] = useState('')
  const [qty, setQty] = useState(1)
  const [sizeError, setSizeError] = useState(false)
  const [colorError, setColorError] = useState(false)
  const [added, setAdded] = useState(false)

  const pct = discountPct(product)
  const hasSizes = (product.sizes?.length ?? 0) > 0
  const hasColors = (product.colors?.length ?? 0) > 0
  const { soldOut } = availability(product, size, color)
  const shipping = Number(product.shipping_cost ?? 0)
  const categoryLabel = SHOP_CATEGORIES.includes(product.category as typeof SHOP_CATEGORIES[number])
    ? t(`category.${product.category}` as Parameters<typeof t>[0])
    : product.category

  function handleAdd() {
    let missing = false
    if (hasSizes && !size) { setSizeError(true); missing = true }
    if (hasColors && !color) { setColorError(true); missing = true }
    if (missing) return
    add(product, hasSizes ? size : null, hasColors ? color : null, qty)
    setAdded(true)
  }

  const infoRows = [
    { label: t('categoryLabel'), value: categoryLabel },
    ...(hasSizes ? [{ label: t('sizesLabel'), value: product.sizes!.join(' · ') }] : []),
    ...(hasColors ? [{ label: t('colorsLabel'), value: product.colors!.join(' · ') }] : []),
    { label: t('shippingLabel'), value: shipping > 0 ? `€${shipping.toFixed(2)}` : t('freeShipping') },
    { label: t('availabilityLabel'), value: soldOut ? t('soldOut') : t('inStock') },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
      <div className="md:sticky md:top-24 md:self-start md:pr-2">
        <ProductGallery product={product} variant="detail" />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.15em] text-gray-400">{categoryLabel}</p>
          <ProductBadges product={product} />
        </div>
        <h1 className="text-3xl md:text-4xl text-gray-900 mt-2">{product.name}</h1>

        <div className="flex items-baseline gap-3 mt-4">
          <p className="text-2xl font-semibold text-brand">€{Number(product.price).toFixed(2)}</p>
          {pct !== null && (
            <>
              <p className="text-base text-gray-400 line-through">€{Number(product.original_price).toFixed(2)}</p>
              <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">-{pct}%</span>
            </>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {shipping > 0 ? t('shippingCost', { cost: shipping.toFixed(2) }) : t('freeShipping')}
        </p>

        {product.description && (
          <div className="mt-6">
            <h2 className="text-lg text-gray-900 mb-2">{t('descriptionTitle')}</h2>
            <ProductDescription text={product.description} clampClass="max-h-40" />
          </div>
        )}

        <div className="mt-6">
          <VariantPicker
            product={product}
            size={size}
            color={color}
            showLabels
            sizeError={sizeError}
            colorError={colorError}
            onChange={({ size: s, color: c }) => {
              setSize(s); setColor(c)
              if (s) setSizeError(false)
              if (c) setColorError(false)
              setAdded(false)
            }}
          />
        </div>

        {!readOnly && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-wider text-gray-400">{t('quantity')}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-medium text-gray-900">{qty}</span>
                <button
                  onClick={() => setQty(q => q + 1)}
                  className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
                >
                  +
                </button>
              </div>
            </div>

            <button onClick={handleAdd} disabled={soldOut} className="btn-pill btn-pill-solid w-full">
              <span>{soldOut ? t('soldOut') : t('addToCart')}</span>
            </button>

            {added && (
              <div className="flex items-center justify-between gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                <p className="text-sm text-green-700">{t('addedToCart')}</p>
                {onGoToCart && (
                  <button onClick={onGoToCart} className="text-sm font-medium text-green-800 underline underline-offset-2 whitespace-nowrap">
                    {t('goToCart')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Informazioni aggiuntive */}
        <div className="mt-8 pt-6 border-t border-gray-100">
          <h2 className="text-lg text-gray-900 mb-3">{t('additionalInfo')}</h2>
          <dl className="divide-y divide-gray-100">
            {infoRows.map(row => (
              <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-xs uppercase tracking-wider text-gray-400">{row.label}</dt>
                <dd className="text-sm text-gray-700 text-right">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
