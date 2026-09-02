-- 048: ordini online dal negozio studente.
-- Le righe d'ordine finiscono in shop_sales come le vendite manuali:
-- order_id raggruppa le righe dello stesso ordine, shipping è il costo di
-- spedizione dell'ordine (regola attuale: il più alto tra i prodotti, una
-- volta sola — registrato sulla prima riga), source distingue online/manual.
ALTER TABLE shop_sales
  ADD COLUMN IF NOT EXISTS order_id UUID,
  ADD COLUMN IF NOT EXISTS shipping NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS shop_sales_order_idx ON shop_sales (order_id);
