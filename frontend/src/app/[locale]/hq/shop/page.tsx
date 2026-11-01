'use client'

import { useCallback, useEffect, useRef, useState, Suspense, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import ProductCard from '@/components/shop/ProductCard'
import DiscountCodesManager from '@/components/DiscountCodesManager'
import ProductDetailView from '@/components/shop/ProductDetailView'
import ColorPicker from '@/components/ui/ColorPicker'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import RichTextMini from '@/components/ui/RichTextMini'
import { BRAND_DEFAULTS, brandCssVars, type BrandSettings } from '@/lib/brand'
import { productBadges, SHOP_CATEGORIES, type ShopBadge, type ShopProduct } from '@/lib/shop'
import { apiFetch, ApiError } from '@/lib/api/client'
import PlatformVisibilityToggle from '@/components/hq/PlatformVisibilityToggle'
import { formatMoney, formatNumber } from '@/lib/format-money'
import { formatDate, monthRangeIso, toISODate } from '@/lib/format-date'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import PhoneInput from '@/components/ui/PhoneInput'
import Tooltip from '@/components/ui/Tooltip'
import ColumnPicker from '@/components/ui/ColumnPicker'
import { ResizableTable, ResizableTh } from '@/components/ui/ResizableTable'
import QuickMonthPicker from '@/components/ui/QuickMonthPicker'
import ExportButtons from '@/components/ui/ExportButtons'
import { useResizableColumns, useStoredHiddenColumns } from '@/lib/use-table-columns'
import { exportCSV } from '@/lib/export-csv'
import { exportTablePDF } from '@/lib/export'

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
  // Il giorno della vendita come lo dichiara HQ (Carlo, 2026-11-01): è la
  // data del registro, dei filtri e dei rapporti; created_at è solo il
  // momento in cui la riga è stata scritta
  sold_at: string
  commission_waived: boolean  // HQ ha tolto la commissione scuola su questa riga
  // DRF `fields="__all__"`: le FK escono col nome del campo, non `_id`
  product: string
  variant: string | null
  student: string | null
  school: string | null
  shop_products: { name: string } | null
  students: { name: string } | null
  schools: { name: string } | null
}

type StudentOption = { id: string; name: string; email: string | null; schools: { name: string } | null }

// Riga della vendita manuale (carrello come lato studente)
// unit_price: il prezzo di listino, precompilato e modificabile sulla singola
// vendita (Carlo, 30/10/2026: il listino resta obbligatorio sul prodotto,
// così niente finisce online senza prezzo)
type SaleLine = { product_id: string; variant_id: string; qty: number; unit_price: string }

// La riga del registro in modifica (Carlo, 2026-11-01): i campi della
// vendita manuale, una riga sola. Lo sconto è quello già ripartito sulla riga.
type EditSaleForm = {
  sold_at: string
  student_id: string
  payment_method: string
  product_id: string
  variant_id: string
  qty: number
  unit_price: string
  discount: string
  referrer_id: string
  referrer_percentage: string
  school_commission: boolean  // false = la scuola non matura la sua parte
  notes: string
}
const EMPTY_EDIT_SALE: EditSaleForm = {
  sold_at: '', student_id: '', payment_method: 'contante', product_id: '', variant_id: '', qty: 1,
  unit_price: '', discount: '', referrer_id: '', referrer_percentage: '', school_commission: true, notes: '',
}

// Una sola lista di categorie (lib/shop.ts): la copia locale aveva perso le
// voci aggiunte dopo
const CATEGORIES: readonly string[] = SHOP_CATEGORIES

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

