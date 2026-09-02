-- 059: etichette in evidenza sui prodotti del negozio (NEW, In offerta, …)
-- Ogni etichetta ha testo e colore di fondo: [{"label":"NEW","color":"#3D3D3D"}]
ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN shop_products.badges IS
  'Etichette mostrate sulla card e sulla scheda prodotto: array di {label, color}';
