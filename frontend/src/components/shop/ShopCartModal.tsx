'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cartKey, useCart } from '@/lib/shop-cart'
import { categoryEmoji } from '@/lib/shop'
import { apiFetch, ApiError } from '@/lib/api/client'

// Carrello del negozio: riepilogo, somme e avvio del checkout Stripe.
// Il contenuto arriva da useCart (localStorage), condiviso con la scheda prodotto.
export default function ShopCartModal({
  isAuthed,
  onClose,
  onLoginRequired,
}: {
  isAuthed: boolean | null
  onClose: () => void
  onLoginRequired: () => void
}) {
  const t = useTranslations('student.shop')
  const { cart, updateQty, subtotal, shipping, total } = useCart()
  const [ordering, setOrdering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleOrder() {
    if (!isAuthed) { onLoginRequired(); return }
    setOrdering(true)
    setError(null)
    try {
      const data = await apiFetch<{ url: string }>('/student/shop/checkout/', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map(i => ({ product_id: i.id, size: i.size, color: i.color, qty: i.qty })),
        }),
      })
      // Redirect al pagamento Stripe
      window.location.href = data.url
    } catch (err) {
      const errCode = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string; product?: string }) : undefined
      setError(
        errCode?.error === 'no_stock'
          ? t('orderErrorStock', { product: errCode.product ?? '' })
          : errCode?.error ?? t('orderErrorGeneric')
      )
      setOrdering(false)
    }
  }

  return (
    // z-[60] + bottom padding: the mobile bottom nav (z-50) was covering the checkout button
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60] p-4 pb-20 sm:pb-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-display text-lg text-gray-900">{t('yourCart')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-3 max-h-72 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-4">{t('cartEmpty')}</p>
          ) : (
            cart.map((item) => (
              <div key={cartKey(item.id, item.size, item.color)} className="flex items-center gap-3">
                {item.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.images[0]} alt="" className="w-10 h-12 object-cover rounded-lg border border-gray-100 shrink-0" />
                ) : (
                  <div className="w-10 h-12 rounded-lg bg-gray-50 flex items-center justify-center text-lg shrink-0">
                    {categoryEmoji[item.category] ?? '🛍️'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.name}
                    {(item.size || item.color) && (
                      <span className="text-xs text-gray-500 font-normal ml-1.5">
                        ({[item.size ? `${t('sizeLabel')} ${item.size}` : null, item.color].filter(Boolean).join(' · ')})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">€{Number(item.price).toFixed(2)} {t('each')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateQty(item.id, item.size, item.color, item.qty - 1)} className="w-7 h-7 rounded border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50">−</button>
                  <span className="w-5 text-center text-sm">{item.qty}</span>
                  <button onClick={() => updateQty(item.id, item.size, item.color, item.qty + 1)} className="w-7 h-7 rounded border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50">+</button>
                </div>
                <p className="text-sm font-semibold text-gray-900 w-16 text-right">
                  €{(Number(item.price) * item.qty).toFixed(2)}
                </p>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="px-5 pb-5">
            {/* Somme: subtotale + spedizione (unica, il costo più alto) */}
            <div className="py-3 border-t border-gray-100 mb-4 space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{t('subtotal')}</span>
                <span className="font-medium text-gray-900">€{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{t('shippingLabel')}</span>
                <span className="font-medium text-gray-900">
                  {shipping > 0 ? `€${shipping.toFixed(2)}` : t('freeShipping')}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-gray-100">
                <span className="font-semibold text-gray-900">{t('total')}</span>
                <span className="font-bold text-lg text-brand">€{total.toFixed(2)}</span>
              </div>
            </div>

            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                {error}
              </div>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-500 text-center">
                🔒 {t('securePaymentNote')}
              </p>
            </div>

            <button onClick={handleOrder} disabled={ordering} className="btn-pill btn-pill-solid w-full">
              <span>{ordering ? t('orderInProgress') : t('checkoutButton')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
