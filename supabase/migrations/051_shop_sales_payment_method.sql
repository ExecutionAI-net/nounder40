-- 051: metodo di pagamento sulle vendite (bonifico, carta, contante, cambio,
-- regalo per le vendite manuali; stripe per gli ordini online)
ALTER TABLE shop_sales
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
