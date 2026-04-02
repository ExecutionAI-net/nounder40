-- Add roles array to profiles for multi-role support
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}';

-- Initialize roles from existing role column
UPDATE profiles SET roles = ARRAY[role::text] WHERE roles IS NULL OR array_length(roles, 1) IS NULL OR roles = '{}';

-- Index for roles containment queries
CREATE INDEX IF NOT EXISTS idx_profiles_roles ON profiles USING GIN (roles);
