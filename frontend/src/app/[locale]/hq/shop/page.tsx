'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import ProductCard from '@/components/shop/ProductCard'
import DiscountCodesManager from '@/components/DiscountCodesManager'
import ProductDetailView from '@/components/shop/ProductDetailView'
import ColorPicker from '@/components/ui/ColorPicker'
import RichTextMini from '@/components/ui/RichTextMini'
import { BRAND_DEFAULTS, brandCssVars, type BrandSettings } from '@/lib/brand'
import { productBadges, SHOP_CATEGORIES, type ShopBadge, type ShopProduct } from '@/lib/shop'
import { apiFetch, ApiError } from '@/lib/api/client'
import PlatformVisibilityToggle from '@/components/hq/PlatformVisibilityToggle'
import { formatMoney } from '@/lib/format-money'
import { formatDate, toISODate } from '@/lib/format-date'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import PhoneInput from '@/components/ui/PhoneInput'

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body) {
    return (err.body as { error?: string }).error ?? fallback
  }
  return fallback
}

type Variant = {
  id: string
  size: string | null
  color: string | null
  stock: number
  sold: number
}

// DRF serializes DecimalField as a string (COERCE_DECIMAL_TO_STRING) — every
// usage below already wraps these in Number(...) before math/.toFixed().
type Product = {
  id: string
  name: string
  description: string | null
  category: string
  price: string | number
  original_price: string | number | null
  shipping_cost: string | number | null
  sizes: string[] | null
  colors: string[] | null
  images: string[] | null
  badges?: ShopBadge[] | null
  active: boolean
  online: boolean  // in vetrina allieve; false = si vende solo in sede
  created_at: string
  shop_product_variants?: Variant[]
}

type Sale = {
  id: string
  qty: number
  unit_price: string | number
  total: string | number
  commission: string | number
  shipping: string | number
  source: string
  payment_method: string | null
  discount: string | number
  referrer: string | null
  referrer_contact: string | null
  referrer_percentage: string | number
  referrer_commission: string | number
  order_id: string | null
  size: string | null
  color: string | null
  notes: string | null
  created_at: string
  product_id: string
  student_id: string | null
  school_id: string | null
  shop_products: { name: string } | null
  students: { name: string } | null
  schools: { name: string } | null
}

type StudentOption = { id: string; name: string; email: string | null; schools: { name: string } | null }

// Riga della vendita manuale (carrello come lato studente)
type SaleLine = { product_id: string; variant_id: string; qty: number }

const CATEGORIES = ['clothing', 'shoes', 'accessories', 'equipment', 'other']

const PAYMENT_METHODS = ['bonifico', 'carta', 'contante', 'cambio', 'regalo']

// Taglie proposte per categoria (vuoto = taglia unica).
// Scarpe: numeri da 35 a 42 incluse le mezze misure.
const SIZE_OPTIONS: Record<string, string[]> = {
  clothing: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  shoes: ['35', '35,5', '36', '36,5', '37', '37,5', '38', '38,5', '39', '39,5', '40', '40,5', '41', '41,5', '42'],
}

const EMPTY_FORM = {
  name: '',
  description: '',
  category: 'clothing',
  price: '',
  original_price: '',
  shipping_cost: '',
  sizes: [] as string[],
  colors: [] as string[],
  badges: [] as ShopBadge[],
}

// Colori proposti per le etichette in evidenza
const BADGE_COLORS = ['#3D3D3D', '#1F1F1F', '#6B1F3A', '#dc2626', '#16a34a', '#b45309']

// Referenti / segnalatori: anagrafica HQ da cui si sceglie nella vendita
// manuale (Carlo, 30/10/2026). La percentuale NON sta qui: si digita a ogni
// vendita perché può cambiare per prodotto.
type Referrer = {
  id: string
  first_name: string
  last_name: string
  full_name: string
  phone: string
  email: string
  active: boolean
  sales_count: number
}
const EMPTY_REFERRER = { first_name: '', last_name: '', phone: '', email: '' }

// Filtri del registro vendite: il mese corrente come punto di partenza
function currentMonthRange() {
  const now = new Date()
  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  }
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

const categoryColors: Record<string, string> = {
  clothing: 'bg-purple-100 text-purple-700',
  shoes: 'bg-blue-100 text-blue-700',
  accessories: 'bg-amber-100 text-amber-700',
  equipment: 'bg-green-100 text-green-700',
  other: 'bg-gray-100 text-gray-600',
}

const variantKey = (size: string | null, color: string | null) => `${size ?? ''}|${color ?? ''}`

// ProductCard/ProductDetailView (shared with the student shop) expect numeric
// price fields — DRF sends Decimal fields as strings (COERCE_DECIMAL_TO_STRING).
function toShopProduct(p: Product): ShopProduct {
  return {
    ...p,
    price: Number(p.price),
    original_price: p.original_price == null ? null : Number(p.original_price),
    shipping_cost: p.shipping_cost == null ? null : Number(p.shipping_cost),
  }
}

// Combinazioni taglia × colore da gestire a stock
function combos(sizes: string[], colors: string[]): { size: string | null; color: string | null }[] {
  if (sizes.length && colors.length) return sizes.flatMap(s => colors.map(c => ({ size: s, color: c })))
  if (sizes.length) return sizes.map(s => ({ size: s, color: null }))
  if (colors.length) return colors.map(c => ({ size: null, color: c }))
  return [{ size: null, color: null }]
}

