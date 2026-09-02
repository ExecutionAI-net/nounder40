-- 047: commissione negozio per scuola + dettagli commissione sulle vendite.
-- Le scuole guadagnano una % sulle vendite shop ai propri studenti (incentivo).
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS shop_commission_percentage NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE shop_sales
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN schools.shop_commission_percentage IS 'Percentuale riconosciuta alla scuola sulle vendite shop ai suoi studenti';
COMMENT ON COLUMN shop_sales.school_id IS 'Scuola dello studente al momento della vendita';
COMMENT ON COLUMN shop_sales.commission IS 'Commissione scuola calcolata automaticamente (total × %)';
