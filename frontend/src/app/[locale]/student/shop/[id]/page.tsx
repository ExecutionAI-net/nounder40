'use client'

import { use, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { createClient } from '@/lib/supabase/client'
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
  const supabase = createClient()
  const { count } = useCart()
  const [product, setProduct] = useState<ShopProduct | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [showCart, setShowCart] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)

  useEffect(() => {
    fetch(`/api/student/shop/${id}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setProduct(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setIsAuthed(!!user))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
