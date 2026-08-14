-- Add language field to schools (school's primary teaching language)
ALTER TABLE schools
ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'it';

-- Add language field to courses (instruction language for that course)
ALTER TABLE courses
ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'it';
