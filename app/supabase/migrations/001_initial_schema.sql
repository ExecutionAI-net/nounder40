-- ============================================================
-- Phase 1: Core Schema — Users, Roles, Schools
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('hq', 'school', 'teacher', 'student');
CREATE TYPE hq_sub_role AS ENUM ('super_admin', 'operations', 'tech_support', 'analytics', 'support');
CREATE TYPE school_sub_role AS ENUM ('admin', 'staff');

-- ============================================================
-- PROFILES
-- Central user profile table linked to auth.users
-- ============================================================

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  role          user_role NOT NULL,
  hq_sub_role   hq_sub_role,
  school_sub_role school_sub_role,
  school_id     UUID,                  -- FK to schools (added after schools table)
  language_preference TEXT NOT NULL DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHOOLS
-- ============================================================

CREATE TABLE schools (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  email                       TEXT NOT NULL,
  phone                       TEXT,
  address                     TEXT,
  city                        TEXT,
  country                     TEXT,
  logo_url                    TEXT,
  active                      BOOLEAN NOT NULL DEFAULT false,
  platform_fee_percentage     NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  stripe_account_id           TEXT,
  stripe_onboarding_complete  BOOLEAN NOT NULL DEFAULT false,
  ical_token                  UUID NOT NULL DEFAULT uuid_generate_v4(),
  free_trial_ends_at          TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from profiles to schools
ALTER TABLE profiles
  ADD CONSTRAINT fk_profiles_school
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;

-- ============================================================
-- HQ MEMBERS
-- HQ team — linked to profiles
-- ============================================================

CREATE TABLE hq_members (
  id          UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  sub_role    hq_sub_role NOT NULL DEFAULT 'support',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SCHOOL LOCATIONS & ROOMS
-- ============================================================

CREATE TABLE school_locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT,
  google_maps_url TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE school_rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id UUID NOT NULL REFERENCES school_locations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  capacity    INT NOT NULL DEFAULT 10,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_rooms ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: get current user school_id
CREATE OR REPLACE FUNCTION get_my_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- PROFILES: users can read their own profile; HQ can read all
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR get_my_role() = 'hq');

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- SCHOOLS: HQ can manage all; school members can read their own school
CREATE POLICY "schools_hq_all"
  ON schools FOR ALL
  USING (get_my_role() = 'hq');

CREATE POLICY "schools_school_select"
  ON schools FOR SELECT
  USING (id = get_my_school_id());

-- HQ MEMBERS: HQ can read all
CREATE POLICY "hq_members_hq_select"
  ON hq_members FOR SELECT
  USING (get_my_role() = 'hq');

CREATE POLICY "hq_members_hq_all"
  ON hq_members FOR ALL
  USING (get_my_role() = 'hq');

-- SCHOOL LOCATIONS: school members can read their own school locations
CREATE POLICY "locations_school_select"
  ON school_locations FOR SELECT
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "locations_school_admin_write"
  ON school_locations FOR ALL
  USING (
    (school_id = get_my_school_id() AND get_my_role() = 'school')
    OR get_my_role() = 'hq'
  );

CREATE POLICY "rooms_school_select"
  ON school_rooms FOR SELECT
  USING (
    location_id IN (
      SELECT id FROM school_locations WHERE school_id = get_my_school_id()
    )
    OR get_my_role() = 'hq'
  );

-- ============================================================
-- TRIGGER: auto-create profile on new user signup
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Default role is 'student'; role will be set explicitly for HQ/school/teacher
  INSERT INTO profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- STORAGE BUCKETS (run these in Supabase dashboard or via CLI)
-- ============================================================
-- insert into storage.buckets (id, name, public) values ('documents', 'documents', false);
-- insert into storage.buckets (id, name, public) values ('chat-attachments', 'chat-attachments', false);
-- insert into storage.buckets (id, name, public) values ('metodo-library', 'metodo-library', false);
-- insert into storage.buckets (id, name, public) values ('school-assets', 'school-assets', true);
