-- Add 'owner' to school_sub_role enum
ALTER TYPE school_sub_role ADD VALUE IF NOT EXISTS 'owner';

-- Update pending_invitations constraint to include 'school_member'
ALTER TABLE pending_invitations
  DROP CONSTRAINT IF EXISTS pending_invitations_type_check;

ALTER TABLE pending_invitations
  ADD CONSTRAINT pending_invitations_type_check
  CHECK (type IN ('hq_member', 'school_teacher', 'school_member'));