// Registro vendite: una colonna come si vede, come si somma e come si esporta
// (le stesse scelte di Scuola › Rapporti › Lezioni, Carlo 2026-10-31). Le
// colonne nascoste e le larghezze trascinate restano in questo browser; i
// filtri partono dal mese corrente.
type ExportFmt = 'csv' | 'pdf'
type SaleColumn = {
  key: string
  label: string
  right?: boolean
  locked?: boolean           // sempre visibile (la data, identità della riga)
  cellClass?: string
  cell: (s: Sale) => ReactNode
  total?: ReactNode          // la cella nella riga dei totali; undefined = vuota
  totalClass?: string
  exportHeaders: string[]    // una colonna a schermo può uscire in più colonne
  exportValues: (s: Sale, fmt: ExportFmt) => (string | number)[]
  exportTotals: (fmt: ExportFmt) => (string | number)[]
}
const SALES_COLS_STORAGE = 'hq-shop:sales-columns'
const SALES_WIDTHS_STORAGE = 'hq-shop:sales-col-widths'

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
  const tt = useTranslations('tableTools')
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
  // Feedback dopo un salvataggio (Carlo, 2026-11-01: "sempre feedback visivo")
  const [saved, setSaved] = useState<'created' | 'saved' | 'stock' | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Il form prodotto sta in alto: aprendolo da una riga in basso si scorre
  // fino a lui e lo si evidenzia per un attimo, altrimenti non si vede
  const formRef = useRef<HTMLFormElement | null>(null)
  const [formFlash, setFormFlash] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)


  // Vendita manuale — carrello: studente cercabile, più prodotti, pagamento
  const [saleOpen, setSaleOpen] = useState(false)
  const [saleLines, setSaleLines] = useState<SaleLine[]>([])
  const [saleStudentId, setSaleStudentId] = useState('')
  // Il giorno della vendita: oggi, salvo HQ non scriva quello vero
  const [saleDate, setSaleDate] = useState(() => toISODate(new Date()))
  // Commissione scuola: matura di default, HQ può toglierla (Carlo, 2026-11-01)
  const [saleSchoolCommission, setSaleSchoolCommission] = useState(true)
  const [salePayment, setSalePayment] = useState('contante')
  // Sconto manuale aggiuntivo (€ o %) e referente/segnalatore con sua %
  const [saleDiscountValue, setSaleDiscountValue] = useState('')
  const [saleDiscountType, setSaleDiscountType] = useState<'eur' | 'pct'>('eur')
  const [saleReferrerId, setSaleReferrerId] = useState('')
  const [saleReferrerPct, setSaleReferrerPct] = useState('')
  const [saleSubmitting, setSaleSubmitting] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)
  const [students, setStudents] = useState<StudentOption[] | null>(null)
  // Modifica di una riga del registro (Carlo, 2026-11-01: "posso essermi
  // confuso su qualche dato"): solo le vendite in sede, quelle online sono
  // il record di Stripe
  const [editSale, setEditSale] = useState<Sale | null>(null)
  const [editForm, setEditForm] = useState<EditSaleForm>(EMPTY_EDIT_SALE)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Filtri registro vendite: multiselezione con etichetta, date dal mese
  // corrente (come report scuola e compensi insegnante)
  const [salesFilterProduct, setSalesFilterProduct] = useState<string[]>([])
  const [salesFilterSchool, setSalesFilterSchool] = useState<string[]>([])
  const [salesFilterStudent, setSalesFilterStudent] = useState<string[]>([])
  const [salesFilterReferrer, setSalesFilterReferrer] = useState<string[]>([])
  // il mese corrente, calcolato una volta: le date partono da lì e "Azzera filtri" ci torna
  const [defaultRange] = useState(() => monthRangeIso(0))
  const [salesFrom, setSalesFrom] = useState(defaultRange.from)
  const [salesTo, setSalesTo] = useState(defaultRange.to)
  // Registro vendite: colonne nascoste e larghezze trascinate, ricordate in
  // questo browser
  const [hiddenSaleCols, setHiddenSaleCols] = useStoredHiddenColumns(SALES_COLS_STORAGE)
  const saleCols = useResizableColumns(SALES_WIDTHS_STORAGE)

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
      await fetchReferrers()  // le vendite portano il nome di allora: non cambiano
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
    revealForm()
  }

  function openEdit(p: Product) {
    fillEdit(p)
    router.push(`${pathname}?edit=${p.id}`, { scroll: false })
    revealForm()
  }

  function revealForm() {
    setSaved(null)
    // al prossimo frame il form è montato
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFormFlash(true)
      setTimeout(() => setFormFlash(false), 1600)
    })
  }

  function flashSaved(kind: 'created' | 'saved' | 'stock') {
    setSaved(kind)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(null), 4000)
  }
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

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
      flashSaved(editing ? 'saved' : 'created')
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
      flashSaved('stock')
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

  // Due clic, come ovunque nella piattaforma (niente dialog nativo)
  async function handleDelete(id: string) {
    await apiFetch(`/hq/shop/${id}/`, { method: 'DELETE' }).catch(() => {})
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  // ── Vendita manuale (carrello) ───────────────────────────────────────────
  // Nuova riga con prodotto preselezionato: variante = prima disponibile
  function makeLine(productId: string): SaleLine {
    const prod = products.find(p => p.id === productId)
    const variants = prod?.shop_product_variants ?? []
    const first = variants.find(v => v.stock > 0) ?? variants[0]
    return { product_id: productId, variant_id: first?.id ?? '', qty: 1, unit_price: prod ? String(Number(prod.price)) : '' }
  }

  function setLine(idx: number, patch: Partial<SaleLine>) {
    setSaleLines(lines => lines.map((l, i) => i === idx ? { ...l, ...patch } : l))
  }

  async function openSale(p?: Product) {
    setSaleLines([p ? makeLine(p.id) : { product_id: '', variant_id: '', qty: 1, unit_price: '' }])
    setSaleStudentId('')
    setSaleDate(toISODate(new Date()))
    setSaleSchoolCommission(true)
    setSalePayment('contante')
    setSaleDiscountValue('')
    setSaleDiscountType('eur')
    setSaleReferrerId('')
    setSaleReferrerPct('')
    setSaleError(null)
    setSaleOpen(true)
    await loadStudents()
  }

  async function loadStudents() {
    if (students !== null) return
    const data = await apiFetch<StudentOption[]>('/hq/students/').catch(() => [])
    setStudents(data)
  }

  // I codici del backend hanno un testo tradotto, il resto il messaggio generico
  function saleErrorText(err: unknown): string {
    const code = err instanceof ApiError && typeof err.body === 'object' && err.body ? (err.body as { error?: string }).error : undefined
    const known: Record<string, string> = {
      invalid_unit_price: 'saleErrorUnitPrice', referrer_not_found: 'saleErrorReferrer', invalid_item: 'saleErrorItem',
      product_not_found: 'saleErrorProduct', variant_not_found: 'saleErrorProduct', invalid_sold_at: 'saleErrorDate',
      student_not_found: 'saleErrorStudent', online_sale_locked: 'saleEditLocked', sale_not_found: 'saleErrorProduct',
    }
    return code && known[code] ? t(known[code] as Parameters<typeof t>[0]) : errMsg(err, t('errorSomethingWrong'))
  }

  // ── Modifica di una riga ─────────────────────────────────────────────────
  async function openEditSale(s: Sale) {
    setEditSale(s)
    setEditForm({
      sold_at: s.sold_at, student_id: s.student ?? '', payment_method: s.payment_method ?? 'contante',
      product_id: s.product, variant_id: s.variant ?? '', qty: s.qty, unit_price: String(Number(s.unit_price)),
      discount: Number(s.discount) > 0 ? String(Number(s.discount)) : '',
      referrer_id: s.referrer_contact ?? '', referrer_percentage: s.referrer_contact ? String(Number(s.referrer_percentage)) : '',
      school_commission: !s.commission_waived,
      notes: s.notes ?? '',
    })
    setEditError(null)
    await loadStudents()
  }

  function patchEdit(patch: Partial<EditSaleForm>) {
    setEditForm(f => ({ ...f, ...patch }))
  }

  // Cambio prodotto: prima variante disponibile e prezzo di listino
  function editChangeProduct(productId: string) {
    const prod = products.find(p => p.id === productId)
    const variants = prod?.shop_product_variants ?? []
    const first = variants.find(v => v.stock > 0) ?? variants[0]
    patchEdit({ product_id: productId, variant_id: first?.id ?? '', unit_price: prod ? String(Number(prod.price)) : '' })
  }

  async function handleEditSubmit() {
    if (!editSale) return
    setEditSubmitting(true)
    setEditError(null)
    try {
      await apiFetch(`/hq/shop-sales/${editSale.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          sold_at: editForm.sold_at,
          student_id: editForm.student_id || null,
          payment_method: editForm.payment_method,
          product_id: editForm.product_id,
          variant_id: editForm.variant_id,
          qty: editForm.qty,
          unit_price: Number(editForm.unit_price),
          discount: Number(editForm.discount) || 0,
          referrer_id: editForm.referrer_id || null,
          referrer_percentage: Number(editForm.referrer_percentage) || 0,
          school_commission: editForm.school_commission,
          notes: editForm.notes,
        }),
      })
      setEditSale(null)
      await Promise.all([fetchProducts(), fetchSales()])
    } catch (err) {
      setEditError(saleErrorText(err))
    }
    setEditSubmitting(false)
  }

  // Eliminazione della riga (due clic, come ovunque): i pezzi tornano a stock
  async function handleDeleteSale() {
    if (!editSale) return
    setEditError(null)
    try {
      await apiFetch(`/hq/shop-sales/${editSale.id}/`, { method: 'DELETE' })
      setEditSale(null)
      await Promise.all([fetchProducts(), fetchSales()])
    } catch (err) {
      setEditError(saleErrorText(err))
    }
  }

  async function handleSaleSubmit() {
    setSaleSubmitting(true)
    setSaleError(null)
    try {
      await apiFetch('/hq/shop-sales/', {
        method: 'POST',
        body: JSON.stringify({
          sold_at: saleDate,
          student_id: saleStudentId || null,
          school_commission: saleSchoolCommission,
          payment_method: salePayment,
          discount: saleDiscountEuros,
          referrer_id: saleReferrerId || null,
          referrer_percentage: Number(saleReferrerPct) || 0,
          items: saleLines.map(l => ({
            product_id: l.product_id, variant_id: l.variant_id, qty: l.qty, unit_price: Number(l.unit_price),
          })),
        }),
      })
      setSaleOpen(false)
      await Promise.all([fetchProducts(), fetchSales()])
    } catch (err) {
      setSaleError(saleErrorText(err))
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

  // Prezzo di riga: quello digitato (parte dal listino)
  const lineUnitPrice = (l: SaleLine) => (l.product_id ? Number(l.unit_price) || 0 : 0)
  const saleSubtotal = saleLines.reduce((sum, l) => sum + lineUnitPrice(l) * l.qty, 0)
  // Sconto in € (se in %, calcolato sul subtotale), mai oltre il subtotale
  const saleDiscountEuros = Math.min(
    saleSubtotal,
    Math.max(0, saleDiscountType === 'pct'
      ? saleSubtotal * (Number(saleDiscountValue) || 0) / 100
      : Number(saleDiscountValue) || 0)
  )
  const saleTotal = Math.max(0, saleSubtotal - saleDiscountEuros)
  const saleReferrerCommission = saleReferrerId ? saleTotal * (Number(saleReferrerPct) || 0) / 100 : 0
  const saleValid = saleLines.length > 0 && saleLines.every(l =>
    l.product_id && l.variant_id && l.qty >= 1 && lineUnitPrice(l) > 0
  )

  // Registro filtrato: le somme seguono i filtri attivi. Il filtro prodotto
  // elenca TUTTI i prodotti del negozio, non solo quelli già venduti (Carlo,
  // 30/10/2026); il referente viene dall'anagrafica, le vendite più vecchie
  // dell'anagrafica si riconoscono dal nome
  const salesProductOptions = [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ value: p.id, label: p.name }))
  const salesSchoolOptions = Array.from(new Map(sales.filter(s => s.school).map(s => [s.school!, s.schools?.name ?? '—'])).entries())
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const salesStudentOptions = Array.from(new Map(sales.filter(s => s.student).map(s => [s.student!, s.students?.name ?? '—'])).entries())
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  const salesReferrerOptions = referrers.map(r => ({ value: r.id, label: r.active ? r.full_name : `${r.full_name} (${t('referrerInactive')})` }))
  const referrerNameById = new Map(referrers.map(r => [r.id, r.full_name]))
  const filteredSales = sales.filter(s => {
    if (salesFilterProduct.length && !salesFilterProduct.includes(s.product)) return false
    if (salesFilterSchool.length && !(s.school && salesFilterSchool.includes(s.school))) return false
    if (salesFilterStudent.length && !(s.student && salesFilterStudent.includes(s.student))) return false
    if (salesFilterReferrer.length) {
      const byId = s.referrer_contact && salesFilterReferrer.includes(s.referrer_contact)
      // il nome vale solo per le vendite più vecchie dell'anagrafica, mai per
      // una già collegata a un altro referente con lo stesso nome
      const byName = !s.referrer_contact && !!s.referrer && salesFilterReferrer.some(id => referrerNameById.get(id) === s.referrer)
      if (!byId && !byName) return false
    }
    const day = s.sold_at
    if (salesFrom && day < salesFrom) return false
    if (salesTo && day > salesTo) return false
    return true
  })
  const salesSum = filteredSales.reduce((sum, s) => sum + Number(s.total), 0)
  const shippingSum = filteredSales.reduce((sum, s) => sum + Number(s.shipping ?? 0), 0)
  const commissionSum = filteredSales.reduce((sum, s) => sum + Number(s.commission ?? 0), 0)
  const referrerSum = filteredSales.reduce((sum, s) => sum + Number(s.referrer_commission ?? 0), 0)
  const salesFiltersActive = !!(
    salesFilterProduct.length || salesFilterSchool.length || salesFilterStudent.length || salesFilterReferrer.length
    || salesFrom !== defaultRange.from || salesTo !== defaultRange.to
  )
  function resetSalesFilters() {
    setSalesFilterProduct([]); setSalesFilterSchool([]); setSalesFilterStudent([]); setSalesFilterReferrer([])
    setSalesFrom(defaultRange.from); setSalesTo(defaultRange.to)
  }
  const qtySum = filteredSales.reduce((sum, s) => sum + s.qty, 0)
  const discountSum = filteredSales.reduce((sum, s) => sum + Number(s.discount), 0)

  // Le colonne del registro. CSV: numeri nudi a due decimali per il foglio di
  // calcolo; PDF: lo stesso testo dello schermo, la valuta nell'intestazione.
  const money = (v: string | number) => formatMoney(Number(v), uiLocale)
  const moneyOut = (v: string | number, fmt: ExportFmt): string =>
    fmt === 'csv' ? Number(v).toFixed(2) : formatNumber(Number(v), uiLocale, { decimals: 2 })
  const paymentLabel = (s: Sale) => !s.payment_method ? ''
    : PAYMENT_METHODS.includes(s.payment_method) || s.payment_method === 'stripe'
      ? t(`payment.${s.payment_method}` as Parameters<typeof t>[0])
      : s.payment_method
  const sourceLabel = (s: Sale) => s.source === 'online' ? t('salesSourceOnline') : t('salesSourceManual')
  const textCol = (key: string, label: string, value: (s: Sale) => string, cellClass: string, locked = false): SaleColumn => ({
    key, label, locked, cellClass, cell: s => value(s),
    exportHeaders: [label], exportValues: s => [value(s)], exportTotals: () => [''],
  })
  // zeroAsDash: niente da mostrare quando è zero (spedizione, sconto, commissione)
  const moneyCol = (
    key: string, label: string, value: (s: Sale) => number, total: number | null,
    cellClass: string, totalClass?: string, zeroAsDash = false,
  ): SaleColumn => ({
    key, label, right: true, cellClass, totalClass,
    cell: s => { const v = value(s); return zeroAsDash && v <= 0 ? <span className="text-gray-300">—</span> : money(v) },
    total: total === null ? undefined : money(total),
    exportHeaders: [`${label} (€)`], exportValues: (s, f) => [moneyOut(value(s), f)], exportTotals: f => [total === null ? '' : moneyOut(total, f)],
  })
  const saleColumns: SaleColumn[] = [
    {
      ...textCol('date', t('salesColumnDate'), s => formatDate(s.sold_at), 'text-xs text-gray-500 whitespace-nowrap', true),
      total: t('salesSum'), totalClass: 'text-gray-700', exportTotals: () => [t('salesSum')],
    },
    {
      key: 'payment', label: t('salesColumnPayment'), cellClass: 'text-xs text-gray-500 whitespace-nowrap',
      cell: s => (
        <>
          {paymentLabel(s) || <span className="text-gray-300">—</span>}
          {s.source === 'online' && (
            <span className="ml-1.5 text-[9px] font-semibold uppercase text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded-full">{t('salesSourceOnline')}</span>
          )}
        </>
      ),
      exportHeaders: [t('salesColumnPayment'), t('salesColumnSource')],
      exportValues: s => [paymentLabel(s), sourceLabel(s)], exportTotals: () => ['', ''],
    },
    textCol('product', t('columnProduct'), s => s.shop_products?.name ?? '—', 'text-sm font-medium text-gray-900'),
    textCol('variant', t('stockVariant'), s => variantLabel(s.size, s.color), 'text-xs text-gray-500 whitespace-nowrap'),
    textCol('student', t('salesColumnStudent'), s => s.students?.name ?? t('saleNoStudent'), 'text-sm text-gray-700'),
    textCol('school', t('salesColumnSchool'), s => s.schools?.name ?? '—', 'text-sm text-gray-700'),
    {
      key: 'referrer', label: t('salesColumnReferrer'), cellClass: 'text-sm',
      cell: s => s.referrer ? (
        <>
          <span className="text-gray-700">{s.referrer}</span>
          <span className="block text-[10px] text-amber-600 mt-0.5">{Number(s.referrer_percentage)}% · {money(s.referrer_commission)}</span>
        </>
      ) : <span className="text-gray-300">—</span>,
      total: referrerSum > 0 ? money(referrerSum) : undefined, totalClass: 'text-amber-600',
      exportHeaders: [t('salesColumnReferrer'), t('salesColumnReferrerPct'), `${t('salesColumnReferrerCommission')} (€)`],
      exportValues: (s, f) => [s.referrer ?? '', s.referrer ? Number(s.referrer_percentage) : '', s.referrer ? moneyOut(s.referrer_commission, f) : ''],
      exportTotals: f => ['', '', moneyOut(referrerSum, f)],
    },
    {
      key: 'qty', label: t('saleQtyLabel'), right: true, cellClass: 'text-sm text-gray-700', cell: s => s.qty, total: qtySum,
      exportHeaders: [t('saleQtyLabel')], exportValues: s => [s.qty], exportTotals: () => [qtySum],
    },
    moneyCol('unit_price', t('salesColumnUnitPrice'), s => Number(s.unit_price), null, 'text-sm text-gray-500 whitespace-nowrap'),
    moneyCol('shipping', t('salesColumnShipping'), s => Number(s.shipping), shippingSum, 'text-sm text-gray-500 whitespace-nowrap', 'text-gray-500', true),
    moneyCol('discount', t('salesColumnDiscount'), s => Number(s.discount), discountSum, 'text-sm text-red-500 whitespace-nowrap', 'text-red-500', true),
    moneyCol('total', t('salesColumnTotal'), s => Number(s.total), salesSum, 'text-sm font-semibold text-gray-900 whitespace-nowrap', 'text-[#6B1F3A] font-bold'),
    moneyCol('commission', t('salesColumnCommission'), s => Number(s.commission), commissionSum, 'text-sm font-medium text-green-700 whitespace-nowrap', 'text-green-700 font-bold', true),
    {
      // Matita: corregge una vendita in sede. Non è un dato: fuori dal
      // selettore colonne e dalle esportazioni
      key: 'actions', label: '', locked: true, right: true, cellClass: 'text-xs whitespace-nowrap',
      cell: s => s.source === 'online' ? null : (
        <button type="button" onClick={() => openEditSale(s)} className="text-gray-400 hover:text-[#6B1F3A] font-medium transition">
          {t('buttonEdit')}
        </button>
      ),
      exportHeaders: [], exportValues: () => [], exportTotals: () => [],
    },
  ]
  const visibleSaleColumns = saleColumns.filter(c => c.locked || !hiddenSaleCols.includes(c.key))

  // Le colonne visibili come escono, la riga dei totali per ultima
  const exportSalesRows = (fmt: ExportFmt) => ({
    headers: visibleSaleColumns.flatMap(c => c.exportHeaders),
    rows: filteredSales.map(s => visibleSaleColumns.flatMap(c => c.exportValues(s, fmt))),
    totals: visibleSaleColumns.flatMap(c => c.exportTotals(fmt)),
    right: visibleSaleColumns.flatMap(c => c.exportHeaders.map(() => !!c.right)),
  })
  const exportSalesCSV = () => {
    const { headers, rows, totals } = exportSalesRows('csv')
    exportCSV('hq-shop-sales', headers, [...rows, totals])
  }
  const exportSalesPDF = async () => {
    const caption = [
      salesFrom && `${t('salesFilterFrom')}: ${formatDate(salesFrom)}`,
      salesTo && `${t('salesFilterTo')}: ${formatDate(salesTo)}`,
      t('salesCountLabel', { count: filteredSales.length }),
    ].filter(Boolean).join(' · ')
    await exportTablePDF(
      exportSalesRows('pdf'), `hq-shop-sales-${toISODate(new Date())}`, t('salesTitle'),
      tt('exportedOn', { date: formatDate(new Date()) }), { caption },
    )
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
              + {t('buttonNewProduct')}
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
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className={`bg-white rounded-xl border p-6 mb-6 space-y-4 scroll-mt-4 transition-shadow duration-700 ${
            formFlash ? 'border-[#6B1F3A]/40 shadow-[0_0_0_4px_rgba(107,31,58,0.15)]' : 'border-gray-100'
          }`}
        >
          <h3 className="font-semibold text-gray-900">
            {editing ? t('formTitleEditNamed', { name: editing.name }) : t('formTitleNew')}
          </h3>
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
                    {saved === 'stock'
                      ? <p className="text-xs font-medium text-green-700">{t('feedbackStockSaved')}</p>
                      : <p className="text-[11px] text-gray-400">{t('stockHint')}</p>}
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
              {submitting ? t('buttonSaving') : editing ? t('buttonSaveChanges') : t('buttonCreateProduct')}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              {editing ? t('buttonClose') : t('buttonCancel')}
            </button>
            {(saved === 'saved' || saved === 'created') && (
              <p className="self-center text-sm font-medium text-green-700" role="status">
                {saved === 'created' ? t('feedbackCreated') : t('feedbackSaved')}
              </p>
            )}
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
                      <ConfirmDeleteButton
                        label={t('buttonDelete')}
                        armedLabel={t('deleteArmed')}
                        onDelete={() => handleDelete(product.id)}
                        className="text-red-400 hover:text-red-600 px-0 py-0"
                      />
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
            {/* Questo mese / mese scorso in un clic, le date libere restano */}
            <QuickMonthPicker from={salesFrom} to={salesTo} onChange={(from, to) => { setSalesFrom(from); setSalesTo(to) }} />
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

        <div className="bg-white rounded-xl border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">{t('salesTitle')}</h2>
            <div className="flex items-center gap-2">
              <Tooltip align="right" text={tt('columnsHint')}>
                <ColumnPicker
                  label={tt('columns')}
                  showAllLabel={tt('showAll')}
                  columns={saleColumns.filter(c => c.key !== 'actions').map(c => ({ key: c.key, label: c.label, locked: c.locked }))}
                  hidden={hiddenSaleCols}
                  onChange={setHiddenSaleCols}
                  footer={tt('savedNote')}
                  extraAction={saleCols.sized ? { label: tt('resetWidths'), onClick: saleCols.reset } : undefined}
                />
              </Tooltip>
              {filteredSales.length > 0 && (
                <ExportButtons
                  onCSV={exportSalesCSV}
                  onPDF={exportSalesPDF}
                  csvTooltip={t('salesExportCsvTooltip', { count: filteredSales.length })}
                  pdfTooltip={t('salesExportPdfTooltip', { count: filteredSales.length })}
                />
              )}
            </div>
          </div>
          {filteredSales.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">{salesFiltersActive ? t('salesEmptyFiltered') : t('salesEmpty')}</div>
          ) : (
            // Il riquadro scorre in entrambe le direzioni; intestazioni e totali restano fermi in alto
            <ResizableTable columns={visibleSaleColumns} cols={saleCols}>
              <thead className="sticky top-0 z-10 shadow-sm">
                <tr className="border-b border-gray-100 bg-gray-50">
                  {visibleSaleColumns.map(c => (
                    <ResizableTh key={c.key} col={c.key} cols={saleCols} right={c.right} className="text-gray-400">
                      {c.label}
                    </ResizableTh>
                  ))}
                </tr>
                {/* Riga totali: segue i filtri e resta visibile scorrendo */}
                <tr className="border-b border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700">
                  {visibleSaleColumns.map(c => c.total === undefined ? <td key={c.key} /> : (
                    <td key={c.key} className={`px-4 py-2 whitespace-nowrap ${c.right ? 'text-right' : ''} ${c.totalClass ?? ''}`}>{c.total}</td>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSales.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 transition">
                    {visibleSaleColumns.map(c => (
                      <td key={c.key} className={`px-4 py-3 ${c.right ? 'text-right' : ''} ${saleCols.sized ? 'overflow-hidden text-ellipsis' : ''} ${c.cellClass ?? ''}`}>
                        {c.cell(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </ResizableTable>
          )}
        </div>
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
                {/* Data della vendita per prima: oggi, o il giorno vero se si
                    registra dopo (Carlo, 2026-11-01) */}
                <div>
                  <label className={labelCls}>{t('saleDateLabel')}</label>
                  <input type="date" value={saleDate} max={toISODate(new Date())} onChange={(e) => setSaleDate(e.target.value)} className={inputCls} />
                </div>

                {/* Allieva: autocomplete — digita e scegli dai risultati */}
                <StudentPicker students={students} value={saleStudentId} onChange={setSaleStudentId} />
                {(students ?? []).find(x => x.id === saleStudentId)?.schools?.name && (
                  <SchoolCommissionToggle checked={saleSchoolCommission} onChange={setSaleSchoolCommission} />
                )}

                {/* Prodotti (una o più righe con variante e quantità) */}
                <div>
                  <label className={labelCls}>{t('saleProductsLabel')}</label>
                  <div className="space-y-2">
                    {saleLines.map((line, idx) => {
                      const prod = products.find(p => p.id === line.product_id)
                      const variants = prod?.shop_product_variants ?? []
                      const lineTotal = lineUnitPrice(line) * line.qty
                      const priceChanged = !!prod && Number(line.unit_price) !== Number(prod.price)
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
                          {/* Prezzo unitario: parte dal listino, si può cambiare qui */}
                          {prod && (
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={line.unit_price}
                              onChange={(e) => setLine(idx, { unit_price: e.target.value })}
                              title={t('saleUnitPricePlaceholder')}
                              aria-label={t('saleUnitPricePlaceholder')}
                              className={`w-24 px-2 py-1.5 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 ${
                                priceChanged ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
                              }`}
                            />
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
                    onClick={() => setSaleLines(ls => [...ls, { product_id: '', variant_id: '', qty: 1, unit_price: '' }])}
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
                disabled={saleSubmitting || !saleValid || !saleDate}
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

      {/* Modifica di una riga del registro: gli stessi campi della vendita,
          una riga sola; stock, totale e commissioni li riallinea il backend */}
      {editSale && (() => {
        const prod = products.find(p => p.id === editForm.product_id)
        const variants = prod?.shop_product_variants ?? []
        const gross = (Number(editForm.unit_price) || 0) * editForm.qty
        const discount = Math.min(gross, Math.max(0, Number(editForm.discount) || 0))
        const net = Math.max(0, gross - discount)
        const refCommission = editForm.referrer_id ? net * (Number(editForm.referrer_percentage) || 0) / 100 : 0
        const valid = !!editForm.sold_at && !!editForm.product_id && !!editForm.variant_id && editForm.qty >= 1 && (Number(editForm.unit_price) || 0) > 0
        const referrerOptions = referrers.filter(r => r.active || r.id === editForm.referrer_id)
        // la scuola dell'allieva scelta: dalla lista, o dalla riga se è ancora la sua
        const editStudentSchool = (students ?? []).find(x => x.id === editForm.student_id)?.schools?.name
          ?? (editForm.student_id && editForm.student_id === editSale.student ? editSale.schools?.name : undefined)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4" onClick={() => setEditSale(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-4">
                <h3 className="font-semibold text-gray-900 text-lg">{t('saleEditTitle')}</h3>
                <p className="text-xs text-gray-400 mt-1">{t('saleEditHint')}</p>
                {editError && <div className="mt-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg">{editError}</div>}

                <div className="mt-4 space-y-4">
                  <div>
                    <label className={labelCls}>{t('saleDateLabel')}</label>
                    <input type="date" value={editForm.sold_at} max={toISODate(new Date())} onChange={(e) => patchEdit({ sold_at: e.target.value })} className={inputCls} />
                  </div>

                  <StudentPicker
                    students={students}
                    value={editForm.student_id}
                    initialQuery={editSale.students?.name ?? ''}
                    onChange={(id) => patchEdit({ student_id: id })}
                  />
                  {editStudentSchool && (
                    <SchoolCommissionToggle checked={editForm.school_commission} onChange={(v) => patchEdit({ school_commission: v })} />
                  )}

                  <div>
                    <label className={labelCls}>{t('columnProduct')}</label>
                    <select value={editForm.product_id} onChange={(e) => editChangeProduct(e.target.value)} className={inputCls}>
                      {/* il prodotto della riga resta scelto anche se oggi è disattivato */}
                      {products.filter(p => p.active || p.id === editForm.product_id).map(p => (
                        <option key={p.id} value={p.id}>{p.name} — {formatMoney(Number(p.price), uiLocale)}</option>
                      ))}
                    </select>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {variants.length > 0 && (
                        <select
                          value={editForm.variant_id}
                          onChange={(e) => patchEdit({ variant_id: e.target.value })}
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
                        type="number" min="0.01" step="0.01"
                        value={editForm.unit_price}
                        onChange={(e) => patchEdit({ unit_price: e.target.value })}
                        title={t('saleUnitPricePlaceholder')}
                        aria-label={t('saleUnitPricePlaceholder')}
                        className={`w-24 px-2 py-1.5 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 ${
                          prod && Number(editForm.unit_price) !== Number(prod.price) ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
                        }`}
                      />
                      <input
                        type="number" min="1"
                        value={editForm.qty}
                        onChange={(e) => patchEdit({ qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                        title={t('saleQtyLabel')}
                        aria-label={t('saleQtyLabel')}
                        className="w-16 px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20"
                      />
                      <span className="text-sm font-medium text-gray-700 min-w-20 text-right whitespace-nowrap ml-auto">{formatMoney(gross, uiLocale)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('salePaymentLabel')}</label>
                      <select value={editForm.payment_method} onChange={(e) => patchEdit({ payment_method: e.target.value })} className={inputCls}>
                        {PAYMENT_METHODS.map(m => (
                          <option key={m} value={m}>{t(`payment.${m}` as Parameters<typeof t>[0])}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('saleDiscountLineLabel')}</label>
                      <input type="number" min="0" step="0.01" value={editForm.discount} onChange={(e) => patchEdit({ discount: e.target.value })} className={inputCls} placeholder="0" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t('saleReferrerLabel')}</label>
                      <select
                        value={editForm.referrer_id}
                        onChange={(e) => patchEdit({ referrer_id: e.target.value, ...(e.target.value ? {} : { referrer_percentage: '' }) })}
                        className={inputCls}
                      >
                        <option value="">{t('saleReferrerNone')}</option>
                        {referrerOptions.map(r => <option key={r.id} value={r.id}>{r.active ? r.full_name : `${r.full_name} (${t('referrerInactive')})`}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('saleReferrerPctLabel')}</label>
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={editForm.referrer_percentage}
                        onChange={(e) => patchEdit({ referrer_percentage: e.target.value })}
                        className={inputCls} placeholder="0" disabled={!editForm.referrer_id}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>{t('saleNotesLabel')}</label>
                    <input value={editForm.notes} onChange={(e) => patchEdit({ notes: e.target.value })} className={inputCls} />
                  </div>

                  <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500">{t('saleSubtotalLabel')}</span>
                      <span className="font-medium text-gray-900">{formatMoney(gross, uiLocale)}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">{t('saleDiscountSummary')}</span>
                        <span className="font-medium text-red-600">−{formatMoney(discount, uiLocale)}</span>
                      </div>
                    )}
                    {refCommission > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">{t('saleReferrerCommission')}</span>
                        <span className="font-medium text-amber-600">{formatMoney(refCommission, uiLocale)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                      <span className="text-sm font-semibold text-gray-700">{t('saleTotalLabel')}</span>
                      <span className="font-bold text-[#6B1F3A]">{formatMoney(net, uiLocale)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={handleEditSubmit}
                  disabled={editSubmitting || !valid}
                  className="flex-1 py-2.5 bg-[#6B1F3A] text-white rounded-xl text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
                >
                  {editSubmitting ? t('buttonSaving') : t('buttonSave')}
                </button>
                <button
                  onClick={() => setEditSale(null)}
                  className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
                >
                  {t('buttonCancel')}
                </button>
                <ConfirmDeleteButton
                  label={t('saleDeleteButton')}
                  armedLabel={t('deleteArmed')}
                  onDelete={handleDeleteSale}
                  className="ml-auto border border-red-200 text-red-500 hover:bg-red-50"
                />
              </div>
            </div>
          </div>
        )
      })()}

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

// Allieva: autocomplete — digita e scegli dai risultati. Lo stesso campo
// nella vendita manuale e nella modifica di una riga (Carlo, 2026-11-01).
// `value` è l'id scelto ('' = nessuna); `initialQuery` il nome da mostrare
// quando si apre con un'allieva già scelta.
function StudentPicker({ students, value, onChange, initialQuery = '' }: {
  students: StudentOption[] | null
  value: string
  onChange: (id: string) => void
  initialQuery?: string
}) {
  const t = useTranslations('hq.shop')
  const [query, setQuery] = useState(initialQuery)
  const [listOpen, setListOpen] = useState(false)
  const filtered = (students ?? []).filter(s => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (s.name ?? '').toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q)
  })
  function select(s: StudentOption) {
    onChange(s.id)
    setQuery(s.name)
    setListOpen(false)
  }
  const selected = value ? (students ?? []).find(x => x.id === value) : undefined
  return (
    <div>
      <label className={labelCls}>{t('saleStudentLabel')}</label>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onChange('')
            setListOpen(true)
          }}
          onFocus={() => setListOpen(true)}
          onBlur={() => setTimeout(() => setListOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered[0]) select(filtered[0])
            }
            if (e.key === 'Escape') setListOpen(false)
          }}
          placeholder={t('saleStudentSearch')}
          className={`${inputCls} ${value ? 'border-green-300 bg-green-50/40' : ''}`}
        />
        {(value || query) && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); setListOpen(false) }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-lg leading-none"
          >
            ×
          </button>
        )}
        {listOpen && !value && (
          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {students === null ? (
              <p className="px-3 py-2 text-xs text-gray-400">{t('loading')}</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">{t('saleNoResults')}</p>
            ) : (
              filtered.slice(0, 8).map(s => (
                <button
                  type="button"
                  key={s.id}
                  onMouseDown={(e) => { e.preventDefault(); select(s) }}
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
      {!value ? (
        <p className="text-[11px] text-gray-400 mt-1">{t('saleNoStudentHint')}</p>
      ) : selected?.schools?.name ? (
        <p className="text-[11px] text-[#6B1F3A] mt-1">🏫 {selected.schools.name}</p>
      ) : (
        <p className="text-[11px] text-gray-400 mt-1">{t('saleNoSchool')}</p>
      )}
    </div>
  )
}

// Commissione scuola su una vendita: matura di default, HQ la può togliere
// (Carlo, 2026-11-01). Compare solo quando l'allieva scelta ha una scuola.
function SchoolCommissionToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useTranslations('hq.shop')
  return (
    <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition ${checked ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[#6B1F3A]" />
      <span>
        <span className="block text-sm text-gray-700">{t('saleSchoolCommissionLabel')}</span>
        <span className="block text-[11px] text-gray-400">{checked ? t('saleSchoolCommissionHint') : t('saleSchoolCommissionOff')}</span>
      </span>
    </label>
  )
}

export default function HQShopPage() {
  return <Suspense><HQShopInner /></Suspense>
}
