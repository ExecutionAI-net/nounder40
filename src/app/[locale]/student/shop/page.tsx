'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

type Variant = {
  id: string
  size: string | null
  color: string | null
  stock: number
}

type Product = {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  original_price: number | null
  shipping_cost: number | null
  sizes: string[] | null
  colors: string[] | null
  images: string[] | null
  active: boolean
  shop_product_variants?: Variant[]
}

// Una riga di carrello per combinazione prodotto+taglia+colore
type CartItem = Product & { size: string | null; color: string | null; qty: number }

const CATEGORIES = ['all', 'clothing', 'shoes', 'accessories', 'equipment', 'other']

const categoryColors: Record<string, string> = {
  clothing: 'bg-purple-100 text-purple-700',
  shoes: 'bg-blue-100 text-blue-700',
  accessories: 'bg-amber-100 text-amber-700',
  equipment: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

const categoryEmoji: Record<string, string> = {
  shoes: '👟',
  clothing: '👗',
  accessories: '👜',
  equipment: '🎒',
}

function discountPct(p: Product) {
  if (!p.original_price || Number(p.original_price) <= Number(p.price)) return null
  return Math.round((1 - Number(p.price) / Number(p.original_price)) * 100)
}

// Mini-galleria: immagine principale + pallini per scorrere
function ProductGallery({ product }: { product: Product }) {
  const [idx, setIdx] = useState(0)
  const images = product.images ?? []

  if (images.length === 0) {
    return (
      <div className="w-full h-36 rounded-lg bg-gray-50 flex items-center justify-center">
        <span className="text-4xl text-gray-200">{categoryEmoji[product.category] ?? '🛍️'}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[Math.min(idx, images.length - 1)]}
        alt={product.name}
        className="w-full h-36 object-cover rounded-lg cursor-pointer"
        onClick={() => setIdx((idx + 1) % images.length)}
      />
      {images.length > 1 && (
        <>
          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`w-1.5 h-1.5 rounded-full transition ${i === idx ? 'bg-white' : 'bg-white/50'}`}
              />
            ))}
          </div>
          {/* Freccia: segnala che ci sono più immagini */}
          <button
            onClick={() => setIdx((idx + 1) % images.length)}
            className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition"
            aria-label="Next image"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}

