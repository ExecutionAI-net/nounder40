-- Add country and city to courses so each course can have its own location
ALTER TABLE courses
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS city TEXT;
