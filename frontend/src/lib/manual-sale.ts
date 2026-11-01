// A sale the school types by hand (Carlo, 2026-11-01): what "Assign package"
// (reason "sale") and the Payments edit modal share, so a backend code or a
// method added later is changed in one place. Both message namespaces
// (school.students, school.payments) carry the same key names.
export const SALE_PAYMENT_METHODS = ['cash', 'bank_transfer', 'pos', 'other'] as const

export const SALE_ERROR_KEYS: Record<string, string> = {
  price_required: 'saleErrorPrice',
  discount_over_price: 'saleErrorDiscount',
  invalid_discount: 'saleErrorDiscountInvalid',
  invalid_sold_at: 'saleErrorDate',
  invalid_payment_method: 'saleErrorMethod',
  online_payment_locked: 'saleErrorLocked',
  payment_refunded: 'saleErrorRefunded',
  not_found: 'saleErrorNotFound',
}
