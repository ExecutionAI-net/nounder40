-- ============================================================
-- Test Users — No Under 40
-- Run this in Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
  v_hq_id      uuid := gen_random_uuid();
  v_school_id  uuid := gen_random_uuid();
  v_teacher_id uuid := gen_random_uuid();
  v_student_id uuid := gen_random_uuid();
  v_test_school_id uuid := gen_random_uuid();
BEGIN

  -- --------------------------------------------------------
  -- 1. Auth users
  -- --------------------------------------------------------

  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at, updated_at
  ) VALUES
  (
    '00000000-0000-0000-0000-000000000000', v_hq_id,
    'authenticated', 'authenticated',
    'support+hq@alinaquintana.com',
    crypt('Aa123456+', gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000', v_school_id,
    'authenticated', 'authenticated',
    'support+school@alinaquintana.com',
    crypt('Aa123456+', gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000', v_teacher_id,
    'authenticated', 'authenticated',
    'support+teacher@alinaquintana.com',
    crypt('Aa123456+', gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000', v_student_id,
    'authenticated', 'authenticated',
    'support+student@alinaquintana.com',
    crypt('Aa123456+', gen_salt('bf')),
    NOW(), '{"provider":"email","providers":["email"]}', '{}',
    NOW(), NOW()
  );

  -- --------------------------------------------------------
  -- 2. Test school (required for school user)
  -- --------------------------------------------------------

  INSERT INTO schools (
    id, name, slug, email, city, country,
    active, platform_fee_percentage, created_at
  ) VALUES (
    v_test_school_id,
    'Test School',
    'test-school',
    'support+school@alinaquintana.com',
    'Milan', 'IT',
    true, 10,
    NOW()
  )
  ON CONFLICT (slug) DO NOTHING;

  -- --------------------------------------------------------
  -- 3. Profiles
  -- --------------------------------------------------------

  INSERT INTO profiles (id, email, name, role, roles, hq_sub_role, created_at)
  VALUES (
    v_hq_id,
    'support+hq@alinaquintana.com',
    'Test HQ',
    'hq',
    ARRAY['hq'],
    'super_admin',
    NOW()
  );

  INSERT INTO profiles (id, email, name, role, roles, school_id, school_sub_role, created_at)
  VALUES (
    v_school_id,
    'support+school@alinaquintana.com',
    'Test School Admin',
    'school',
    ARRAY['school'],
    v_test_school_id,
    'owner',
    NOW()
  );

  INSERT INTO profiles (id, email, name, role, roles, created_at)
  VALUES (
    v_teacher_id,
    'support+teacher@alinaquintana.com',
    'Test Teacher',
    'teacher',
    ARRAY['teacher'],
    NOW()
  );

  INSERT INTO profiles (id, email, name, role, roles, created_at)
  VALUES (
    v_student_id,
    'support+student@alinaquintana.com',
    'Test Student',
    'student',
    ARRAY['student'],
    NOW()
  );

  -- --------------------------------------------------------
  -- 4. Student record (students table)
  -- --------------------------------------------------------

  INSERT INTO students (user_id, name, email, created_at)
  VALUES (
    v_student_id,
    'Test Student',
    'support+student@alinaquintana.com',
    NOW()
  );

  RAISE NOTICE 'Test users created successfully.';
  RAISE NOTICE 'HQ:      support+hq@alinaquintana.com';
  RAISE NOTICE 'School:  support+school@alinaquintana.com';
  RAISE NOTICE 'Teacher: support+teacher@alinaquintana.com';
  RAISE NOTICE 'Student: support+student@alinaquintana.com';
  RAISE NOTICE 'Password: Aa123456+';

END $$;
