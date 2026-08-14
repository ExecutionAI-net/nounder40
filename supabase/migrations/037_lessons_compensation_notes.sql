-- Remaining columns the app writes on lessons but were never migrated
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS compensation_plan_id UUID REFERENCES compensation_plans(id) ON DELETE SET NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS notes TEXT;
