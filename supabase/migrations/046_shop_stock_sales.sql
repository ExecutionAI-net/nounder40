-- 046: colori prodotto, stock per variante (taglia/colore), vendite manuali HQ
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS colors TEXT[] DEFAULT '{}';

-- Normalizza le categorie legacy ai valori dell'enum applicativo
UPDATE shop_products SET category = 'clothing' WHERE lower(category) = 'apparel';
UPDATE shop_products SET category = 'shoes' WHERE lower(category) = 'footwear';
UPDATE shop_products SET category = lower(category);
UPDATE shop_products SET category = 'other'
  WHERE category NOT IN ('clothing','shoes','accessories','equipment','other');

-- Stock per variante: taglia e/o colore null = prodotto senza quella dimensione.
-- sold si aggiorna automaticamente a ogni vendita manuale.
CREATE TABLE IF NOT EXISTS shop_product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  size TEXT,
  color TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS shop_variants_unique
  ON shop_product_variants (product_id, COALESCE(size, ''), COALESCE(color, ''));

-- Registro vendite manuali (HQ): studente + pezzi specifici, con totale.
-- size/color denormalizzati così la riga resta leggibile se la variante sparisce.
CREATE TABLE IF NOT EXISTS shop_sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES shop_product_variants(id) ON DELETE SET NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  size TEXT,
  color TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "variants_hq_all" ON shop_product_variants;
CREATE POLICY "variants_hq_all" ON shop_product_variants FOR ALL USING (get_my_role() = 'hq');
DROP POLICY IF EXISTS "variants_read" ON shop_product_variants;
CREATE POLICY "variants_read" ON shop_product_variants FOR SELECT USING (true);
DROP POLICY IF EXISTS "sales_hq_all" ON shop_sales;
CREATE POLICY "sales_hq_all" ON shop_sales FOR ALL USING (get_my_role() = 'hq');
