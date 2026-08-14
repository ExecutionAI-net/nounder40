-- Backfill schools.user_id from profiles for existing schools
-- profiles.school_id → schools.id relationship already exists
UPDATE schools s
SET user_id = p.id
FROM profiles p
WHERE p.school_id = s.id
  AND p.role = 'school'
  AND s.user_id IS NULL;