function StudentShopInner() {
  const t = useTranslations('student.shop')
  const tLayout = useTranslations('layout')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  // Taglia/colore selezionati per ciascun prodotto (product.id → valore)
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({})
  const [selectedColors, setSelectedColors] = useState<Record<string, string>>({})
  const [sizeError, setSizeError] = useState<Record<string, boolean>>({})
  const [colorError, setColorError] = useState<Record<string, boolean>>({})
  // Ordine online: libero per i registrati; gli anonimi vengono invitati a registrarsi
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  // Descrizioni lunghe: espandi/comprimi per card
  const [expandedDesc, setExpandedDesc] = useState<Record<string, boolean>>({})

  useEffect(() => { fetchProducts() }, [filterCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setIsAuthed(!!user))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esito checkout Stripe (?payment=success|cancelled)
  useEffect(() => {
    const payment = searchParams.get('payment')
    if (payment === 'success') { setOrderSuccess(true); setCart([]) }
    if (payment === 'cancelled') setOrderError(t('paymentCancelled'))
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

  function cartKey(id: string, size: string | null, color: string | null) {
    return `${id}__${size ?? ''}__${color ?? ''}`
  }

  function addToCart(product: Product) {
    const hasSizes = (product.sizes?.length ?? 0) > 0
    const hasColors = (product.colors?.length ?? 0) > 0
    const size = hasSizes ? selectedSizes[product.id] ?? null : null
    const color = hasColors ? selectedColors[product.id] ?? null : null
    let missing = false
    if (hasSizes && !size) { setSizeError(e => ({ ...e, [product.id]: true })); missing = true }
    if (hasColors && !color) { setColorError(e => ({ ...e, [product.id]: true })); missing = true }
    if (missing) return
    setSizeError(e => ({ ...e, [product.id]: false }))
    setColorError(e => ({ ...e, [product.id]: false }))
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id && i.size === size && i.color === color)
      if (existing) return prev.map((i) => i.id === product.id && i.size === size && i.color === color ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { ...product, size, color, qty: 1 }]
    })
  }

  function removeFromCart(id: string, size: string | null, color: string | null) {
    setCart((prev) => prev.filter((i) => !(i.id === id && i.size === size && i.color === color)))
  }

  function updateQty(id: string, size: string | null, color: string | null, qty: number) {
    if (qty < 1) { removeFromCart(id, size, color); return }
    setCart((prev) => prev.map((i) => i.id === id && i.size === size && i.color === color ? { ...i, qty } : i))
  }

  // Somme carrello: subtotale prodotti + spedizione (un'unica spedizione per
  // ordine: si applica il costo più alto tra i prodotti nel carrello)
  const cartSubtotal = cart.reduce((sum, i) => sum + Number(i.price) * i.qty, 0)
  const cartShipping = cart.length > 0 ? Math.max(...cart.map(i => Number(i.shipping_cost ?? 0))) : 0
  const cartTotal = cartSubtotal + cartShipping
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0)

  // Checkout: registrato → sessione Stripe (vendita diretta HQ, la scuola
  // matura la commissione lato server); anonimo → registrati/accedi
  async function handleOrder() {
    if (!isAuthed) { setShowLoginPrompt(true); return }
    setOrdering(true)
    setOrderError(null)
    const res = await fetch('/api/student/shop/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(i => ({ product_id: i.id, size: i.size, color: i.color, qty: i.qty })),
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setOrderError(
        data.error === 'no_stock'
          ? t('orderErrorStock', { product: data.product ?? '' })
          : data.error ?? t('orderErrorGeneric')
      )
      setOrdering(false)
    } else {
      // Redirect al pagamento Stripe
      window.location.href = data.url
    }
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

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
        {cartCount > 0 && (
          <button
            onClick={() => setShowCart(true)}
            className="relative bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            {t('cart')}
            <span className="absolute -top-1.5 -right-1.5 bg-white text-[#6B1F3A] text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center border border-[#6B1F3A]">
              {cartCount}
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
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition capitalize ${
              filterCategory === cat
                ? 'bg-[#6B1F3A] text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:border-[#6B1F3A]/40'
            }`}
          >
            {cat === 'all' ? t('categoryAll') : t(`category.${cat}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('noProducts')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => {
            const pct = discountPct(product)
            const hasSizes = (product.sizes?.length ?? 0) > 0
            const hasColors = (product.colors?.length ?? 0) > 0
            const chosenSize = selectedSizes[product.id] ?? ''
            const chosenColor = selectedColors[product.id] ?? ''
            // Disponibilità reale: se esistono varianti a stock, taglie e colori
            // sono abbinati — un colore è selezionabile solo se la combinazione
            // con la taglia scelta ha stock > 0 (e viceversa)
            const variants = product.shop_product_variants ?? []
            const hasVariantData = variants.length > 0
            const sizeHasStock = (s: string) =>
              !hasVariantData || variants.some(v => v.size === s && v.stock > 0 && (!chosenColor || v.color === chosenColor))
            const colorHasStock = (c: string) =>
              !hasVariantData || variants.some(v => v.color === c && v.stock > 0 && (!chosenSize || v.size === chosenSize))
            const soldOut = hasVariantData && variants.every(v => v.stock <= 0)
            const inCart = cart.find((i) =>
              i.id === product.id &&
              i.size === (hasSizes ? (chosenSize || null) : null) &&
              i.color === (hasColors ? (chosenColor || null) : null)
            )
            const shipping = Number(product.shipping_cost ?? 0)
            return (
              <div key={product.id} className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
                <div className="relative">
                  <ProductGallery product={product} />
                  {pct !== null && (
                    <span className="absolute top-2 left-2 text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
                      -{pct}%
                    </span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">{product.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize flex-shrink-0 ${categoryColors[product.category] ?? categoryColors.other}`}>
                      {CATEGORIES.includes(product.category) ? t(`category.${product.category}` as Parameters<typeof t>[0]) : product.category}
                    </span>
                  </div>
                  {product.description && (
                    <>
                      <p className={`text-xs text-gray-500 mt-1 ${expandedDesc[product.id] ? '' : 'line-clamp-2'}`}>
                        {product.description}
                      </p>
                      {/* Soglia bassa: ~2 righe ≈ 80-90 caratteri, meglio mostrare
                          il toggle una volta in più che nasconderlo su testi tagliati */}
                      {product.description.length > 60 && (
                        <button
                          onClick={() => setExpandedDesc(e => ({ ...e, [product.id]: !e[product.id] }))}
                          className="inline-flex items-center gap-0.5 text-[11px] text-[#6B1F3A] font-medium hover:underline mt-0.5"
                        >
                          {expandedDesc[product.id] ? t('showLess') : t('readMore')}
                          <svg className={`w-3 h-3 transition-transform ${expandedDesc[product.id] ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                  <div className="flex items-baseline gap-2 mt-2">
                    <p className="text-base font-bold text-[#6B1F3A]">€{Number(product.price).toFixed(2)}</p>
                    {pct !== null && (
                      <p className="text-xs text-gray-400 line-through">€{Number(product.original_price).toFixed(2)}</p>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {shipping > 0 ? t('shippingCost', { cost: shipping.toFixed(2) }) : t('freeShipping')}
                  </p>

                  {/* Taglie */}
                  {hasSizes && (
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-1.5">
                        {product.sizes!.map((size) => {
                          const available = sizeHasStock(size)
                          return (
                            <button
                              key={size}
                              disabled={!available}
                              onClick={() => {
                                setSelectedSizes(s => ({ ...s, [product.id]: size }))
                                setSizeError(e => ({ ...e, [product.id]: false }))
                                // Il colore scelto potrebbe non esistere per questa taglia
                                if (chosenColor && hasVariantData && !variants.some(v => v.size === size && v.color === chosenColor && v.stock > 0)) {
                                  setSelectedColors(s => { const n = { ...s }; delete n[product.id]; return n })
                                }
                              }}
                              className={`min-w-8 px-2 py-1 rounded-md text-xs font-medium border transition ${
                                chosenSize === size
                                  ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                                  : available
                                    ? 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1F3A]/40'
                                    : 'bg-gray-50 text-gray-300 border-gray-100 line-through cursor-not-allowed'
                              }`}
                            >
                              {size}
                            </button>
                          )
                        })}
                      </div>
                      {sizeError[product.id] && (
                        <p className="text-[11px] text-red-500 mt-1">{t('chooseSize')}</p>
                      )}
                    </div>
                  )}

                  {/* Colori */}
                  {hasColors && (
                    <div className="mt-2">
                      <div className="flex flex-wrap gap-1.5">
                        {product.colors!.map((color) => {
                          const available = colorHasStock(color)
                          return (
                            <button
                              key={color}
                              disabled={!available}
                              onClick={() => {
                                setSelectedColors(s => ({ ...s, [product.id]: color }))
                                setColorError(e => ({ ...e, [product.id]: false }))
                              }}
                              className={`px-2 py-1 rounded-md text-xs font-medium border transition ${
                                chosenColor === color
                                  ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                                  : available
                                    ? 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1F3A]/40'
                                    : 'bg-gray-50 text-gray-300 border-gray-100 line-through cursor-not-allowed'
                              }`}
                            >
                              {color}
                            </button>
                          )
                        })}
                      </div>
                      {colorError[product.id] && (
                        <p className="text-[11px] text-red-500 mt-1">{t('chooseColor')}</p>
                      )}
                    </div>
                  )}
                </div>
                {inCart ? (
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
                  <button
                    onClick={() => addToCart(product)}
                    disabled={soldOut}
                    className="w-full py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {soldOut ? t('soldOut') : t('addToCart')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Login/registrazione richiesta per ordinare (utente anonimo) */}
      {showLoginPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setShowLoginPrompt(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-[#6B1F3A]/10 text-[#6B1F3A] flex items-center justify-center mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 text-lg">{t('loginPromptTitle')}</h3>
              <p className="text-sm text-gray-500 mt-1.5">{t('loginPromptText')}</p>
            </div>
            <div className="px-6 pb-6 space-y-2">
              <button
                onClick={() => router.push('/register?next=%2Fstudent%2Fshop')}
                className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition"
              >
                {tLayout('register')}
              </button>
              <button
                onClick={() => router.push('/login?next=%2Fstudent%2Fshop')}
                className="w-full py-2.5 border border-[#6B1F3A]/30 text-[#6B1F3A] rounded-xl text-sm font-medium hover:bg-[#6B1F3A]/5 transition"
              >
                {tLayout('signIn')}
              </button>
              <button
                onClick={() => setShowLoginPrompt(false)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{t('yourCart')}</h3>
              <button onClick={() => setShowCart(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-3 max-h-72 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-4">{t('cartEmpty')}</p>
              ) : (
                cart.map((item) => (
                  <div key={cartKey(item.id, item.size, item.color)} className="flex items-center gap-3">
                    {item.images?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.images[0]} alt="" className="w-10 h-10 object-cover rounded-lg border border-gray-100 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-lg shrink-0">
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
                    <span className="font-medium text-gray-900">€{cartSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">{t('shippingLabel')}</span>
                    <span className="font-medium text-gray-900">
                      {cartShipping > 0 ? `€${cartShipping.toFixed(2)}` : t('freeShipping')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1.5 border-t border-gray-100">
                    <span className="font-semibold text-gray-900">{t('total')}</span>
                    <span className="font-bold text-lg text-[#6B1F3A]">€{cartTotal.toFixed(2)}</span>
                  </div>
                </div>
                {orderError && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                    {orderError}
                  </div>
                )}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-500 text-center">
                    🔒 {t('securePaymentNote')}
                  </p>
                </div>
                <button
                  onClick={handleOrder}
                  disabled={ordering}
                  className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {ordering ? t('orderInProgress') : t('checkoutButton')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StudentShopPage() {
  return <Suspense><StudentShopInner /></Suspense>
}
