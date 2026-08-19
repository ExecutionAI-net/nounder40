// Tipi e utility condivisi fra negozio studente, scheda prodotto e anteprima HQ.

export type ShopVariant = {
  id: string
  size: string | null
  color: string | null
  stock: number
}

/** Etichetta in evidenza sulla card (es. NEW, In offerta) */
export type ShopBadge = { label: string; color: string }

export type ShopProduct = {
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
  badges?: ShopBadge[] | null
  active: boolean
  shop_product_variants?: ShopVariant[]
}

/** Etichette valide del prodotto (il campo può mancare sui dati vecchi). */
export function productBadges(product: Pick<ShopProduct, 'badges'>): ShopBadge[] {
  if (!Array.isArray(product.badges)) return []
  return product.badges
    .filter(b => b && typeof b.label === 'string' && b.label.trim())
    .map(b => ({ label: b.label.trim(), color: /^#[0-9a-fA-F]{6}$/.test(b.color ?? '') ? b.color : '#3D3D3D' }))
}

export const SHOP_CATEGORIES = ['clothing', 'shoes', 'accessories', 'equipment', 'other'] as const

export const categoryEmoji: Record<string, string> = {
  shoes: '👟',
  clothing: '👗',
  accessories: '👜',
  equipment: '🎒',
}

/** Percentuale di sconto se il prodotto è in offerta, altrimenti null. */
export function discountPct(p: Pick<ShopProduct, 'price' | 'original_price'>): number | null {
  if (!p.original_price || Number(p.original_price) <= Number(p.price)) return null
  return Math.round((1 - Number(p.price) / Number(p.original_price)) * 100)
}

/**
 * Disponibilità reale di una combinazione taglia/colore: quando esistono
 * varianti a stock, taglia e colore sono abbinati — una taglia è selezionabile
 * solo se la combinazione col colore scelto ha stock (e viceversa).
 */
export function availability(product: ShopProduct, chosenSize: string, chosenColor: string) {
  const variants = product.shop_product_variants ?? []
  const tracked = variants.length > 0
  return {
    tracked,
    sizeHasStock: (size: string) =>
      !tracked || variants.some(v => v.size === size && v.stock > 0 && (!chosenColor || v.color === chosenColor)),
    colorHasStock: (color: string) =>
      !tracked || variants.some(v => v.color === color && v.stock > 0 && (!chosenSize || v.size === chosenSize)),
    soldOut: tracked && variants.every(v => v.stock <= 0),
  }
}
