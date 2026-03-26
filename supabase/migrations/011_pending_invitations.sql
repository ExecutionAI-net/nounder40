-- Pending invitations table for HQ team members and school teachers
CREATE TABLE IF NOT EXISTS pending_invitations (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT    NOT NULL CHECK (type IN ('hq_member', 'school_teacher')),
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL,
  role_detail TEXT,           -- hq_sub_role for HQ members
  school_id   UUID,           -- for school teachers
  phone       TEXT,
  invited_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS needed — all operations done server-side with service role key
