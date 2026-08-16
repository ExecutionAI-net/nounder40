'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import ProductCard from '@/components/shop/ProductCard'
import ShopCartModal from '@/components/shop/ShopCartModal'
import ShopLoginPrompt from '@/components/shop/ShopLoginPrompt'
import { useCart } from '@/lib/shop-cart'
import type { ShopProduct } from '@/lib/shop'

const CATEGORIES = ['all', 'clothing', 'shoes', 'accessories', 'equipment', 'other']

function StudentShopInner() {
  const t = useTranslations('student.shop')
  const searchParams = useSearchParams()
  const supabase = createClient()
  const { count, clear } = useCart()
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [showCart, setShowCart] = useState(false)
  // Ordine online: libero per i registrati; gli anonimi vengono invitati a registrarsi
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  useEffect(() => { fetchProducts() }, [filterCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setIsAuthed(!!user))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esito checkout Stripe (?payment=success|cancelled) e ritorno dalla scheda
  // prodotto con richiesta di apertura carrello (?cart=1)
  useEffect(() => {
    const payment = searchParams.get('payment')
    if (payment === 'success') { setOrderSuccess(true); clear() }
    if (payment === 'cancelled') setOrderError(t('paymentCancelled'))
    if (searchParams.get('cart') === '1') setShowCart(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function fetchProducts() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCategory !== 'all') params.set('category', filterCategory)
    const res = await fetch(`/api/student/shop?${params}`)
    if (res.ok) setProducts(await res.json())
    setLoading(false)
  }

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
