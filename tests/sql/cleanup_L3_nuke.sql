-- ============================================================
-- L3 Nuke — removes ALL test data including test auth users
-- WARNING: After this, you must re-run create_test_users.sql
-- and npm run test:e2e (setup project) before tests work again
-- ============================================================

-- 1. All e2e test data (same as L2)
DELETE FROM bookings
WHERE lesson_id IN (
  SELECT l.id FROM lessons l
  JOIN courses c ON c.id = l.course_id
  WHERE c.name LIKE 'e2e-%'
);

DELETE FROM lessons
WHERE course_id IN (
  SELECT id FROM courses WHERE name LIKE 'e2e-%'
);

DELETE FROM courses WHERE name LIKE 'e2e-%';

DELETE FROM school_rooms
WHERE location_id IN (
  SELECT id FROM school_locations
  WHERE school_id IN (SELECT id FROM schools WHERE name LIKE 'e2e-%')
);

DELETE FROM school_locations
WHERE school_id IN (SELECT id FROM schools WHERE name LIKE 'e2e-%');

DELETE FROM packages WHERE name_en LIKE 'e2e-%';
DELETE FROM subscriptions_catalog WHERE name_en LIKE 'e2e-%';
DELETE FROM lesson_types WHERE name_en LIKE 'e2e-%';
DELETE FROM schools WHERE name LIKE 'e2e-%';

-- 2. Test auth users (by email pattern)
DELETE FROM profiles
WHERE email LIKE 'support+%@alinaquintana.com';

DELETE FROM auth.users
WHERE email LIKE 'support+%@alinaquintana.com';
