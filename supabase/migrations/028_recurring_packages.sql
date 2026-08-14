-- Recurring package columns on packages table
ALTER TABLE packages ADD COLUMN IF NOT EXISTS is_recurring     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS recurring_interval TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS credits_rollover  BOOLEAN NOT NULL DEFAULT false;

-- Stripe subscription tracking on student_packages
ALTER TABLE student_packages ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE student_packages ADD COLUMN IF NOT EXISTS stripe_customer_id     TEXT;
ALTER TABLE student_packages ADD COLUMN IF NOT EXISTS next_renewal_at        TIMESTAMPTZ;
ALTER TABLE student_packages ADD COLUMN IF NOT EXISTS cancelled_at           TIMESTAMPTZ;
