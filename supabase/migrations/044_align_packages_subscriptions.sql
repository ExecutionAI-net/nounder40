-- Allineamento pacchetti/abbonamenti: VIP anche sui pacchetti, Popolare anche sugli abbonamenti
ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE subscriptions_catalog ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT false;
