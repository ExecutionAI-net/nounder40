-- 052: sconto manuale aggiuntivo e referente (segnalatore) sulle vendite.
-- discount è la quota di sconto della riga (lo sconto ordine viene ripartito
-- proporzionalmente); total è già al netto dello sconto.
ALTER TABLE shop_sales
  ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS referrer_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referrer_commission NUMERIC(10,2) NOT NULL DEFAULT 0;
