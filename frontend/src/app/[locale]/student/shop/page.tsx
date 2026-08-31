'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import { useStudentShopEnabled } from '@/lib/brand'
import ProductCard from '@/components/shop/ProductCard'
import ShopCartModal from '@/components/shop/ShopCartModal'
import ShopLoginPrompt from '@/components/shop/ShopLoginPrompt'
import { useCart } from '@/lib/shop-cart'
import type { ShopProduct } from '@/lib/shop'

const CATEGORIES = ['all', 'clothing', 'shoes', 'accessories', 'equipment', 'other']

type ShopOrderItem = { product_id: string; name: string; price: string; qty: number; size?: string | null; color?: string | null }
type ShopOrderRow = {
  id: string; created_at: string; status: string; items: ShopOrderItem[]
  subtotal: string; discount_amount: string; shipping: string; total: string
  school_name: string | null
}

function StudentShopInner() {
  const t = useTranslations('student.shop')
  const searchParams = useSearchParams()
  const router = useRouter()
  // Negozio nascosto da HQ → fuori anche dagli URL diretti
  const shopEnabled = useStudentShopEnabled()
  useEffect(() => {
    if (shopEnabled === false) router.replace('/student/dashboard')
  }, [shopEnabled, router])
  const { user, loading: authLoading } = useAuth()
  const { count, clear } = useCart()
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [showCart, setShowCart] = useState(false)
  // Ordine online: libero per i registrati; gli anonimi vengono invitati a registrarsi
  const isAuthed = authLoading ? null : !!user
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  // Tab "I miei acquisti": cronologia ordini con tutte le righe e i totali
  const [tab, setTab] = useState<'shop' | 'orders'>('shop')
  const [orders, setOrders] = useState<ShopOrderRow[] | null>(null)
  useEffect(() => {
    if (tab !== 'orders' || !user) return
    apiFetch<ShopOrderRow[]>('/student/shop/orders/')
      .then(setOrders)
      .catch(() => setOrders([]))
  }, [tab, user])

  useEffect(() => { fetchProducts() }, [filterCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esito checkout Stripe (?payment=success|cancelled) e ritorno dalla scheda
  // prodotto con richiesta di apertura carrello (?cart=1)
  useEffect(() => {
    const payment = searchParams.get('payment')
    if (payment === 'success') { setOrderSuccess(true); clear(); setTab('orders') }
    if (payment === 'cancelled') setOrderError(t('paymentCancelled'))
    if (searchParams.get('cart') === '1') setShowCart(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function fetchProducts() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCategory !== 'all') params.set('category', filterCategory)
    try {
      setProducts(await apiFetch<ShopProduct[]>(`/student/shop/?${params}`))
    } catch {
      setProducts([])
    }
    setLoading(false)
  }

  if (shopEnabled === false) return null

  return (
    <div>
      {/* Esito pagamento */}
      {orderSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex justify-between items-center">
          {t('orderSuccess')}
          <button onClick={() => setOrderSuccess(false)} className="text-green-400 text-xs ml-4">✕</button>
        </div>
      )}
      {orderError && !showCart && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex justify-between items-center">
          {orderError}
          <button onClick={() => setOrderError(null)} className="text-amber-400 text-xs ml-4">✕</button>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        {count > 0 && (
          <button onClick={() => setShowCart(true)} className="btn-pill btn-pill-solid shrink-0">
            <span>{t('cart')}</span>
            {/* Contatore dentro il bottone: niente pallino sovrapposto al testo */}
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-white text-brand text-[11px] font-bold">
              {count}
            </span>
          </button>
        )}
      </div>

      {/* Negozio / I miei acquisti */}
      {isAuthed && (
        <div className="inline-flex bg-gray-100 rounded-xl p-1 mb-6">
          {(['shop', 'orders'] as const).map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              {k === 'shop' ? t('tabShop') : t('tabMyPurchases')}
            </button>
          ))}
        </div>
      )}

      {tab === 'orders' ? (
        orders === null ? (
          <div className="text-sm text-gray-400">{t('loading')}</div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">{t('ordersEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(o => (
              <div key={o.id} className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {new Date(o.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                    {o.school_name && <p className="text-xs text-gray-400">🏫 {o.school_name}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    o.status === 'paid' || o.status === 'completed' ? 'bg-green-100 text-green-700'
                      : o.status === 'cancelled' ? 'bg-red-100 text-red-600'
                      : 'bg-amber-100 text-amber-700'}`}>
                    {o.status === 'pending' ? t('orderStatusPending')
                      : o.status === 'paid' || o.status === 'completed' ? t('orderStatusPaid')
                      : o.status === 'cancelled' ? t('orderStatusCancelled') : o.status}
                  </span>
                </div>
                <div className="divide-y divide-gray-50 text-sm">
                  {o.items.map((it, i) => (
                    <div key={i} className="py-2 flex items-center justify-between gap-3">
                      <span className="text-gray-700">
                        {it.qty} × {it.name}
                        {(it.size || it.color) && (
                          <span className="text-gray-400"> ({[it.size, it.color].filter(Boolean).join(', ')})</span>
                        )}
                      </span>
                      <span className="text-gray-600 whitespace-nowrap">€{(Number(it.price) * it.qty).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 text-sm space-y-1">
                  <div className="flex justify-between text-gray-500"><span>{t('orderSubtotal')}</span><span>€{Number(o.subtotal).toFixed(2)}</span></div>
                  {Number(o.discount_amount) > 0 && (
                    <div className="flex justify-between text-green-600"><span>{t('orderDiscount')}</span><span>−€{Number(o.discount_amount).toFixed(2)}</span></div>
                  )}
                  {Number(o.shipping) > 0 && (
                    <div className="flex justify-between text-gray-500"><span>{t('orderShipping')}</span><span>€{Number(o.shipping).toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between font-semibold text-gray-900"><span>{t('orderTotal')}</span><span>€{Number(o.total).toFixed(2)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
      <>
      {/* Category filters */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition ${
              filterCategory === cat
                ? 'bg-brand text-brand-fg'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-brand/40'
            }`}
          >
            {cat === 'all' ? t('categoryAll') : t(`category.${cat}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('noProducts')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} detailHref={`/student/shop/${product.id}`} />
          ))}
        </div>
      )}

      </>
      )}

      {/* Login/registrazione richiesta solo per pagare (utente anonimo) */}
      {showLoginPrompt && (
        <ShopLoginPrompt next="/student/shop?cart=1" onClose={() => setShowLoginPrompt(false)} />
      )}

      {showCart && (
        <ShopCartModal
          isAuthed={isAuthed}
          onClose={() => setShowCart(false)}
          onLoginRequired={() => { setShowCart(false); setShowLoginPrompt(true) }}
        />
      )}
    </div>
  )
}

export default function StudentShopPage() {
  return <Suspense><StudentShopInner /></Suspense>
}
