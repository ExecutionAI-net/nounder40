'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

type Product = {
  id: string
  name: string
  description: string | null
  category: string
  price: number
  active: boolean
}

type CartItem = Product & { qty: number }

const CATEGORIES = ['all', 'clothing', 'shoes', 'accessories', 'equipment', 'other']

const categoryColors: Record<string, string> = {
  clothing: 'bg-purple-100 text-purple-700',
  shoes: 'bg-blue-100 text-blue-700',
  accessories: 'bg-amber-100 text-amber-700',
  equipment: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

export default function StudentShopPage() {
  const t = useTranslations('student.shop')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)

  useEffect(() => { fetchProducts() }, [filterCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProducts() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterCategory !== 'all') params.set('category', filterCategory)
    const res = await fetch(`/api/student/shop?${params}`)
    if (res.ok) setProducts(await res.json())
    setLoading(false)
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id)
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { ...product, qty: 1 }]
    })
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id))
  }

  function updateQty(id: string, qty: number) {
    if (qty < 1) { removeFromCart(id); return }
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, qty } : i))
  }

  const cartTotal = cart.reduce((sum, i) => sum + Number(i.price) * i.qty, 0)
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0)

  return (
    <div>
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
            const inCart = cart.find((i) => i.id === product.id)
            return (
              <div key={product.id} className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
                <div className="w-full h-36 rounded-lg bg-gray-50 flex items-center justify-center">
                  <span className="text-4xl text-gray-200">
                    {product.category === 'shoes' ? '👟' :
                     product.category === 'clothing' ? '👗' :
                     product.category === 'accessories' ? '👜' :
                     product.category === 'equipment' ? '🎒' : '🛍️'}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-gray-900 text-sm leading-snug">{product.name}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize flex-shrink-0 ${categoryColors[product.category] ?? categoryColors.other}`}>
                      {product.category}
                    </span>
                  </div>
                  {product.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{product.description}</p>
                  )}
                  <p className="text-base font-bold text-[#6B1F3A] mt-2">€{Number(product.price).toFixed(2)}</p>
                </div>
                {inCart ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQty(product.id, inCart.qty - 1)}
                      className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center text-sm font-medium text-gray-900">{inCart.qty}</span>
                    <button
                      onClick={() => updateQty(product.id, inCart.qty + 1)}
                      className="w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-sm font-bold"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => addToCart(product)}
                    className="w-full py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
                  >
                    {t('addToCart')}
                  </button>
                )}
              </div>
            )
          })}
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
                  <div key={item.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-400">€{Number(item.price).toFixed(2)} {t('each')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.id, item.qty - 1)} className="w-7 h-7 rounded border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50">−</button>
                      <span className="w-5 text-center text-sm">{item.qty}</span>
                      <button onClick={() => updateQty(item.id, item.qty + 1)} className="w-7 h-7 rounded border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50">+</button>
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
                <div className="flex justify-between items-center py-3 border-t border-gray-100 mb-4">
                  <span className="font-semibold text-gray-900">{t('total')}</span>
                  <span className="font-bold text-lg text-[#6B1F3A]">€{cartTotal.toFixed(2)}</span>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-amber-700 text-center">
                    {t('contactSchoolNote')}
                  </p>
                </div>
                <button
                  onClick={() => setShowCart(false)}
                  className="w-full py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
                >
                  {t('contactSchoolButton')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
