'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ShopProduct } from '@/lib/shop'

// Carrello condiviso fra la lista negozio e la scheda prodotto: vive in
// localStorage così sopravvive alla navigazione fra le due pagine. I prezzi
// salvati servono solo a mostrare il totale — il checkout li ricalcola a server.

export type CartItem = {
  id: string
  name: string
  price: number
  category: string
  images: string[] | null
  shipping_cost: number | null
  size: string | null
  color: string | null
  qty: number
}

const STORAGE_KEY = 'nu40_shop_cart'
const CHANGE_EVENT = 'nu40-cart-changed'

export function cartKey(id: string, size: string | null, color: string | null) {
  return `${id}__${size ?? ''}__${color ?? ''}`
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(items: CartItem[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // quota piena o storage disabilitato: il carrello resta valido in memoria
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function useCart() {
  // Parte vuoto e si idrata dopo il mount: evita mismatch server/client
  const [cart, setCart] = useState<CartItem[]>([])

  useEffect(() => {
    const sync = () => setCart(read())
    sync()
    window.addEventListener(CHANGE_EVENT, sync)
    // Altre schede aperte sullo stesso negozio
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const add = useCallback((product: ShopProduct, size: string | null, color: string | null, qty = 1) => {
    const items = read()
    const existing = items.find(i => i.id === product.id && i.size === size && i.color === color)
    if (existing) existing.qty += qty
    else items.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      category: product.category,
      images: product.images,
      shipping_cost: product.shipping_cost,
      size,
      color,
      qty,
    })
    write(items)
  }, [])

  const updateQty = useCallback((id: string, size: string | null, color: string | null, qty: number) => {
    const items = read().flatMap(i => {
      if (!(i.id === id && i.size === size && i.color === color)) return [i]
      return qty < 1 ? [] : [{ ...i, qty }]
    })
    write(items)
  }, [])

  const remove = useCallback((id: string, size: string | null, color: string | null) => {
    write(read().filter(i => !(i.id === id && i.size === size && i.color === color)))
  }, [])

  const clear = useCallback(() => write([]), [])

  const subtotal = cart.reduce((sum, i) => sum + Number(i.price) * i.qty, 0)
  // Una sola spedizione per ordine: si applica il costo più alto del carrello
  const shipping = cart.length > 0 ? Math.max(...cart.map(i => Number(i.shipping_cost ?? 0))) : 0
  const count = cart.reduce((sum, i) => sum + i.qty, 0)

  return { cart, add, updateQty, remove, clear, subtotal, shipping, total: subtotal + shipping, count }
}
