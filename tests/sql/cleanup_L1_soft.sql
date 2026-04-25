-- ============================================================
-- L1 Soft Cleanup — only bookings and lessons created during tests
-- Safe to run at any time without touching core test accounts
-- ============================================================

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
