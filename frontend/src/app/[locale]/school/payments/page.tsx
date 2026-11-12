'use client'

import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { localizedName, type TranslatedNames } from '@/lib/localized-name'
import { apiFetch, ApiError } from '@/lib/api/client'
import MultiFilterSelect from '@/components/ui/MultiFilterSelect'
import QuickMonthPicker from '@/components/ui/QuickMonthPicker'
import ConfirmDeleteButton from '@/components/ui/ConfirmDeleteButton'
import Tooltip from '@/components/ui/Tooltip'
import ColumnPicker from '@/components/ui/ColumnPicker'
import ExportButtons from '@/components/ui/ExportButtons'
import { ResizableTable, ResizableTh } from '@/components/ui/ResizableTable'
import { exportCSV } from '@/lib/export-csv'
import { exportTablePDF } from '@/lib/export'
import { orderColumns, useResizableColumns, useStoredKeyList } from '@/lib/use-table-columns'
import { formatMoney, formatNumber } from '@/lib/format-money'
import { formatDate, toISODate } from '@/lib/format-date'
import { SALE_ERROR_KEYS, SALE_PAYMENT_METHODS } from '@/lib/manual-sale'

type Transaction = {
  id: string
  type: string
  // the package / product behind the row (null for manual credits without a catalog row)
  product_id: string | null
  product_name: string
  // live translations of the package behind product_id (null for shop orders / deleted packages)
  product_names?: TranslatedNames
  // DRF serializes DecimalField as a string (COERCE_DECIMAL_TO_STRING) — wrap with Number() before math/.toFixed().
  amount: string
  currency: string
  platform_fee: string
  school_amount: string
  payment_method: string
  stripe_payment_id: string | null
  status: 'completed' | 'pending' | 'refunded' | 'failed'
  created_at: string
  students: { id: string; name: string; email: string } | null
  // "Primo acquisto" (Carlo, 2026-11-01): the student's very first lesson
  // purchase in this school was a single or a package; "package_after_single"
  // is her first package when she started with a single
  first_purchase: 'single' | 'package' | 'package_after_single' | null
  // a sale the school typed by hand: editable and deletable from here while
  // its credit row exists (a deleted student takes the row with her)
  manual_grant: string | null
  discount: string
  note: string
  // the day of the payment as the school reads it (its zone, not the browser's)
  sold_at: string
}

const FIRST_PURCHASE_VALUES = ['single', 'package', 'package_after_single'] as const
const FIRST_COLORS: Record<string, string> = {
  single: 'bg-amber-100 text-amber-800',
  package: 'bg-green-100 text-green-800',
  package_after_single: 'bg-[#6B1F3A]/10 text-[#6B1F3A]',
}

// ── Columns ───────────────────────────────────────────────────────────────────
// One list drives the header, each row's cells, the CSV and the PDF, so the
// "Columns" menu trims them all at once: the same tooling as School › Reports
// › Bookings (Carlo, 2026-11-12). A column may export more than one cell:
// Student carries the email, Product the type and the first purchase, Gross
// the discount.
type ExportFmt = 'csv' | 'pdf'
type PayColumn = {
  key: string
  label: string
  right?: boolean
  locked?: boolean        // cannot be hidden: the row's identity
  cellClass?: string
  cell: (tx: Transaction) => ReactNode
  exportHeaders: string[]
  exportValues: (tx: Transaction, fmt: ExportFmt) => (string | number)[]
}
// The hidden columns, the dragged widths and the column order, remembered in
// this browser (lib/use-table-columns)
const PAY_COLS_STORAGE = 'school-payments:columns'
const PAY_WIDTHS_STORAGE = 'school-payments:col-widths'
const PAY_ORDER_STORAGE = 'school-payments:col-order'

// The school's roster, for the student filter (GET /school/students/)
type StudentRow = { students: { id: string; name: string; email: string } | null }

// One option per distinct key, labelled and sorted in the viewer's language
function uniqueOptions<T>(rows: T[], keyOf: (r: T) => string | null, labelOf: (r: T) => string, locale: string) {
  const map = new Map<string, string>()
  for (const r of rows) {
    const key = keyOf(r)
    if (key && !map.has(key)) map.set(key, labelOf(r))
  }
  return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, locale))
}

