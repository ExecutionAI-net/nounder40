-- Supabase-only objects the migrations reference, stubbed so the real
-- migration files replay on a vanilla Postgres. Run BEFORE the migrations.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               text,
  encrypted_password  text,
  raw_user_meta_data  jsonb DEFAULT '{}'::jsonb,
  created_at          timestamptz DEFAULT now(),
  last_sign_in_at     timestamptz,
  deleted_at          timestamptz,
  banned_until        timestamptz
);

-- RLS policies in the migrations call auth.uid(); a NULL-returning stub is fine
-- because the migrating superuser bypasses RLS anyway.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

-- migration 002 does: ALTER PUBLICATION supabase_realtime ADD TABLE ...
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
