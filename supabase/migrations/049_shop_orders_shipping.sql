-- 049: costo spedizione sugli ordini shop (checkout Stripe diretto HQ)
ALTER TABLE shop_orders
  ADD COLUMN IF NOT EXISTS shipping NUMERIC(10,2) NOT NULL DEFAULT 0;