// The sale as the school corrects it from Payments
type EditSale = { sold_at: string; price: string; discount: string; payment_method: string; note: string }

type StripeStatus = {
  connected: boolean
  onboarding_complete: boolean
  account_id: string | null
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-600',
}

function SchoolPaymentsPage() {
  const t = useTranslations('school.payments')
  const tt = useTranslations('tableTools')
  const uiLocale = useLocale()
  // The package's name in the viewer's language; the name frozen at purchase only as fallback
  const productName = (tx: Transaction) => localizedName(tx.product_names, uiLocale, tx.product_name ?? '')
  const searchParams = useSearchParams()

  const METHOD_LABELS: Record<string, string> = {
    stripe: t('methodCard'),
    cash: t('methodCash'),
    bank_transfer: t('methodBankTransfer'),
    pos: t('methodPOS'),
    paypal: t('methodPayPal'),
    other: t('methodOther'),
  }
  const FIRST_LABELS: Record<string, string> = {
    single: t('firstSingle'),
    package: t('firstPackage'),
    package_after_single: t('firstPackageAfterSingle'),
  }
  const STATUS_LABELS: Record<string, string> = {
    completed: t('completed'),
    pending: t('pending'),
    refunded: t('refunded'),
    failed: t('failed'),
  }
  // I18N-R3-06: `tx.type` is a raw enum from the API and was rendered with a
  // CSS `capitalize`, so every non-English locale read "Package" /
  // "Subscription". Same shape as STATUS_LABELS right above; an unknown
  // value still shows itself rather than disappearing.
  const TYPE_LABELS: Record<string, string> = {
    package: t('typePackage'),
    subscription: t('typeSubscription'),
    video: t('typeVideo'),
    shop: t('typeShop'),
    manual: t('typeManual'),
  }
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  // Period: sent to the server (the list is capped at 1000 rows, so an old
  // month must be asked for, not sliced client-side). The other filters
  // work on the rows that came back.
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterProduct, setFilterProduct] = useState<string[]>([])
  // Allieva (Carlo, 2026-11-01): sent to the server like the period (the
  // list is capped at 1000 rows); the options are the school's whole roster
  const [filterStudent, setFilterStudent] = useState<string[]>([])
  const [roster, setRoster] = useState<StudentRow['students'][]>([])
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refunding, setRefunding] = useState<string | null>(null)
  // Carlo's rule (I18N-R4-14): filters are multi-select, with a label
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterMethod, setFilterMethod] = useState<string[]>([])
  // "Primo acquisto": sent to the server, which reads the student's whole history
  const [filterFirst, setFilterFirst] = useState<string[]>([])
  const [onboardNotice, setOnboardNotice] = useState<string | null>(null)
  // A sale typed by the school, open for correction (Carlo, 2026-11-01)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [editForm, setEditForm] = useState<EditSale>({ sold_at: '', price: '', discount: '', payment_method: 'cash', note: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Table: hidden columns, dragged widths, column order (this browser's)
  const [hiddenCols, changeHiddenCols] = useStoredKeyList(PAY_COLS_STORAGE)
  const payCols = useResizableColumns(PAY_WIDTHS_STORAGE)
  const [colOrder, changeColOrder] = useStoredKeyList(PAY_ORDER_STORAGE)

  const loadStripeStatus = useCallback(async () => {
    setStripeStatus(await apiFetch<StripeStatus>('/stripe/onboard/status/').catch(() => null))
  }, [])

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterFrom) params.set('date_from', filterFrom)
    if (filterTo) params.set('date_to', filterTo)
    if (filterFirst.length) params.set('first', filterFirst.join(','))
    if (filterStudent.length) params.set('student', filterStudent.join(','))
    const query = params.toString()
    const txData = await apiFetch<Transaction[]>(`/school/transactions/${query ? `?${query}` : ''}`).catch(() => [])
    setTransactions(Array.isArray(txData) ? txData : [])
    setLoading(false)
  }, [filterFrom, filterTo, filterFirst, filterStudent])

  useEffect(() => {
    apiFetch<StudentRow[]>('/school/students/')
      .then(rows => setRoster((Array.isArray(rows) ? rows : []).map(r => r.students).filter(Boolean)))
      .catch(() => {})
  }, [])

  // ── a sale typed by the school: correct or delete it ──
  function openEdit(tx: Transaction) {
    setEditing(tx)
    setEditForm({
      sold_at: tx.sold_at,
      // two decimals: 100.10 + 0.20 is 100.30000000000001 in binary
      price: (Number(tx.amount) + Number(tx.discount)).toFixed(2),
      discount: Number(tx.discount) > 0 ? String(Number(tx.discount)) : '',
      payment_method: tx.payment_method,
      note: tx.note ?? '',
    })
    setEditError(null)
  }
  function editErrorText(err: unknown): string {
    const code = err instanceof ApiError && typeof err.body === 'object' && err.body ? (err.body as { error?: string }).error : undefined
    return code && SALE_ERROR_KEYS[code] ? t(SALE_ERROR_KEYS[code] as Parameters<typeof t>[0]) : t('somethingWentWrong')
  }
  async function handleEditSave() {
    if (!editing) return
    setEditSaving(true)
    setEditError(null)
    try {
      await apiFetch(`/school/transactions/${editing.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          sold_at: editForm.sold_at, price: Number(editForm.price), discount: Number(editForm.discount) || 0,
          payment_method: editForm.payment_method, note: editForm.note,
        }),
      })
      setEditing(null)
      await loadTransactions()
    } catch (err) {
      setEditError(editErrorText(err))
    }
    setEditSaving(false)
  }
  async function handleEditDelete() {
    if (!editing) return
    setEditError(null)
    try {
      await apiFetch(`/school/transactions/${editing.id}/`, { method: 'DELETE' })
      setEditing(null)
      await loadTransactions()
    } catch (err) {
      setEditError(editErrorText(err))
    }
  }

  useEffect(() => {
    const param = searchParams.get('onboard')
    if (param === 'success') setOnboardNotice(t('onboardSuccess'))
    else if (param === 'refresh') setOnboardNotice(t('onboardRefresh'))
    loadStripeStatus()
  }, [loadStripeStatus, searchParams, t])

  useEffect(() => { loadTransactions() }, [loadTransactions])

  async function handleRefreshStatus() {
    setRefreshing(true)
    await loadStripeStatus()
    setRefreshing(false)
  }

  async function handleConnect() {
    setConnecting(true)
    try {
      const data = await apiFetch<{ url: string }>('/stripe/onboard/', { method: 'POST' })
      window.location.href = data.url
    } catch (err) {
      // Il paese della scuola va sistemato PRIMA di aprire l'account: Stripe
      // non permette di cambiarlo dopo. Messaggio esplicito, non generico.
      const body = err instanceof ApiError && typeof err.body === 'object' && err.body
        ? (err.body as { error?: string; country?: string | null })
        : null
      if (body?.error === 'school_country_missing') alert(t('errorCountryMissing'))
      else if (body?.error === 'school_country_unknown') alert(t('errorCountryUnknown', { country: body.country ?? '' }))
      else alert(t('errorStripeOnboarding'))
      setConnecting(false)
    }
  }

  async function handleRefund(txId: string) {
    if (!confirm(t('confirmRefund'))) return
    setRefunding(txId)
    try {
      await apiFetch('/stripe/refund/', { method: 'POST', body: JSON.stringify({ transaction_id: txId }) })
      setTransactions(prev =>
        prev.map(tx => tx.id === txId ? { ...tx, status: 'refunded' } : tx)
      )
    } catch {
      // no-op
    }
    setRefunding(null)
  }

  // One option per product sold in the period: the catalog row when there is
  // one (its name in the viewer's language), else the name frozen on the
  // transaction. Sorted in the viewer's language.
  const productKey = (tx: Transaction) => tx.product_id ?? `name:${tx.product_name ?? ''}`
  const productOptions = useMemo(() => uniqueOptions(
    transactions, productKey, tx => productName(tx) || (TYPE_LABELS[tx.type] ?? tx.type), uiLocale,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- productName / TYPE_LABELS are rebuilt per render and depend only on uiLocale
  ), [transactions, uiLocale])

  // The roster: a name shared by two students gets the email beside it
  const studentOptions = useMemo(() => {
    const names = new Map<string, number>()
    for (const s of roster) if (s) names.set(s.name, (names.get(s.name) ?? 0) + 1)
    return uniqueOptions(
      roster, s => s?.id ?? null,
      s => !s ? '' : (names.get(s.name) ?? 0) > 1 || !s.name ? [s.name, s.email].filter(Boolean).join(' · ') : s.name,
      uiLocale,
    )
  }, [roster, uiLocale])

  const filtered = useMemo(() => transactions.filter(tx => {
    if (filterStatus.length && !filterStatus.includes(tx.status)) return false
    if (filterMethod.length && !filterMethod.includes(tx.payment_method ?? '')) return false
    if (filterProduct.length && !filterProduct.includes(productKey(tx))) return false
    return true
  }), [transactions, filterStatus, filterMethod, filterProduct])
  const hasFilters = Boolean(filterFrom || filterTo) || filterStatus.length > 0 || filterMethod.length > 0 || filterProduct.length > 0 || filterFirst.length > 0 || filterStudent.length > 0
  function clearFilters() {
    setFilterFrom(''); setFilterTo(''); setFilterStatus([]); setFilterMethod([]); setFilterProduct([]); setFilterFirst([]); setFilterStudent([])
  }

  // The totals follow the filters (Carlo, 2026-09-21): gross — what the
  // school invoices — the platform's fee, the net, and how many payments,
  // on the completed rows of the filtered list, never on the whole history.
  const completed = filtered.filter(tx => tx.status === 'completed')
  const sum = (pick: (tx: Transaction) => string) => completed.reduce((acc, tx) => acc + Number(pick(tx)), 0)
  const grossRevenue = sum(tx => tx.amount)
  const platformFees = sum(tx => tx.platform_fee)
  const netRevenue = sum(tx => tx.school_amount)
  const money = (v: number | string) => formatMoney(Number(v), uiLocale)
  const inputCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20'

  // ── Columns: screen, CSV and PDF from one list ──
  // CSV gets a plain number (a spreadsheet sums it), the PDF the formatted
  // amount; the "(€)" sits in the header, as in HQ › Shop › Sales
  const moneyOut = (v: string | number, fmt: ExportFmt): string =>
    fmt === 'csv' ? Number(v).toFixed(2) : formatNumber(Number(v), uiLocale, { decimals: 2 })
  const moneyCol = (key: string, label: string, value: (tx: Transaction) => string, cellClass: string): PayColumn => ({
    key, label, right: true, cellClass,
    cell: tx => money(value(tx)),
    exportHeaders: [`${label} (€)`], exportValues: (tx, f) => [moneyOut(value(tx), f)],
  })
  const columns: PayColumn[] = [
    {
      key: 'date', label: t('colDate'), cellClass: 'text-gray-500 whitespace-nowrap',
      cell: tx => formatDate(tx.created_at),
      exportHeaders: [t('colDate')], exportValues: tx => [formatDate(tx.created_at)],
    },
    {
      key: 'student', label: t('colStudent'), locked: true, cellClass: 'whitespace-nowrap',
      cell: tx => tx.students ? (
        <>
          <p className="font-medium text-gray-900">{tx.students.name}</p>
          <p className="text-xs text-gray-400">{tx.students.email}</p>
        </>
      ) : (
        <span className="text-gray-400">—</span>
      ),
      exportHeaders: [t('colStudent'), t('colEmail')], exportValues: tx => [tx.students?.name ?? '', tx.students?.email ?? ''],
    },
    {
      key: 'product', label: t('colProduct'), cellClass: 'whitespace-nowrap',
      cell: tx => (
        <>
          <p className="text-gray-900">{productName(tx)}</p>
          <p className="text-xs text-gray-400">{TYPE_LABELS[tx.type] ?? tx.type}</p>
          {/* Primo acquisto: una pillola per tipo, sempre sotto il prodotto */}
          {tx.first_purchase && (
            <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${FIRST_COLORS[tx.first_purchase]}`}>
              {FIRST_LABELS[tx.first_purchase]}
            </span>
          )}
        </>
      ),
      exportHeaders: [t('colProduct'), t('colType'), t('filterFirstPurchase')],
      exportValues: tx => [productName(tx), TYPE_LABELS[tx.type] ?? tx.type, tx.first_purchase ? FIRST_LABELS[tx.first_purchase] : ''],
    },
    {
      key: 'method', label: t('colMethod'), cellClass: 'text-gray-600 whitespace-nowrap',
      cell: tx => (
        <>
          {METHOD_LABELS[tx.payment_method] ?? tx.payment_method}
          {tx.payment_method !== 'stripe' && (
            <span className="block mt-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full w-fit">{t('enteredBySchool')}</span>
          )}
        </>
      ),
      exportHeaders: [t('colMethod')], exportValues: tx => [METHOD_LABELS[tx.payment_method] ?? tx.payment_method],
    },
    {
      // the discount under the amount on screen, its own column in the export
      ...moneyCol('gross', t('colGross'), tx => tx.amount, 'font-semibold text-gray-900 whitespace-nowrap'),
      cell: tx => (
        <>
          {money(tx.amount)}
          {Number(tx.discount) > 0 && (
            <span className="block text-[10px] font-normal text-red-500">{t('discountApplied', { amount: money(tx.discount) })}</span>
          )}
        </>
      ),
      exportHeaders: [`${t('colGross')} (€)`, `${t('colDiscount')} (€)`],
      exportValues: (tx, f) => [moneyOut(tx.amount, f), Number(tx.discount) > 0 ? moneyOut(tx.discount, f) : ''],
    },
    moneyCol('fee', t('colFee'), tx => tx.platform_fee, 'text-gray-500 whitespace-nowrap'),
    moneyCol('net', t('colNet'), tx => tx.school_amount, 'text-gray-900 whitespace-nowrap'),
    {
      key: 'status', label: t('colStatus'), cellClass: 'whitespace-nowrap',
      cell: tx => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[tx.status]}`}>
          {STATUS_LABELS[tx.status] ?? tx.status}
        </span>
      ),
      exportHeaders: [t('colStatus')], exportValues: tx => [STATUS_LABELS[tx.status] ?? tx.status],
    },
    {
      // Edit / refund: not data, so out of the column picker and the exports
      key: 'actions', label: '', locked: true, right: true, cellClass: 'whitespace-nowrap',
      cell: tx => (
        <>
          {tx.manual_grant && tx.status === 'completed' && (
            <button onClick={() => openEdit(tx)} className="text-xs text-gray-500 hover:text-[#6B1F3A] font-medium">
              {t('editSale')}
            </button>
          )}
          {tx.status === 'completed' && tx.payment_method === 'stripe' && (
            <button
              onClick={() => handleRefund(tx.id)}
              disabled={refunding === tx.id}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              {refunding === tx.id ? t('refunding') : t('refund')}
            </button>
          )}
        </>
      ),
      exportHeaders: [], exportValues: () => [],
    },
  ]
  // the reader's order applies to the data columns; the actions stay last
  const orderedColumns = [
    ...orderColumns(columns.filter(c => c.key !== 'actions'), colOrder),
    ...columns.filter(c => c.key === 'actions'),
  ]
  const visibleColumns = orderedColumns.filter(c => c.locked || !hiddenCols.includes(c.key))

  // The rows on screen (the filters applied), the visible columns as they stand
  const exportRows = (fmt: ExportFmt) => ({
    headers: visibleColumns.flatMap(c => c.exportHeaders),
    rows: filtered.map(tx => visibleColumns.flatMap(c => c.exportValues(tx, fmt))),
    right: visibleColumns.flatMap(c => c.exportHeaders.map(() => !!c.right)),
  })
  const exportPaymentsCSV = () => {
    const { headers, rows } = exportRows('csv')
    exportCSV('school-payments', headers, rows)
  }
  const exportPaymentsPDF = async () => {
    const caption = [
      filterFrom && `${t('filterFrom')}: ${formatDate(filterFrom)}`,
      filterTo && `${t('filterTo')}: ${formatDate(filterTo)}`,
      t('paymentCount', { count: filtered.length }),
    ].filter(Boolean).join(' · ')
    await exportTablePDF(
      exportRows('pdf'), `school-payments-${toISODate(new Date())}`, t('tableTitle'),
      tt('exportedOn', { date: formatDate(new Date()) }), { caption },
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-0.5">{t('subtitle')}</p>
      </div>

      {onboardNotice && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex justify-between items-center">
          {onboardNotice}
          <button onClick={() => setOnboardNotice(null)} className="text-blue-400 text-xs ml-4">✕</button>
        </div>
      )}

      {/* Stripe Connect Banner */}
      <div className={`rounded-xl border p-5 mb-6 ${
        stripeStatus?.onboarding_complete
          ? 'bg-green-50 border-green-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`w-2 h-2 rounded-full ${stripeStatus?.onboarding_complete ? 'bg-green-500' : stripeStatus?.connected ? 'bg-yellow-500' : 'bg-gray-400'}`} />
              <p className={`font-semibold text-sm ${stripeStatus?.onboarding_complete ? 'text-green-800' : 'text-amber-800'}`}>
                {stripeStatus?.onboarding_complete
                  ? t('stripeConnected')
                  : stripeStatus?.connected
                    ? t('stripeOnboardingPending')
                    : t('connectStripe')}
              </p>
            </div>
            <p className={`text-xs ${stripeStatus?.onboarding_complete ? 'text-green-600' : 'text-amber-600'}`}>
              {stripeStatus?.onboarding_complete
                ? `Account ID: ${stripeStatus.account_id}`
                : stripeStatus?.connected
                  ? `Account ID: ${stripeStatus.account_id} · ${t('stripeOnboardingPendingDesc')}`
                  : t('stripeDisconnectedDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {stripeStatus?.connected && !stripeStatus?.onboarding_complete && (
              <button
                onClick={handleRefreshStatus}
                disabled={refreshing}
                className="text-amber-700 border border-amber-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-100 transition disabled:opacity-50"
              >
                {refreshing ? t('checking') : t('refreshStatus')}
              </button>
            )}
          {!stripeStatus?.onboarding_complete && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="bg-[#6B1F3A] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#5a1930] transition disabled:opacity-50"
            >
              {connecting ? t('redirecting') : stripeStatus?.connected ? t('continueOnboarding') : t('connectStripe')}
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Filters — above the totals, which follow them */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterFrom')}</label>
          <input type="date" value={filterFrom} max={filterTo || undefined}
            onChange={e => setFilterFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterTo')}</label>
          <input type="date" value={filterTo} min={filterFrom || undefined}
            onChange={e => setFilterTo(e.target.value)} className={inputCls} />
        </div>
        {/* This month / last month in one click, as in Reports (Carlo, 2026-11-01) */}
        <QuickMonthPicker from={filterFrom} to={filterTo} onChange={(from, to) => { setFilterFrom(from); setFilterTo(to) }} />
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterStudent')}</label>
          <MultiFilterSelect label={t('allStudents')} selected={filterStudent} onChange={setFilterStudent}
            options={studentOptions} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allProducts')}</label>
          <MultiFilterSelect label={t('allProducts')} selected={filterProduct} onChange={setFilterProduct}
            options={productOptions} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allStatuses')}</label>
          <MultiFilterSelect label={t('allStatuses')} selected={filterStatus} onChange={setFilterStatus}
            options={[
              { value: 'completed', label: t('completed') }, { value: 'pending', label: t('pending') },
              { value: 'refunded', label: t('refunded') }, { value: 'failed', label: t('failed') },
            ]} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('allMethods')}</label>
          <MultiFilterSelect label={t('allMethods')} selected={filterMethod} onChange={setFilterMethod}
            options={[
              { value: 'stripe', label: t('methodCardStripe') }, { value: 'cash', label: t('methodCash') },
              { value: 'bank_transfer', label: t('methodBankTransfer') }, { value: 'pos', label: t('methodPOS') },
              { value: 'paypal', label: t('methodPayPal') }, { value: 'other', label: t('methodOther') },
            ]} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-400 mb-1">{t('filterFirstPurchase')}</label>
          <MultiFilterSelect label={t('filterFirstPurchase')} selected={filterFirst} onChange={setFilterFirst}
            options={FIRST_PURCHASE_VALUES.map(v => ({ value: v, label: FIRST_LABELS[v] }))} />
        </div>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
            {t('clearFilters')}
          </button>
        )}
      </div>

      {/* Totals: on the filtered rows, completed only. Gross first: it is what gets invoiced. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('grossRevenue')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{money(grossRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('platformFees')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{money(platformFees)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('netRevenue')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{money(netRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{t('transactions')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{completed.length}</p>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mb-6">{t(hasFilters ? 'totalsFiltered' : 'totalsAll')}</p>

      {/* Transactions. No overflow-hidden on the box: the "Columns" menu drops over the table */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">{t('tableTitle')}</h2>
          <div className="flex items-center gap-2">
            <Tooltip align="right" text={tt('columnsHint')}>
              <ColumnPicker
                columns={orderedColumns.filter(c => c.key !== 'actions').map(c => ({ key: c.key, label: c.label, locked: c.locked }))}
                hidden={hiddenCols}
                onChange={changeHiddenCols}
                onReorder={changeColOrder}
                resetOrder={colOrder.length ? () => changeColOrder([]) : undefined}
                resetWidths={payCols.sized ? payCols.reset : undefined}
              />
            </Tooltip>
            {filtered.length > 0 && (
              <ExportButtons
                onCSV={exportPaymentsCSV}
                onPDF={exportPaymentsPDF}
                csvTooltip={t('exportCsvTooltip', { count: filtered.length })}
                pdfTooltip={t('exportPdfTooltip', { count: filtered.length })}
              />
            )}
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('noTransactions')}</div>
        ) : (
          <ResizableTable columns={visibleColumns} cols={payCols}>
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="border-b border-gray-100 bg-gray-50">
                {visibleColumns.map(c => (
                  <ResizableTh key={c.key} col={c.key} cols={payCols} right={c.right} className="text-gray-400">
                    {c.label}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(tx => (
                <tr key={tx.id} className="hover:bg-gray-50 transition">
                  {visibleColumns.map(c => (
                    <td key={c.key} className={`px-4 py-3 ${c.right ? 'text-right' : ''} ${payCols.sized ? 'overflow-hidden text-ellipsis' : ''} ${c.cellClass ?? ''}`}>
                      {c.cell(tx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </ResizableTable>
        )}
      </div>

      {/* Correzione di una vendita in sede: data, prezzo, sconto, metodo, nota.
          I crediti dell'allieva non si toccano da qui. */}
      {editing && (() => {
        const price = Number(editForm.price) || 0
        const discount = Math.max(0, Number(editForm.discount) || 0)
        const valid = editForm.price.trim() !== '' && price >= 0 && discount <= price && !!editForm.sold_at
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
              <div>
                <h3 className="font-semibold text-gray-900 text-base">{t('editSaleTitle')}</h3>
                <p className="text-sm text-gray-400 mt-0.5">{editing.students?.name} · {productName(editing)}</p>
                <p className="text-xs text-gray-400 mt-1">{t('editSaleHint')}</p>
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelSaleDate')}</label>
                  <input type="date" value={editForm.sold_at} max={toISODate(new Date())}
                    onChange={e => setEditForm(f => ({ ...f, sold_at: e.target.value }))} className={`${inputCls} w-full`} />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelPrice')}</label>
                    <input type="number" min="0" step="0.01" value={editForm.price}
                      onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))} className={`${inputCls} w-full`} />
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelDiscount')}</label>
                    <input type="number" min="0" step="0.01" value={editForm.discount} placeholder="0"
                      onChange={e => setEditForm(f => ({ ...f, discount: e.target.value }))} className={`${inputCls} w-full`} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('colMethod')}</label>
                  <select value={editForm.payment_method} onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))} className={`${inputCls} w-full`}>
                    {SALE_PAYMENT_METHODS.map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('labelNote')}</label>
                  <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} className={`${inputCls} w-full`} />
                </div>
                <div className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2 text-sm">
                  <span className="text-gray-500">{t('labelNet')}</span>
                  <span className="font-semibold text-gray-900">{money(Math.max(0, price - discount))}</span>
                </div>
              </div>
              <div className="flex gap-2 pt-1 items-center">
                <button onClick={handleEditSave} disabled={editSaving || !valid}
                  className="flex-1 px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition">
                  {editSaving ? t('saving') : t('save')}
                </button>
                <button onClick={() => setEditing(null)} className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
                  {t('cancel')}
                </button>
                <ConfirmDeleteButton label={t('deleteSale')} armedLabel={t('deleteArmed')} onDelete={handleEditDelete} className="ml-auto border border-red-200 text-red-500 hover:bg-red-50" />
              </div>
              <p className="text-[11px] text-gray-400">{t('deleteSaleHint')}</p>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function SchoolPaymentsPageWrapper() {
  return (
    <Suspense>
      <SchoolPaymentsPage />
    </Suspense>
  )
}
