-- 050: backfill delle righe di stock per i prodotti creati prima dell'auto-
-- salvataggio varianti. Senza righe, lato studente il prodotto risultava
-- "senza gestione stock" e quindi sempre acquistabile: ora ogni prodotto ha
-- le sue combinazioni taglia × colore (o riga unica) con stock 0.
INSERT INTO shop_product_variants (product_id, size, color, stock)
SELECT p.id, s.size, c.color, 0
FROM shop_products p
LEFT JOIN LATERAL unnest(
  CASE WHEN array_length(p.sizes, 1) IS NULL THEN ARRAY[NULL::text] ELSE p.sizes END
) AS s(size) ON true
LEFT JOIN LATERAL unnest(
  CASE WHEN array_length(p.colors, 1) IS NULL THEN ARRAY[NULL::text] ELSE p.colors END
) AS c(color) ON true
WHERE NOT EXISTS (SELECT 1 FROM shop_product_variants v WHERE v.product_id = p.id);
