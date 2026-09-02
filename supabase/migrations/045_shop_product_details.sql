-- 045: dettagli prodotto shop — taglie, prezzo pieno (per sconto/offerta), spedizione
-- images TEXT[] esiste già dalla 009.
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS sizes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN shop_products.sizes IS 'Taglie disponibili (XS..XXL per abbigliamento, 35..41 per scarpe); vuoto = taglia unica';
COMMENT ON COLUMN shop_products.original_price IS 'Prezzo pieno barrato quando il prodotto è in offerta (price = prezzo scontato)';
COMMENT ON COLUMN shop_products.shipping_cost IS 'Costo di spedizione del prodotto; 0 = gratis';
