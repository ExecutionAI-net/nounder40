-- Fix: school_rooms had no write policy at all (only SELECT), so adding rooms
-- and saving room cost failed via RLS. Mirror locations_school_admin_write.
DROP POLICY IF EXISTS "rooms_school_admin_write" ON school_rooms;
CREATE POLICY "rooms_school_admin_write"
  ON school_rooms FOR ALL
  USING (
    (location_id IN (SELECT id FROM school_locations WHERE school_id = get_my_school_id())
      AND get_my_role() = 'school')
    OR get_my_role() = 'hq'
  )
  WITH CHECK (
    (location_id IN (SELECT id FROM school_locations WHERE school_id = get_my_school_id())
      AND get_my_role() = 'school')
    OR get_my_role() = 'hq'
  );

-- Fix: deleting a location failed silently when one of its rooms was referenced
-- by a course/lesson (FK RESTRICT). Courses and lessons survive room deletion —
-- they just lose their room assignment.
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_room_id_fkey;
ALTER TABLE courses
  ADD CONSTRAINT courses_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES school_rooms(id) ON DELETE SET NULL;

ALTER TABLE lessons DROP CONSTRAINT IF EXISTS lessons_room_id_fkey;
ALTER TABLE lessons
  ADD CONSTRAINT lessons_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES school_rooms(id) ON DELETE SET NULL;
