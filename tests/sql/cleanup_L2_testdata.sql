-- ============================================================
-- L2 Test Data Cleanup — removes all e2e-prefixed rows
-- Includes schools, locations, lesson types, packages, etc.
-- Does NOT remove test auth users (hq/school/teacher/student)
-- ============================================================

-- 1. Bookings in e2e courses
DELETE FROM bookings
WHERE lesson_id IN (
  SELECT l.id FROM lessons l
  JOIN courses c ON c.id = l.course_id
  WHERE c.name LIKE 'e2e-%'
);

-- 2. Lessons in e2e courses
DELETE FROM lessons
WHERE course_id IN (
  SELECT id FROM courses WHERE name LIKE 'e2e-%'
);

-- 3. Courses
DELETE FROM courses WHERE name LIKE 'e2e-%';

-- 4. School locations and rooms
DELETE FROM school_rooms
WHERE location_id IN (
  SELECT id FROM school_locations
  WHERE school_id IN (SELECT id FROM schools WHERE name LIKE 'e2e-%')
);

DELETE FROM school_locations
WHERE school_id IN (SELECT id FROM schools WHERE name LIKE 'e2e-%');

-- 5. Packages and subscriptions
DELETE FROM packages WHERE name_en LIKE 'e2e-%';
DELETE FROM subscriptions_catalog WHERE name_en LIKE 'e2e-%';

-- 6. Lesson types
DELETE FROM lesson_types WHERE name_en LIKE 'e2e-%';

-- 7. Schools (last, after cascadable children)
DELETE FROM schools WHERE name LIKE 'e2e-%';
