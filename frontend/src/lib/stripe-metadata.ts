export const STRIPE_META_TYPE = {
  PACKAGE: 'package',
  RECURRING_PACKAGE: 'recurring_package',
  VIDEO: 'video',
  SHOP: 'shop',
} as const

export type StripeMetaType = (typeof STRIPE_META_TYPE)[keyof typeof STRIPE_META_TYPE]
