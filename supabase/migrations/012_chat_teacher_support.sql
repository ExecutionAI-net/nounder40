-- Add teacher_id to conversations for school_teacher type
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE;

-- Add RLS policy for teachers
DROP POLICY IF EXISTS "conversations_teacher" ON conversations;
CREATE POLICY "conversations_teacher" ON conversations FOR ALL
  USING (teacher_id IN (SELECT id FROM teachers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "messages_insert_teacher" ON messages;
CREATE POLICY "messages_insert_teacher" ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());
