-- Columns the app already writes but were never migrated
-- (course creation failed with "Could not find the 'is_online' column")
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_online   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS online_link TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS notes       TEXT;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_online   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS online_link TEXT;

-- Phone on school locations (sedi)
ALTER TABLE school_locations ADD COLUMN IF NOT EXISTS phone TEXT;
