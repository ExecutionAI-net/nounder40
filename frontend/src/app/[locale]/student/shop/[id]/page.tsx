'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { useStudentShopEnabled } from '@/lib/brand'
import { useAuth } from '@/lib/api/auth-context'
import { apiFetch } from '@/lib/api/client'
import ProductDetailView from '@/components/shop/ProductDetailView'
import ShopCartModal from '@/components/shop/ShopCartModal'
import ShopLoginPrompt from '@/components/shop/ShopLoginPrompt'
import { useCart } from '@/lib/shop-cart'
import type { ShopProduct } from '@/lib/shop'

// Scheda prodotto a pagina intera ("Informazioni aggiuntive"), raggiungibile
// da /student/shop e condivisibile via URL.
export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('student.shop')
  const router = useRouter()
  // Negozio nascosto da HQ → fuori anche dagli URL diretti
  const shopEnabled = useStudentShopEnabled()
  useEffect(() => {
    if (shopEnabled === false) router.replace('/student/dashboard')
  }, [shopEnabled, router])
  const { user, loading: authLoading } = useAuth()
  const { count } = useCart()
  const [product, setProduct] = useState<ShopProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const isAuthed = authLoading ? null : !!user
  const [showCart, setShowCart] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)

  useEffect(() => {
    apiFetch<ShopProduct>(`/student/shop/${id}/`)
      .then(setProduct)
      .catch(() => setProduct(null))
      .finally(() => setLoading(false))
  }, [id])

  if (shopEnabled === false) return null
  if (loading) return <div className="text-sm text-gray-400">{t('loading')}</div>

  if (!product) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-400 text-sm">{t('productNotFound')}</p>
        <Link href="/student/shop" className="btn-pill mt-4 inline-flex">
          <span>{t('backToShop')}</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <Link href="/student/shop" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 hover:text-brand transition">
          ← {t('backToShop')}
        </Link>
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

      <ProductDetailView product={product} onGoToCart={() => setShowCart(true)} />

      {showCart && (
        <ShopCartModal
          isAuthed={isAuthed}
          onClose={() => setShowCart(false)}
          onLoginRequired={() => { setShowCart(false); setShowLoginPrompt(true) }}
        />
      )}

      {/* La scheda è pubblica: accesso richiesto solo per pagare */}
      {showLoginPrompt && (
        <ShopLoginPrompt next={`/student/shop/${id}`} onClose={() => setShowLoginPrompt(false)} />
      )}
    </div>
  )
}