function HQShopInner() {
  const t = useTranslations('hq.shop')
  const tDiscounts = useTranslations('discountCodes')
  // Prodotti a cui un codice sconto può essere limitato
  const loadShopItems = useCallback(
    () => apiFetch<Product[]>('/hq/shop/').then(rows => (Array.isArray(rows) ? rows : []).map(p => ({ id: p.id, label: p.name }))),
    []
  )
  // Etichette categoria: le stesse traduzioni della vetrina studente
  const tCat = useTranslations('student.shop')
  const catLabel = (c: string) =>
    SHOP_CATEGORIES.includes(c as typeof SHOP_CATEGORIES[number])
      ? tCat(`category.${c}` as Parameters<typeof tCat>[0])
      : c
  const uiLocale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Il form aperto vive nell'URL (?edit=new|<id>): la freccia indietro
  // torna così al Negozio invece che alla dashboard
  const editParam = searchParams.get('edit')
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [tab, setTab] = useState<'products' | 'sales' | 'codes' | 'referrers'>('products')
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [refForm, setRefForm] = useState(EMPTY_REFERRER)
  const [refEditing, setRefEditing] = useState<Referrer | null>(null)
  const [refFormOpen, setRefFormOpen] = useState(false)
  const [refSaving, setRefSaving] = useState(false)
  const [refError, setRefError] = useState<string | null>(null)
  // Lista prodotti: tabella gestionale o vetrina identica a quella dell'allieva
  const [productView, setProductView] = useState<'table' | 'grid'>('table')
  const [preview, setPreview] = useState<Product | null>(null)
  const [brand, setBrand] = useState<BrandSettings>(BRAND_DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [colorInput, setColorInput] = useState('')
  const [stockMatrix, setStockMatrix] = useState<Record<string, string>>({})
  const [savingStock, setSavingStock] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)


  // Vendita manuale — carrello: studente cercabile, più prodotti, pagamento
  const [saleOpen, setSaleOpen] = useState(false)
  const [saleLines, setSaleLines] = useState<SaleLine[]>([])
  const [saleStudentId, setSaleStudentId] = useState('')
  const [studentQuery, setStudentQuery] = useState('')
  const [studentListOpen, setStudentListOpen] = useState(false)
  const [salePayment, setSalePayment] = useState('contante')
  // Sconto manuale aggiuntivo (€ o %) e referente/segnalatore con sua %
  const [saleDiscountValue, setSaleDiscountValue] = useState('')
  const [saleDiscountType, setSaleDiscountType] = useState<'eur' | 'pct'>('eur')
  const [saleReferrerId, setSaleReferrerId] = useState('')
  const [saleReferrerPct, setSaleReferrerPct] = useState('')
  const [saleSubmitting, setSaleSubmitting] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)
  const [students, setStudents] = useState<StudentOption[] | null>(null)

  // Filtri registro vendite: multiselezione con etichetta, date dal mese
  // corrente (come report scuola e compensi insegnante)
  const [salesFilterProduct, setSalesFilterProduct] = useState<string[]>([])
  const [salesFilterSchool, setSalesFilterSchool] = useState<string[]>([])
  const [salesFilterStudent, setSalesFilterStudent] = useState<string[]>([])
  const [salesFilterReferrer, setSalesFilterReferrer] = useState<string[]>([])
  const [salesFrom, setSalesFrom] = useState(() => currentMonthRange().from)
  const [salesTo, setSalesTo] = useState(() => currentMonthRange().to)

  useEffect(() => {
    fetchProducts()
    fetchSales()
    fetchReferrers()
    // Aspetto configurato in HQ > Aspetto e barra: serve a rendere l'anteprima
    // con gli stessi colori e font che vede l'allieva
    apiFetch<BrandSettings>('/hq/brand-settings/').then(d => { if (d) setBrand(d) }).catch(() => {})
  }, [])

  async function fetchProducts() {
    setLoading(true)
    const data = await apiFetch<Product[]>('/hq/shop/').catch(() => [])
    setProducts(data)
    setLoading(false)
  }

  async function fetchSales() {
    const data = await apiFetch<Sale[]>('/hq/shop-sales/').catch(() => [])
    setSales(data)
  }

  async function fetchReferrers() {
    const data = await apiFetch<Referrer[]>('/hq/shop-referrers/').catch(() => [])
    setReferrers(data)
  }

  function openReferrerForm(r?: Referrer) {
    setRefEditing(r ?? null)
    setRefForm(r ? { first_name: r.first_name, last_name: r.last_name, phone: r.phone, email: r.email } : EMPTY_REFERRER)
    setRefError(null)
    setRefFormOpen(true)
  }

  async function handleReferrerSave() {
    if (!refForm.first_name.trim()) { setRefError(t('referrerFirstNameRequired')); return }
    setRefSaving(true)
    setRefError(null)
    try {
      if (refEditing) {
        await apiFetch(`/hq/shop-referrers/${refEditing.id}/`, { method: 'PATCH', body: JSON.stringify(refForm) })
      } else {
        await apiFetch('/hq/shop-referrers/', { method: 'POST', body: JSON.stringify(refForm) })
      }
      setRefFormOpen(false)
      await Promise.all([fetchReferrers(), fetchSales()])
    } catch (err) {
      setRefError(errMsg(err, t('errorSomethingWrong')))
    }
    setRefSaving(false)
  }

  // Un referente con vendite non si cancella (le vendite lo puntano): si
  // disattiva e sparisce dal form di vendita, resta nel registro e nei filtri
  async function toggleReferrerActive(r: Referrer) {
    await apiFetch(`/hq/shop-referrers/${r.id}/`, { method: 'PATCH', body: JSON.stringify({ active: !r.active }) }).catch(() => {})
    await fetchReferrers()
  }

  function fillNew() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setColorInput('')
    setStockMatrix({})
    setError(null)
    setShowForm(true)
  }

  function fillEdit(p: Product) {
    setForm({
      name: p.name,
      description: p.description ?? '',
      category: p.category,
      price: String(p.price),
      original_price: p.original_price ? String(p.original_price) : '',
      shipping_cost: p.shipping_cost ? String(p.shipping_cost) : '',
      sizes: p.sizes ?? [],
      colors: p.colors ?? [],
      badges: productBadges(p),
    })
    const matrix: Record<string, string> = {}
    for (const v of p.shop_product_variants ?? []) {
      matrix[variantKey(v.size, v.color)] = String(v.stock)
    }
    setStockMatrix(matrix)
    setEditing(p)
    setColorInput('')
    setError(null)
    setShowForm(true)
  }

  function openNew() {
    fillNew()
    router.push(`${pathname}?edit=new`, { scroll: false })
  }

  function openEdit(p: Product) {
    fillEdit(p)
    router.push(`${pathname}?edit=${p.id}`, { scroll: false })
  }

  function closeForm() {
    router.push(pathname, { scroll: false })
  }

  // URL ↔ form: senza ?edit il form si chiude (freccia/indietro browser);
  // con ?edit (deep-link o refresh) si riapre sul prodotto giusto
  useEffect(() => {
    if (!editParam) { setShowForm(false); setEditing(null); return }
    if (showForm) return
    if (editParam === 'new') { fillNew(); return }
    const p = products.find(x => x.id === editParam)
    if (p) fillEdit(p)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, products])

  function toggleSize(size: string) {
    setForm(f => ({
      ...f,
      sizes: f.sizes.includes(size) ? f.sizes.filter(s => s !== size) : [...f.sizes, size],
    }))
  }

  function addColor() {
    const c = colorInput.trim()
    if (!c || form.colors.some(x => x.toLowerCase() === c.toLowerCase())) { setColorInput(''); return }
    setForm(f => ({ ...f, colors: [...f.colors, c] }))
    setColorInput('')
  }

  function removeColor(c: string) {
    setForm(f => ({ ...f, colors: f.colors.filter(x => x !== c) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      price: Number(form.price),
      original_price: form.original_price ? Number(form.original_price) : null,
      shipping_cost: form.shipping_cost ? Number(form.shipping_cost) : 0,
      sizes: form.sizes,
      colors: form.colors,
      badges: form.badges.filter(b => b.label.trim()),
    }

    // Offerta valida solo se il prezzo pieno supera quello scontato
    if (payload.original_price !== null && payload.original_price <= payload.price) {
      setError(t('errorOriginalPrice'))
      setSubmitting(false)
      return
    }

    try {
      const data = editing
        ? await apiFetch<Product>(`/hq/shop/${editing.id}/`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch<Product>('/hq/shop/', { method: 'POST', body: JSON.stringify(payload) })

      // Lo stock si salva insieme al prodotto: così le righe varianti esistono
      // subito e lato studente "Terminato"/disponibilità sono affidabili
      const savedVariants = await persistStock(data.id)
      setEditing(prev => ({ ...data, shop_product_variants: savedVariants ?? prev?.shop_product_variants ?? [] }))
      if (!editing) router.replace(`${pathname}?edit=${data.id}`, { scroll: false })
      await fetchProducts()
    } catch (err) {
      setError(errMsg(err, t('errorSomethingWrong')))
    }
    setSubmitting(false)
  }

  // Salva le righe di stock per il prodotto (usato dal Salva e dal pulsante dedicato)
  async function persistStock(productId: string): Promise<Variant[] | null> {
    const variants = combos(form.sizes, form.colors).map(c => ({
      size: c.size,
      color: c.color,
      stock: Number(stockMatrix[variantKey(c.size, c.color)] ?? 0) || 0,
    }))
    try {
      const data = await apiFetch<{ variants: Variant[] }>(`/hq/shop/${productId}/variants/`, {
        method: 'PUT',
        body: JSON.stringify({ variants }),
      })
      return data.variants
    } catch (err) {
      setError(errMsg(err, t('errorSomethingWrong')))
      return null
    }
  }

  async function handleSaveStock() {
    if (!editing) return
    setSavingStock(true)
    setError(null)
    const savedVariants = await persistStock(editing.id)
    if (savedVariants) {
      setEditing(p => p ? { ...p, shop_product_variants: savedVariants } : p)
      await fetchProducts()
    }
    setSavingStock(false)
  }

  async function handleImageUpload(file: File) {
    if (!editing) return
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const data = await apiFetch<{ images: string[] }>(`/hq/shop/${editing.id}/images/`, { method: 'POST', body: fd })
      setEditing(p => p ? { ...p, images: data.images } : p)
      setProducts(prev => prev.map(p => p.id === editing.id ? { ...p, images: data.images } : p))
    } catch (err) {
      const code = err instanceof ApiError && typeof err.body === 'object' && err.body ? (err.body as { error?: string }).error : undefined
      setError(code === 'too_large' ? t('errorImageTooLarge') : code === 'max_images' ? t('errorMaxImages') : errMsg(err, t('errorSomethingWrong')))
    }
    setUploading(false)
  }

  async function handleImageDelete(url: string) {
    if (!editing) return
    try {
      const data = await apiFetch<{ images: string[] }>(`/hq/shop/${editing.id}/images/`, {
        method: 'DELETE',
        body: JSON.stringify({ url }),
      })
      setEditing(p => p ? { ...p, images: data.images } : p)
      setProducts(prev => prev.map(p => p.id === editing.id ? { ...p, images: data.images } : p))
    } catch { /* no-op */ }
  }

  async function handleToggle(product: Product) {
    await apiFetch(`/hq/shop/${product.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !product.active }),
    }).catch(() => {})
    fetchProducts()
  }

  // Vetrina online sì/no per il singolo prodotto: il Negozio può essere
  // visibile alle allieve e un prodotto restare "solo in sede"
  async function handleToggleOnline(product: Product) {
    await apiFetch(`/hq/shop/${product.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ online: !product.online }),
    }).catch(() => {})
    fetchProducts()
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return
    await apiFetch(`/hq/shop/${id}/`, { method: 'DELETE' }).catch(() => {})
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  // ── Vendita manuale (carrello) ───────────────────────────────────────────
  // Nuova riga con prodotto preselezionato: variante = prima disponibile
  function makeLine(productId: string): SaleLine {
    const prod = products.find(p => p.id === productId)
    const variants = prod?.shop_product_variants ?? []
    const first = variants.find(v => v.stock > 0) ?? variants[0]
    return { product_id: productId, variant_id: first?.id ?? '', qty: 1 }
  }

  function setLine(idx: number, patch: Partial<SaleLine>) {
    setSaleLines(lines => lines.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  function selectStudent(s: StudentOption) {
    setSaleStudentId(s.id)
    setStudentQuery(s.name)
    setStudentListOpen(false)
  }

  async function openSale(p?: Product) {
    setSaleLines([p ? makeLine(p.id) : { product_id: '', variant_id: '', qty: 1 }])
    setSaleStudentId('')
    setStudentQuery('')
    setStudentListOpen(false)
    setSalePayment('contante')
    setSaleDiscountValue('')
    setSaleDiscountType('eur')
    setSaleReferrerId('')
    setSaleReferrerPct('')
    setSaleError(null)
    setSaleOpen(true)
    if (students === null) {
      const data = await apiFetch<StudentOption[]>('/hq/students/').catch(() => [])
      setStudents(data)
    }
  }

  async function handleSaleSubmit() {
    setSaleSubmitting(true)
    setSaleError(null)
    try {
      await apiFetch('/hq/shop-sales/', {
        method: 'POST',
        body: JSON.stringify({
          student_id: saleStudentId || null,
          payment_method: salePayment,
          discount: saleDiscountEuros,
          referrer_id: saleReferrerId || null,
          referrer_percentage: Number(saleReferrerPct) || 0,
          items: saleLines,
        }),
      })
      setSaleOpen(false)
      await Promise.all([fetchProducts(), fetchSales()])
    } catch (err) {
      setSaleError(errMsg(err, t('errorSomethingWrong')))
    }
    setSaleSubmitting(false)
  }

  const sizeOptions = SIZE_OPTIONS[form.category] ?? []
  const stockCombos = combos(form.sizes, form.colors)
  const soldByKey = new Map((editing?.shop_product_variants ?? []).map(v => [variantKey(v.size, v.color), v.sold]))

  function discountPct(p: Product) {
    if (!p.original_price || Number(p.original_price) <= Number(p.price)) return null
    return Math.round((1 - Number(p.price) / Number(p.original_price)) * 100)
  }

  function variantLabel(size: string | null, color: string | null) {
    const parts = [size, color].filter(Boolean)
    return parts.length ? parts.join(' · ') : t('oneSize')
  }

  const saleSubtotal = saleLines.reduce((sum, l) => {
    const prod = products.find(p => p.id === l.product_id)
    return sum + (prod ? Number(prod.price) * l.qty : 0)
  }, 0)
  // Sconto in € (se in %, calcolato sul subtotale), mai oltre il subtotale
  const saleDiscountEuros = Math.min(
    saleSubtotal,
    Math.max(0, saleDiscountType === 'pct'
      ? saleSubtotal * (Number(saleDiscountValue) || 0) / 100
      : Number(saleDiscountValue) || 0)
  )
  const saleTotal = Math.max(0, saleSubtotal - saleDiscountEuros)
  const saleReferrerCommission = saleReferrerId ? saleTotal * (Number(saleReferrerPct) || 0) / 100 : 0
  const saleValid = saleLines.length > 0 && saleLines.every(l => l.product_id && l.variant_id && l.qty >= 1)
  const filteredStudents = (students ?? []).filter(s => {
    const q = studentQuery.trim().toLowerCase()
    if (!q) return true
    return (s.name ?? '').toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q)
  })

  // Registro filtrato: le somme seguono i filtri attivi. Il filtro prodotto
  // elenca TUTTI i prodotti del negozio, non solo quelli già venduti (Carlo,
  // 30/10/2026); il referente viene dall'anagrafica, le vendite più vecchie
  // dell'anagrafica si riconoscono dal nome
  const salesProductOptions = [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ value: p.id, label: p.name }))
  const salesSchoolOptions = Array.from(new Map(sales.filter(s => s.school_id).map(s => [s.school_id!, s.schools?.name ?? '—'])).entries())
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const salesStudentOptions = Array.from(new Map(sales.filter(s => s.student_id).map(s => [s.student_id!, s.students?.name ?? '—'])).entries())
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const salesReferrerOptions = referrers.map(r => ({ value: r.id, label: r.active ? r.full_name : `${r.full_name} (${t('referrerInactive')})` }))
  const referrerNameById = new Map(referrers.map(r => [r.id, r.full_name]))
  const filteredSales = sales.filter(s => {
    if (salesFilterProduct.length && !salesFilterProduct.includes(s.product_id)) return false
    if (salesFilterSchool.length && !(s.school_id && salesFilterSchool.includes(s.school_id))) return false
    if (salesFilterStudent.length && !(s.student_id && salesFilterStudent.includes(s.student_id))) return false
    if (salesFilterReferrer.length) {
      const byId = s.referrer_contact && salesFilterReferrer.includes(s.referrer_contact)
      const byName = !!s.referrer && salesFilterReferrer.some(id => referrerNameById.get(id) === s.referrer)
      if (!byId && !byName) return false
    }
    const day = s.created_at.slice(0, 10)
    if (salesFrom && day < salesFrom) return false
    if (salesTo && day > salesTo) return false
    return true
  })
  const salesSum = filteredSales.reduce((sum, s) => sum + Number(s.total), 0)
  const shippingSum = filteredSales.reduce((sum, s) => sum + Number(s.shipping ?? 0), 0)
  const commissionSum = filteredSales.reduce((sum, s) => sum + Number(s.commission ?? 0), 0)
  const referrerSum = filteredSales.reduce((sum, s) => sum + Number(s.referrer_commission ?? 0), 0)
  const defaultRange = currentMonthRange()
  const salesFiltersActive = !!(
    salesFilterProduct.length || salesFilterSchool.length || salesFilterStudent.length || salesFilterReferrer.length
    || salesFrom !== defaultRange.from || salesTo !== defaultRange.to
  )
  function resetSalesFilters() {
    setSalesFilterProduct([]); setSalesFilterSchool([]); setSalesFilterStudent([]); setSalesFilterReferrer([])
    setSalesFrom(defaultRange.from); setSalesTo(defaultRange.to)
  }
  const activeReferrers = referrers.filter(r => r.active)

  return (
    <div>
      {/* Tab Prodotti / Vendite + azione aggiungi */}
      <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-xl p-1">
          <button
            onClick={() => setTab('products')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'products' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            {t('tabProducts')}
          </button>
          <button
            onClick={() => setTab('sales')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'sales' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            {t('tabSales')}
          </button>
          <button
            onClick={() => setTab('codes')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'codes' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            {tDiscounts('tab')}
          </button>
          <button
            onClick={() => setTab('referrers')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'referrers' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            {t('tabReferrers')}
          </button>
        </div>

        {/* Mostra/nascondi il Negozio nel pannello studente */}
        <PlatformVisibilityToggle
          endpoint="/hq/student-shop-visibility/"
          onLabel={t('visibleToStudents')}
          offLabel={t('hiddenFromStudents')}
          hint={t('visibilityHint')}
          offTone="amber"
        />

        {tab === 'products' ? (
          <div className="flex items-center gap-3">
            {/* Vista gestionale (tabella) oppure vetrina come la vede l'allieva */}
            <div className="inline-flex bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setProductView('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${productView === 'table' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >
                {t('viewTable')}
              </button>
              <button
                onClick={() => setProductView('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${productView === 'grid' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >
                {t('viewStorefront')}
              </button>
            </div>
            <button
              onClick={openNew}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
            >
              + {t('buttonAdd')}
            </button>
          </div>
        ) : tab === 'sales' ? (
          <button
            onClick={() => openSale()}
            className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition"
          >
            + {t('saleTitle')}
          </button>
        ) : null}
      </div>

      {tab === 'products' && showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900">{editing ? t('formTitleEdit') : t('formTitleNew')}</h3>
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>{t('labelProductName')} *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderProductName')}
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelCategory')}</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, sizes: [] }))}
                className={inputCls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{catLabel(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('labelPrice')} *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderPrice')}
              />
            </div>
            <div>
              <label className={labelCls}>{t('labelOriginalPrice')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.original_price}
                onChange={(e) => setForm((f) => ({ ...f, original_price: e.target.value }))}
                className={inputCls}
                placeholder={t('placeholderOriginalPrice')}
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('originalPriceHint')}</p>
            </div>
            <div>
              <label className={labelCls}>{t('labelShipping')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.shipping_cost}
                onChange={(e) => setForm((f) => ({ ...f, shipping_cost: e.target.value }))}
                className={inputCls}
                placeholder="0.00"
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('shippingHint')}</p>
            </div>

            {sizeOptions.length > 0 && (
              <div className="col-span-2">
                <label className={labelCls}>{t('labelSizes')}</label>
                <div className="flex flex-wrap gap-2">
                  {sizeOptions.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => toggleSize(size)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                        form.sizes.includes(size)
                          ? 'bg-[#6B1F3A] text-white border-[#6B1F3A]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1F3A]/40'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">{t('sizesHint')}</p>
              </div>
            )}

            {/* Colori disponibili */}
            <div className="col-span-2">
              <label className={labelCls}>{t('labelColors')}</label>
              <div className="flex flex-wrap gap-2 items-center">
                {form.colors.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-50 border border-gray-200 text-gray-700">
                    {c}
                    <button type="button" onClick={() => removeColor(c)} className="text-gray-400 hover:text-red-500 leading-none">×</button>
                  </span>
                ))}
                <input
                  value={colorInput}
                  onChange={(e) => setColorInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor() } }}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                  placeholder={t('addColorPlaceholder')}
                />
                <button
                  type="button"
                  onClick={addColor}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  +
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">{t('colorsHint')}</p>
            </div>

            <div className="col-span-2">
              <label className={labelCls}>{t('labelDescription')}</label>
              <RichTextMini
                value={form.description}
                onChange={(html) => setForm((f) => ({ ...f, description: html }))}
                placeholder={t('placeholderDescription')}
                rows={4}
              />
              <p className="text-[11px] text-gray-400 mt-1">{t('descriptionHint')}</p>
            </div>

            {/* Etichette in evidenza: testo libero + colore (NEW, In offerta, …) */}
            <div className="col-span-2">
              <label className={labelCls}>{t('labelBadges')}</label>
              <div className="space-y-2">
                {form.badges.map((badge, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={badge.label}
                      onChange={(e) => setForm(f => ({
                        ...f,
                        badges: f.badges.map((b, j) => j === i ? { ...b, label: e.target.value } : b),
                      }))}
                      placeholder={t('placeholderBadge')}
                      className="w-44 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                    />
                    <ColorPicker
                      value={badge.color}
                      colors={BADGE_COLORS}
                      onChange={(c) => setForm(f => ({
                        ...f,
                        badges: f.badges.map((b, j) => j === i ? { ...b, color: c.toUpperCase() } : b),
                      }))}
                    />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, badges: f.badges.filter((_, j) => j !== i) }))}
                      className="w-8 h-8 rounded-lg border border-gray-200 text-red-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, badges: [...f.badges, { label: '', color: '#3D3D3D' }] }))}
                className="mt-2 text-xs font-medium text-[#6B1F3A] hover:underline"
              >
                + {t('badgeAdd')}
              </button>
              <p className="text-[11px] text-gray-400 mt-1">{t('badgesHint')}</p>
            </div>

            {/* Galleria immagini: disponibile dopo il salvataggio */}
            <div className="col-span-2">
              <label className={labelCls}>{t('labelImages')}</label>
              {editing ? (
                <div className="flex flex-wrap gap-3 items-center">
                  {(editing.images ?? []).map((url) => (
                    <div key={url} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-100" />
                      <button
                        type="button"
                        onClick={() => handleImageDelete(url)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {(editing.images ?? []).length < 6 && (
                    <label className={`w-20 h-20 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-[#6B1F3A]/40 hover:text-[#6B1F3A] transition cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      <span className="text-xl leading-none">+</span>
                      <span className="text-[10px] mt-0.5">{uploading ? t('uploading') : t('uploadImage')}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = '' }}
                      />
                    </label>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">{t('imagesAfterCreate')}</p>
              )}
            </div>

            {/* Stock per variante (taglia × colore) — dopo il salvataggio */}
            <div className="col-span-2">
              <label className={labelCls}>{t('labelStock')}</label>
              {editing ? (
                <>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                          <th className="text-left px-4 py-2 font-medium">{t('stockVariant')}</th>
                          <th className="text-left px-4 py-2 font-medium w-32">{t('columnStock')}</th>
                          <th className="text-left px-4 py-2 font-medium w-24">{t('columnSold')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {stockCombos.map((c) => {
                          const k = variantKey(c.size, c.color)
                          return (
                            <tr key={k}>
                              <td className="px-4 py-2 text-gray-700">{variantLabel(c.size, c.color)}</td>
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  min="0"
                                  value={stockMatrix[k] ?? '0'}
                                  onChange={(e) => setStockMatrix(m => ({ ...m, [k]: e.target.value }))}
                                  className="w-24 px-2 py-1 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                                />
                              </td>
                              <td className="px-4 py-2 text-gray-500">{soldByKey.get(k) ?? 0}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={handleSaveStock}
                      disabled={savingStock}
                      className="px-4 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-700 disabled:opacity-50 transition"
                    >
                      {savingStock ? t('buttonSaving') : t('buttonSaveStock')}
                    </button>
                    <p className="text-[11px] text-gray-400">{t('stockHint')}</p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400">{t('stockAfterCreate')}</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-[#5a1930] transition"
            >
              {submitting ? t('buttonSaving') : editing ? t('buttonSave') : t('buttonAdd')}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              {editing ? t('buttonClose') : t('buttonCancel')}
            </button>
          </div>
        </form>
      )}

      {tab === 'products' && (loading ? (
        <div className="text-sm text-gray-400">{t('loading')}</div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-gray-400 text-sm">{t('emptyState')}</p>
        </div>
      ) : productView === 'grid' ? (
        // Vetrina: stesse card del negozio studente, con le azioni HQ sotto
        <div className="brand-theme" style={brandCssVars(brand)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product) => (
              <div key={product.id} className={product.active ? '' : 'opacity-50'}>
                <ProductCard
                  product={toShopProduct(product)}
                  readOnly
                  onDetail={() => setPreview(product)}
                  footer={
                    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1">
                      <button onClick={() => openSale(product)} className="text-xs text-gray-500 hover:text-gray-900 transition">{t('buttonSell')}</button>
                      <button onClick={() => openEdit(product)} className="text-xs text-gray-500 hover:text-gray-900 transition">{t('buttonEdit')}</button>
                      <button onClick={() => handleToggle(product)} title={product.active ? t('hintDeactivate') : t('hintActivate')} className="text-xs text-gray-400 hover:text-gray-700 transition">
                        {product.active ? t('buttonDeactivate') : t('buttonActivate')}
                      </button>
                      <button onClick={() => handleToggleOnline(product)} title={product.online ? t('hintHideOnline') : t('hintShowOnline')} className={`text-xs transition ${product.online ? 'text-gray-400 hover:text-gray-700' : 'text-amber-700 hover:text-amber-900'}`}>
                        {product.online ? t('buttonHideOnline') : t('buttonShowOnline')}
                      </button>
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnProduct')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnCategory')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnPrice')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnShipping')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnStock')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnSold')}</th>
                <th className="text-left px-6 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnStatus')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {products.map((product) => {
                const pct = discountPct(product)
                const thumb = product.images?.[0]
                const variants = product.shop_product_variants ?? []
                const totalStock = variants.reduce((s, v) => s + v.stock, 0)
                const totalSold = variants.reduce((s, v) => s + v.sold, 0)
                return (
                  <tr key={product.id} className={`hover:bg-gray-50 transition ${!product.active ? 'opacity-50' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {thumb ? (
                          // Formato ritratto: stessa proporzione della vetrina
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="w-10 h-[52px] object-cover rounded-lg border border-gray-100 shrink-0" />
                        ) : (
                          <div className="w-10 h-[52px] rounded-lg bg-gray-50 flex items-center justify-center text-gray-300 text-lg shrink-0">🛍️</div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {[product.sizes?.length ? product.sizes.join(' ') : null, product.colors?.length ? product.colors.join(' · ') : null]
                              .filter(Boolean).join('  —  ') || '—'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[product.category] ?? categoryColors.other}`}>
                        {catLabel(product.category)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <span className="font-medium text-gray-900">{formatMoney(Number(product.price), uiLocale)}</span>
                      {pct !== null && (
                        <>
                          <span className="text-xs text-gray-400 line-through ml-1.5">{formatMoney(Number(product.original_price), uiLocale)}</span>
                          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full ml-1.5">-{pct}%</span>
                        </>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                      {Number(product.shipping_cost) > 0 ? formatMoney(Number(product.shipping_cost), uiLocale) : t('shippingFree')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm font-semibold ${totalStock === 0 ? 'text-red-500' : totalStock <= 5 ? 'text-amber-600' : 'text-gray-900'}`}>
                        {totalStock}
                      </span>
                      {variants.length > 1 && (
                        <span className="text-[10px] text-gray-400 ml-1">({variants.length} var.)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{totalSold}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {product.active ? t('statusActive') : t('statusInactive')}
                      </span>
                      {!product.online && (
                        <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700" title={t('statusOfflineOnlyHint')}>
                          {t('statusOfflineOnly')}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                      <button
                        onClick={() => setPreview(product)}
                        className="text-xs text-gray-500 hover:text-gray-900 transition"
                      >
                        {t('buttonPreview')}
                      </button>
                      <button
                        onClick={() => openSale(product)}
                        className="text-xs font-medium text-white bg-[#6B1F3A] hover:bg-[#5a1930] px-2.5 py-1 rounded-md transition"
                      >
                        {t('buttonSell')}
                      </button>
                      <button
                        onClick={() => openEdit(product)}
                        className="text-xs text-[#6B1F3A] hover:underline transition"
                      >
                        {t('buttonEdit')}
                      </button>
                      <button
                        onClick={() => handleToggle(product)} title={product.active ? t('hintDeactivate') : t('hintActivate')}
                        className="text-xs text-gray-400 hover:text-gray-700 transition"
                      >
                        {product.active ? t('buttonDeactivate') : t('buttonActivate')}
                      </button>
                      <button
                        onClick={() => handleToggleOnline(product)} title={product.online ? t('hintHideOnline') : t('hintShowOnline')}
                        className={`text-xs transition ${product.online ? 'text-gray-400 hover:text-gray-700' : 'text-amber-700 hover:text-amber-900'}`}
                      >
                        {product.online ? t('buttonHideOnline') : t('buttonShowOnline')}
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="text-xs text-red-400 hover:text-red-600 transition"
                      >
                        {t('buttonDelete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Codici sconto del negozio HQ */}
      {tab === 'codes' && (
        <DiscountCodesManager apiBase="/hq/discount-codes" hint={tDiscounts('hqHint')} loadItems={loadShopItems} />
      )}

      {/* Anagrafica referenti */}
      {tab === 'referrers' && (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-500">{t('referrersHint')}</p>
          <button onClick={() => openReferrerForm()} className="px-4 py-2 rounded-lg bg-[#6B1F3A] text-white text-sm font-medium hover:bg-[#5a1a31] transition">
            {t('referrerAdd')}
          </button>
        </div>

        {refFormOpen && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h3 className="font-semibold text-gray-900">{refEditing ? t('referrerEdit') : t('referrerAdd')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('referrerFirstName')}</label>
                <input value={refForm.first_name} onChange={e => setRefForm(f => ({ ...f, first_name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('referrerLastName')}</label>
                <input value={refForm.last_name} onChange={e => setRefForm(f => ({ ...f, last_name: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('referrerPhone')}</label>
                <PhoneInput inputClassName={inputCls} value={refForm.phone} onChange={phone => setRefForm(f => ({ ...f, phone }))} />
              </div>
              <div>
                <label className={labelCls}>{t('referrerEmail')}</label>
                <input type="email" value={refForm.email} onChange={e => setRefForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
            </div>
            {refError && <p className="text-sm text-red-600">{refError}</p>}
            <div className="flex gap-2">
              <button onClick={handleReferrerSave} disabled={refSaving}
                className="px-5 py-2.5 bg-[#6B1F3A] text-white rounded-lg text-sm font-medium hover:bg-[#5a1a31] transition disabled:opacity-50">
                {refSaving ? t('buttonSaving') : t('referrerSave')}
              </button>
              <button onClick={() => setRefFormOpen(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                {t('buttonCancel')}
              </button>
            </div>
          </div>
        )}

        {referrers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">{t('referrersEmpty')}</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('referrerLastName')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('referrerFirstName')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('referrerPhone')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('referrerEmail')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('tabSales')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {referrers.map(r => (
                  <tr key={r.id} className={`hover:bg-gray-50 transition ${r.active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.last_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{r.first_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.phone || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{r.email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 text-right">{r.sales_count}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {!r.active && <span className="text-[10px] uppercase font-semibold text-gray-400">{t('referrerInactive')}</span>}
                        <button onClick={() => openReferrerForm(r)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">{t('referrerEdit')}</button>
                        <button onClick={() => toggleReferrerActive(r)} className={`text-xs px-2.5 py-1 rounded-lg border ${r.active ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'}`}>
                          {r.active ? t('referrerDeactivate') : t('referrerReactivate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Registro vendite (tab dedicato) */}
      {tab === 'sales' && (
      <div>
        {/* Totali in alto, come Scuola > Rapporti > Lezioni: seguono i filtri */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {[
            { label: t('kpiSalesCount'), value: String(filteredSales.length) },
            { label: t('kpiSalesTotal'), value: formatMoney(salesSum, uiLocale) },
            { label: t('kpiSchoolCommission'), value: formatMoney(commissionSum, uiLocale) },
            { label: t('kpiReferrerCommission'), value: formatMoney(referrerSum, uiLocale) },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{kpi.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Filtri registro: etichetta su ognuno, multiselezione, mese corrente di partenza */}
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <p className="text-xs text-gray-500 mb-1">{t('salesFilterFrom')}</p>
              <input type="date" value={salesFrom} onChange={e => setSalesFrom(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">{t('salesFilterTo')}</p>
              <input type="date" value={salesTo} onChange={e => setSalesTo(e.target.value)}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20" />
            </div>
            <MultiSelectFilter label={t('salesFilterReferrers')} options={salesReferrerOptions} selected={salesFilterReferrer} onChange={setSalesFilterReferrer} />
            <MultiSelectFilter label={t('salesFilterProducts')} options={salesProductOptions} selected={salesFilterProduct} onChange={setSalesFilterProduct} />
            <MultiSelectFilter label={t('salesFilterSchools')} options={salesSchoolOptions} selected={salesFilterSchool} onChange={setSalesFilterSchool} />
            <MultiSelectFilter label={t('salesFilterStudents')} options={salesStudentOptions} selected={salesFilterStudent} onChange={setSalesFilterStudent} />
            {salesFiltersActive && (
              <button onClick={resetSalesFilters} className="text-xs text-gray-400 hover:text-gray-600 pb-2">
                {t('salesFilterClear')}
              </button>
            )}
          </div>
        </div>

        {filteredSales.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">{salesFiltersActive ? t('salesEmptyFiltered') : t('salesEmpty')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnDate')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('columnProduct')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('stockVariant')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('saleStudentLabel')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnSchool')}</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnReferrer')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('saleQtyLabel')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnUnitPrice')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnShipping')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnTotal')}</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wide">{t('salesColumnCommission')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSales.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(s.created_at)}
                      {s.source === 'online' && (
                        <span className="ml-1.5 text-[9px] font-semibold uppercase text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">online</span>
                      )}
                      {s.payment_method && (
                        <span className="block text-[10px] text-gray-400 mt-0.5">
                          {PAYMENT_METHODS.includes(s.payment_method) || s.payment_method === 'stripe'
                            ? t(`payment.${s.payment_method}` as Parameters<typeof t>[0])
                            : s.payment_method}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.shop_products?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{variantLabel(s.size, s.color)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{s.students?.name ?? t('saleNoStudent')}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{s.schools?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      {s.referrer ? (
                        <>
                          <span className="text-gray-700">{s.referrer}</span>
                          <span className="block text-[10px] text-amber-600 mt-0.5">
                            {Number(s.referrer_percentage)}% · {formatMoney(Number(s.referrer_commission), uiLocale)}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 text-right">{s.qty}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right whitespace-nowrap">{formatMoney(Number(s.unit_price), uiLocale)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right whitespace-nowrap">
                      {Number(s.shipping) > 0 ? formatMoney(Number(s.shipping), uiLocale) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                      <span className="font-semibold text-gray-900">{formatMoney(Number(s.total), uiLocale)}</span>
                      {Number(s.discount) > 0 && (
                        <span className="block text-[10px] text-red-500 mt-0.5">{t('salesDiscountApplied', { amount: formatMoney(Number(s.discount), uiLocale) })}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                      {Number(s.commission) > 0
                        ? <span className="font-medium text-green-700">{formatMoney(Number(s.commission), uiLocale)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-100 bg-gray-50">
                  <td colSpan={8} className="px-4 py-3 text-sm font-semibold text-gray-700 text-right">{t('salesSum')}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right whitespace-nowrap">{formatMoney(shippingSum, uiLocale)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-[#6B1F3A] text-right whitespace-nowrap">{formatMoney(salesSum, uiLocale)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-green-700 text-right whitespace-nowrap">{formatMoney(commissionSum, uiLocale)}</td>
                </tr>
                {referrerSum > 0 && (
                  <tr className="bg-gray-50">
                    <td colSpan={10} className="px-4 py-2 text-xs font-semibold text-gray-500 text-right">{t('salesReferrerSum')}</td>
                    <td className="px-4 py-2 text-xs font-bold text-amber-600 text-right whitespace-nowrap">{formatMoney(referrerSum, uiLocale)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Modal vendita manuale — carrello come lato studente */}
      {saleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setSaleOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4">
              <h3 className="font-semibold text-gray-900 text-lg">{t('saleTitle')}</h3>
              {saleError && <div className="mt-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{saleError}</div>}

              <div className="mt-4 space-y-4">
                {/* Studente: autocomplete — digita e scegli dai risultati */}
                <div>
                  <label className={labelCls}>{t('saleStudentLabel')}</label>
                  <div className="relative">
                    <input
                      value={studentQuery}
                      onChange={(e) => {
                        setStudentQuery(e.target.value)
                        setSaleStudentId('')
                        setStudentListOpen(true)
                      }}
                      onFocus={() => setStudentListOpen(true)}
                      onBlur={() => setTimeout(() => setStudentListOpen(false), 150)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (filteredStudents[0]) selectStudent(filteredStudents[0])
                        }
                        if (e.key === 'Escape') setStudentListOpen(false)
                      }}
                      placeholder={t('saleStudentSearch')}
                      className={`${inputCls} ${saleStudentId ? 'border-green-300 bg-green-50/40' : ''}`}
                    />
                    {(saleStudentId || studentQuery) && (
                      <button
                        type="button"
                        onClick={() => { setSaleStudentId(''); setStudentQuery(''); setStudentListOpen(false) }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-lg leading-none"
                      >
                        ×
                      </button>
                    )}
                    {studentListOpen && !saleStudentId && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {students === null ? (
                          <p className="px-3 py-2 text-xs text-gray-400">{t('loading')}</p>
                        ) : filteredStudents.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-gray-400">{t('saleNoResults')}</p>
                        ) : (
                          filteredStudents.slice(0, 8).map(s => (
                            <button
                              type="button"
                              key={s.id}
                              onMouseDown={(e) => { e.preventDefault(); selectStudent(s) }}
                              className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-[#6B1F3A]/5 transition"
                            >
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">
                                  {s.name}
                                  {s.email && <span className="text-xs text-gray-400 ml-1.5">{s.email}</span>}
                                </span>
                                {/* Scuola di appartenenza: da qui matura la commissione */}
                                {s.schools?.name ? (
                                  <span className="text-[10px] font-medium text-[#6B1F3A] bg-[#6B1F3A]/5 px-1.5 py-0.5 rounded-full shrink-0">
                                    🏫 {s.schools.name}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-gray-300 shrink-0">{t('saleNoSchool')}</span>
                                )}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {!saleStudentId ? (
                    <p className="text-[11px] text-gray-400 mt-1">{t('saleNoStudentHint')}</p>
                  ) : (() => {
                    const sel = (students ?? []).find(x => x.id === saleStudentId)
                    return sel?.schools?.name
                      ? <p className="text-[11px] text-[#6B1F3A] mt-1">🏫 {sel.schools.name}</p>
                      : <p className="text-[11px] text-gray-400 mt-1">{t('saleNoSchool')}</p>
                  })()}
                </div>

                {/* Prodotti (una o più righe con variante e quantità) */}
                <div>
                  <label className={labelCls}>{t('saleProductsLabel')}</label>
                  <div className="space-y-2">
                    {saleLines.map((line, idx) => {
                      const prod = products.find(p => p.id === line.product_id)
                      const variants = prod?.shop_product_variants ?? []
                      const lineTotal = prod ? Number(prod.price) * line.qty : 0
                      return (
                        // Prodotto a tutta larghezza sulla prima riga, così nome e
                        // prezzo si leggono; variante, quantità e totale sotto
                        // (Carlo, 30/10/2026)
                        <div key={idx} className="space-y-2 bg-gray-50 rounded-lg p-2">
                          <select
                            value={line.product_id}
                            onChange={(e) => setLine(idx, makeLine(e.target.value))}
                            className="w-full px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                          >
                            <option value="">{t('saleChooseProduct')}</option>
                            {products.filter(p => p.active).map(p => (
                              <option key={p.id} value={p.id}>{p.name} — {formatMoney(Number(p.price), uiLocale)}</option>
                            ))}
                          </select>
                          <div className="flex flex-wrap items-center gap-2">
                          {variants.length > 0 && (
                            <select
                              value={line.variant_id}
                              onChange={(e) => setLine(idx, { variant_id: e.target.value })}
                              className="flex-1 min-w-40 px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                            >
                              {variants.map(v => (
                                <option key={v.id} value={v.id}>
                                  {variantLabel(v.size, v.color)} — {t('saleAvailable', { count: v.stock })}
                                </option>
                              ))}
                            </select>
                          )}
                          <input
                            type="number"
                            min="1"
                            value={line.qty}
                            onChange={(e) => setLine(idx, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                            className="w-16 px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                          />
                          <span className="text-sm font-medium text-gray-700 min-w-20 text-right whitespace-nowrap ml-auto">{formatMoney(lineTotal, uiLocale)}</span>
                          <button
                            type="button"
                            onClick={() => setSaleLines(ls => ls.filter((_, i) => i !== idx))}
                            className="text-gray-300 hover:text-red-500 px-1 text-lg leading-none"
                          >
                            ×
                          </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSaleLines(ls => [...ls, { product_id: '', variant_id: '', qty: 1 }])}
                    className="mt-2 text-xs text-[#6B1F3A] font-medium hover:underline"
                  >
                    + {t('saleAddProduct')}
                  </button>
                </div>

                {/* Metodo di pagamento + sconto manuale */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('salePaymentLabel')}</label>
                    <select
                      value={salePayment}
                      onChange={(e) => setSalePayment(e.target.value)}
                      className={inputCls}
                    >
                      {PAYMENT_METHODS.map(m => (
                        <option key={m} value={m}>{t(`payment.${m}` as Parameters<typeof t>[0])}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{t('saleDiscountLabel')}</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={saleDiscountValue}
                        onChange={(e) => setSaleDiscountValue(e.target.value)}
                        className={`${inputCls} flex-1`}
                        placeholder="0"
                      />
                      <select
                        value={saleDiscountType}
                        onChange={(e) => setSaleDiscountType(e.target.value as 'eur' | 'pct')}
                        className="px-2 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      >
                        <option value="eur">€</option>
                        <option value="pct">%</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Referente / segnalatore con sua percentuale */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t('saleReferrerLabel')}</label>
                    <select
                      value={saleReferrerId}
                      onChange={(e) => { setSaleReferrerId(e.target.value); if (!e.target.value) setSaleReferrerPct('') }}
                      className={inputCls}
                    >
                      <option value="">{t('saleReferrerNone')}</option>
                      {activeReferrers.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                    </select>
                    {activeReferrers.length === 0 && (
                      <p className="text-[11px] text-gray-400 mt-1">{t('saleReferrerNoneYet')}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>{t('saleReferrerPctLabel')}</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={saleReferrerPct}
                      onChange={(e) => setSaleReferrerPct(e.target.value)}
                      className={inputCls}
                      placeholder="0"
                      disabled={!saleReferrerId}
                    />
                  </div>
                </div>

                {/* Riepilogo somme */}
                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">{t('saleSubtotalLabel')}</span>
                    <span className="font-medium text-gray-900">{formatMoney(saleSubtotal, uiLocale)}</span>
                  </div>
                  {saleDiscountEuros > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{t('saleDiscountSummary')}</span>
                      <span className="font-medium text-red-600">−{formatMoney(saleDiscountEuros, uiLocale)}</span>
                    </div>
                  )}
                  {saleReferrerCommission > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{t('saleReferrerCommission')}</span>
                      <span className="font-medium text-amber-600">{formatMoney(saleReferrerCommission, uiLocale)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                    <span className="text-sm font-semibold text-gray-700">{t('saleTotalLabel')}</span>
                    <span className="font-bold text-[#6B1F3A]">{formatMoney(saleTotal, uiLocale)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={handleSaleSubmit}
                disabled={saleSubmitting || !saleValid}
                className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
              >
                {saleSubmitting ? t('buttonSaving') : t('saleSubmit')}
              </button>
              <button
                onClick={() => setSaleOpen(false)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                {t('buttonCancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anteprima scheda prodotto: identica a quella dell'allieva, in sola lettura */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto p-4" onClick={() => setPreview(null)}>
          <div
            className="brand-theme bg-brand-bg rounded-2xl max-w-5xl mx-auto my-4 overflow-hidden"
            style={brandCssVars(brand)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
              <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{t('previewTitle')}</p>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-6">
              <ProductDetailView product={toShopProduct(preview)} readOnly />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HQShopPage() {
  return <Suspense><HQShopInner /></Suspense>
}
