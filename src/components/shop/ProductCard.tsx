'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import ProductGallery from '@/components/shop/ProductGallery'
import ProductBadges from '@/components/shop/ProductBadges'
import VariantPicker from '@/components/shop/VariantPicker'
import { useCart } from '@/lib/shop-cart'
import { availability, discountPct, SHOP_CATEGORIES, type ShopProduct } from '@/lib/shop'
import { richTextToPlain } from '@/lib/sanitize'

// Card del negozio: foto verticale, taglie/colori, aggiungi al carrello e
// accesso alla scheda completa ("Informazioni aggiuntive").
// Lato HQ la stessa card è usata in sola lettura (`readOnly`): niente carrello,
// scheda aperta in anteprima (`onDetail`) e azioni gestionali nel `footer`.
export default function ProductCard({
  product,
  detailHref,
  onDetail,
  readOnly = false,
  footer,
}: {
  product: ShopProduct
  detailHref?: string
  onDetail?: () => void
  readOnly?: boolean
  footer?: React.ReactNode
}) {
  const t = useTranslations('student.shop')
  const { cart, add, updateQty } = useCart()
  const [size, setSize] = useState('')
  const [color, setColor] = useState('')
  const [sizeError, setSizeError] = useState(false)
  const [colorError, setColorError] = useState(false)

  const pct = discountPct(product)
  const hasSizes = (product.sizes?.length ?? 0) > 0
  const hasColors = (product.colors?.length ?? 0) > 0
  const { soldOut } = availability(product, size, color)
  const shipping = Number(product.shipping_cost ?? 0)
  const categoryLabel = SHOP_CATEGORIES.includes(product.category as typeof SHOP_CATEGORIES[number])
    ? t(`category.${product.category}` as Parameters<typeof t>[0])
    : product.category

  const inCart = cart.find(i =>
    i.id === product.id &&
    i.size === (hasSizes ? (size || null) : null) &&
    i.color === (hasColors ? (color || null) : null)
  )

  function handleAdd() {
    let missing = false
    if (hasSizes && !size) { setSizeError(true); missing = true }
    if (hasColors && !color) { setColorError(true); missing = true }
    if (missing) return
    add(product, hasSizes ? size : null, hasColors ? color : null)
  }

  // Apertura scheda: link navigabile lato studente, callback in anteprima HQ
  const DetailTrigger = ({ children, className }: { children: React.ReactNode; className?: string }) =>
    detailHref
      ? <Link href={detailHref} className={className}>{children}</Link>
      : <button type="button" onClick={onDetail} className={className}>{children}</button>

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-3">
      <div className="relative">
        <DetailTrigger className="block w-full">
          <ProductGallery product={product} />
        </DetailTrigger>
        {/* Sconto ed etichette HQ, impilati sull'angolo della foto */}
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1 pointer-events-none">
          {pct !== null && (
            <span className="text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">-{pct}%</span>
          )}
          <ProductBadges product={product} />
        </div>
      </div>

      <div className="flex-1">
        <p className="text-[10px] uppercase tracking-[0.15em] text-gray-400">{categoryLabel}</p>
        <DetailTrigger className="block text-left font-display text-base text-gray-900 leading-snug mt-1 hover:underline underline-offset-4">
          {product.name}
        </DetailTrigger>

        {/* Nella card la descrizione va in testo semplice: la formattazione
            completa si legge nella scheda "Informazioni aggiuntive" */}
        {product.description && (
          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{richTextToPlain(product.description)}</p>
        )}

        <div className="flex items-baseline gap-2 mt-2">
          <p className="text-base font-semibold text-brand">€{Number(product.price).toFixed(2)}</p>
          {pct !== null && (
            <p className="text-xs text-gray-400 line-through">€{Number(product.original_price).toFixed(2)}</p>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {shipping > 0 ? t('shippingCost', { cost: shipping.toFixed(2) }) : t('freeShipping')}
        </p>

        <VariantPicker
          product={product}
          size={size}
          color={color}
          sizeError={sizeError}
          colorError={colorError}
          onChange={({ size: s, color: c }) => {
            setSize(s); setColor(c)
            if (s) setSizeError(false)
            if (c) setColorError(false)
          }}
        />
      </div>

      <div className="space-y-2">
        {readOnly ? null : inCart ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateQty(product.id, inCart.size, inCart.color, inCart.qty - 1)}
              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
            >
              −
            </button>
            <span className="flex-1 text-center text-sm font-medium text-gray-900">{inCart.qty}</span>
            <button
              onClick={() => updateQty(product.id, inCart.size, inCart.color, inCart.qty + 1)}
              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
            >
              +
            </button>
          </div>
        ) : (
          <button onClick={handleAdd} disabled={soldOut} className="btn-pill btn-pill-solid w-full">
            <span>{soldOut ? t('soldOut') : t('addToCart')}</span>
          </button>
        )}

        <DetailTrigger className="btn-pill w-full">
          <span>{t('additionalInfo')}</span>
          <span>→</span>
        </DetailTrigger>

        {footer}
      </div>
    </div>
  )
}
