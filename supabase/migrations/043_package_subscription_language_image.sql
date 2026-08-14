-- Packages & subscriptions: single language per product (duplicate to translate) + photo
ALTER TABLE packages ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'it';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE subscriptions_catalog ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'it';
ALTER TABLE subscriptions_catalog ADD COLUMN IF NOT EXISTS image_url TEXT;
