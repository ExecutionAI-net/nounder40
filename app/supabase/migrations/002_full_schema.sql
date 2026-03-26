-- ============================================================
-- Phase 2-7: Complete Schema Migration
-- Run this AFTER 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- Add missing columns to existing tables
-- ============================================================

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS grace_period_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ============================================================
-- LESSON TYPES (HQ Metodo Catalog)
-- ============================================================

CREATE TABLE IF NOT EXISTS lesson_types (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code           TEXT NOT NULL UNIQUE,
  name_it        TEXT NOT NULL DEFAULT '',
  name_en        TEXT NOT NULL DEFAULT '',
  name_fr        TEXT NOT NULL DEFAULT '',
  name_es        TEXT NOT NULL DEFAULT '',
  level          TEXT,
  description_it TEXT,
  description_en TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lesson_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_types_read_all"
  ON lesson_types FOR SELECT
  USING (true);

CREATE POLICY "lesson_types_hq_write"
  ON lesson_types FOR ALL
  USING (get_my_role() = 'hq');

-- ============================================================
-- STUDENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS students (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT,
  date_of_birth       DATE,
  address             TEXT,
  city                TEXT,
  country             TEXT,
  language_preference TEXT NOT NULL DEFAULT 'en',
  badge               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "students_own_select"
  ON students FOR SELECT
  USING (user_id = auth.uid() OR get_my_role() IN ('hq', 'school'));

CREATE POLICY "students_own_update"
  ON students FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "students_insert"
  ON students FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- SCHOOL_STUDENTS (enrollment)
-- ============================================================

CREATE TABLE IF NOT EXISTS school_students (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  free_lesson_used BOOLEAN NOT NULL DEFAULT false,
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id)
);

ALTER TABLE school_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_students_school_read"
  ON school_students FOR SELECT
  USING (
    school_id = get_my_school_id()
    OR get_my_role() = 'hq'
    OR student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "school_students_insert"
  ON school_students FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- TEACHERS
-- ============================================================

CREATE TABLE IF NOT EXISTS teachers (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT,
  address    TEXT,
  bio        TEXT,
  photo_url  TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teachers_read"
  ON teachers FOR SELECT
  USING (get_my_role() IN ('hq', 'school', 'teacher') OR user_id = auth.uid());

CREATE POLICY "teachers_school_write"
  ON teachers FOR ALL
  USING (get_my_role() IN ('hq', 'school'));

-- ============================================================
-- TEACHER_SCHOOLS
-- ============================================================

CREATE TABLE IF NOT EXISTS teacher_schools (
  teacher_id           UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  school_id            UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  compensation_plan_id UUID,
  active               BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (teacher_id, school_id)
);

ALTER TABLE teacher_schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teacher_schools_read"
  ON teacher_schools FOR SELECT
  USING (
    get_my_role() IN ('hq', 'school')
    OR school_id = get_my_school_id()
    OR teacher_id IN (SELECT id FROM teachers WHERE user_id = auth.uid())
  );

-- ============================================================
-- COMPENSATION PLANS
-- ============================================================

CREATE TABLE IF NOT EXISTS compensation_plans (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  base_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  bonus_threshold   INT,
  bonus_per_student NUMERIC(10,2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE compensation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compensation_plans_school"
  ON compensation_plans FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- COMPENSATION PLAN RATES (per lesson type)
-- ============================================================

CREATE TABLE IF NOT EXISTS compensation_plan_rates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id           UUID NOT NULL REFERENCES compensation_plans(id) ON DELETE CASCADE,
  lesson_type_id    UUID NOT NULL REFERENCES lesson_types(id) ON DELETE CASCADE,
  base_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  bonus_per_student NUMERIC(10,2),
  UNIQUE (plan_id, lesson_type_id)
);

ALTER TABLE compensation_plan_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comp_rates_school"
  ON compensation_plan_rates FOR ALL
  USING (
    plan_id IN (SELECT id FROM compensation_plans WHERE school_id = get_my_school_id())
    OR get_my_role() = 'hq'
  );

-- ============================================================
-- COURSES
-- ============================================================

CREATE TABLE IF NOT EXISTS courses (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id                UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  lesson_type_id           UUID REFERENCES lesson_types(id),
  teacher_id               UUID REFERENCES teachers(id),
  room_id                  UUID REFERENCES school_rooms(id),
  name                     TEXT NOT NULL DEFAULT '',
  description              TEXT,
  frequency                TEXT NOT NULL DEFAULT 'weekly',
  start_date               DATE,
  end_date                 DATE,
  start_time               TIME,
  duration_minutes         INT NOT NULL DEFAULT 60,
  max_capacity             INT NOT NULL DEFAULT 10,
  reserve_spots            INT NOT NULL DEFAULT 0,
  credit_cost              INT NOT NULL DEFAULT 1,
  color                    TEXT NOT NULL DEFAULT '#6B1F3A',
  vip_booking_hours_before INT NOT NULL DEFAULT 0,
  min_booking_notice_hours INT NOT NULL DEFAULT 2,
  waitlist_enabled         BOOLEAN NOT NULL DEFAULT false,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courses_school_read"
  ON courses FOR SELECT
  USING (school_id = get_my_school_id() OR get_my_role() IN ('hq', 'teacher', 'student'));

CREATE POLICY "courses_school_write"
  ON courses FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- LESSONS (individual instances)
-- ============================================================

CREATE TABLE IF NOT EXISTS lessons (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id        UUID REFERENCES courses(id) ON DELETE SET NULL,
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id       UUID REFERENCES teachers(id),
  room_id          UUID REFERENCES school_rooms(id),
  lesson_type_id   UUID REFERENCES lesson_types(id),
  date             DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  max_capacity     INT NOT NULL DEFAULT 10,
  current_bookings INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lessons_read_all"
  ON lessons FOR SELECT
  USING (true);

CREATE POLICY "lessons_school_write"
  ON lessons FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- PACKAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS packages (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id                UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name_it                  TEXT NOT NULL DEFAULT '',
  name_en                  TEXT NOT NULL DEFAULT '',
  name_fr                  TEXT NOT NULL DEFAULT '',
  name_es                  TEXT NOT NULL DEFAULT '',
  description_it           TEXT,
  description_en           TEXT,
  credits                  INT NOT NULL DEFAULT 10,
  validity_days            INT NOT NULL DEFAULT 90,
  price                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  lesson_type_restriction  TEXT NOT NULL DEFAULT 'all',
  stripe_product_id        TEXT,
  stripe_price_id          TEXT,
  color                    TEXT NOT NULL DEFAULT '#6B1F3A',
  is_popular               BOOLEAN NOT NULL DEFAULT false,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_read_active"
  ON packages FOR SELECT
  USING (active = true OR school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "packages_school_write"
  ON packages FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- SUBSCRIPTIONS CATALOG
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions_catalog (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id                UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name_it                  TEXT NOT NULL DEFAULT '',
  name_en                  TEXT NOT NULL DEFAULT '',
  name_fr                  TEXT NOT NULL DEFAULT '',
  name_es                  TEXT NOT NULL DEFAULT '',
  description_it           TEXT,
  description_en           TEXT,
  period_value             INT NOT NULL DEFAULT 1,
  period_unit              TEXT NOT NULL DEFAULT 'months',
  access_count             INT,
  lesson_type_restriction  TEXT NOT NULL DEFAULT 'all',
  price                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  auto_renewal             BOOLEAN NOT NULL DEFAULT true,
  is_vip                   BOOLEAN NOT NULL DEFAULT false,
  priority_booking_hours   INT NOT NULL DEFAULT 0,
  freeze_days_allowed      INT NOT NULL DEFAULT 0,
  stripe_product_id        TEXT,
  stripe_price_id          TEXT,
  color                    TEXT NOT NULL DEFAULT '#6B1F3A',
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_catalog_read"
  ON subscriptions_catalog FOR SELECT
  USING (active = true OR school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "subscriptions_catalog_school_write"
  ON subscriptions_catalog FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- STUDENT PACKAGES (owned)
-- ============================================================

CREATE TABLE IF NOT EXISTS student_packages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  package_id        UUID REFERENCES packages(id),
  credits_total     INT NOT NULL DEFAULT 0,
  credits_remaining INT NOT NULL DEFAULT 0,
  purchased_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  payment_method    TEXT NOT NULL DEFAULT 'stripe',
  stripe_payment_id TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_packages_own"
  ON student_packages FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() = 'hq'
  );

CREATE POLICY "student_packages_insert"
  ON student_packages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "student_packages_update"
  ON student_packages FOR UPDATE
  USING (
    school_id = get_my_school_id()
    OR get_my_role() = 'hq'
    OR student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

-- ============================================================
-- STUDENT SUBSCRIPTIONS (active)
-- ============================================================

CREATE TABLE IF NOT EXISTS student_subscriptions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id                UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id                 UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subscription_catalog_id   UUID REFERENCES subscriptions_catalog(id),
  access_total              INT,
  access_remaining          INT,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end        TIMESTAMPTZ,
  grace_period_ends_at      TIMESTAMPTZ,
  stripe_subscription_id    TEXT,
  status                    TEXT NOT NULL DEFAULT 'active',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_subscriptions_own"
  ON student_subscriptions FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() = 'hq'
  );

CREATE POLICY "student_subscriptions_insert"
  ON student_subscriptions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "student_subscriptions_update"
  ON student_subscriptions FOR UPDATE
  USING (
    school_id = get_my_school_id()
    OR get_my_role() = 'hq'
    OR student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

-- ============================================================
-- BOOKINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS bookings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id              UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lesson_id               UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  school_id               UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  access_source           TEXT NOT NULL DEFAULT 'package',
  student_package_id      UUID REFERENCES student_packages(id),
  student_subscription_id UUID REFERENCES student_subscriptions(id),
  credits_deducted        INT NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'confirmed',
  cancelled_at            TIMESTAMPTZ,
  cancellation_type       TEXT,
  credit_refunded         BOOLEAN NOT NULL DEFAULT false,
  booked_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_student_own"
  ON bookings FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() IN ('hq', 'teacher')
  );

CREATE POLICY "bookings_student_insert"
  ON bookings FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "bookings_update"
  ON bookings FOR UPDATE
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() IN ('hq', 'teacher')
  );

-- ============================================================
-- ATTENDANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id),
  status     TEXT NOT NULL DEFAULT 'present',
  marked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, student_id)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_read"
  ON attendance FOR SELECT
  USING (
    get_my_role() IN ('hq', 'school', 'teacher')
    OR student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "attendance_teacher_write"
  ON attendance FOR ALL
  USING (get_my_role() IN ('hq', 'school', 'teacher'));

-- ============================================================
-- TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id           UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id          UUID REFERENCES students(id),
  type                TEXT NOT NULL DEFAULT 'package',
  product_id          UUID,
  product_name        TEXT,
  amount              NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'eur',
  platform_fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
  school_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL DEFAULT 'stripe',
  stripe_payment_id   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  invoice_url         TEXT,
  referral_school_id  UUID REFERENCES schools(id),
  referral_commission NUMERIC(10,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_school_read"
  ON transactions FOR SELECT
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "transactions_insert"
  ON transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "transactions_update"
  ON transactions FOR UPDATE
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- STUDENT DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS student_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'medical_cert',
  file_url      TEXT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'valid',
  validated_by  UUID REFERENCES profiles(id),
  validated_at  TIMESTAMPTZ
);

ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_documents_own"
  ON student_documents FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() = 'hq'
  );

CREATE POLICY "student_documents_insert"
  ON student_documents FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() = 'hq'
  );

CREATE POLICY "student_documents_update"
  ON student_documents FOR UPDATE
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- DISCOUNT CODES
-- ============================================================

CREATE TABLE IF NOT EXISTS discount_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'percentage',
  value         NUMERIC(10,2) NOT NULL DEFAULT 0,
  minimum_order NUMERIC(10,2),
  valid_for     TEXT NOT NULL DEFAULT 'all',
  expires_at    TIMESTAMPTZ,
  active        BOOLEAN NOT NULL DEFAULT true,
  usage_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, code)
);

ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discount_codes_school"
  ON discount_codes FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "discount_codes_student_read"
  ON discount_codes FOR SELECT
  USING (active = true);

-- ============================================================
-- CONVERSATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type              TEXT NOT NULL DEFAULT 'school_student',
  hq_id             UUID REFERENCES auth.users(id),
  school_id         UUID REFERENCES schools(id) ON DELETE CASCADE,
  student_id        UUID REFERENCES students(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'open',
  priority          TEXT NOT NULL DEFAULT 'medium',
  assigned_to       UUID REFERENCES profiles(id),
  tags              TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,
  last_message_at   TIMESTAMPTZ
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_hq"
  ON conversations FOR ALL
  USING (get_my_role() = 'hq' AND type = 'hq_school');

CREATE POLICY "conversations_school"
  ON conversations FOR ALL
  USING (school_id = get_my_school_id());

CREATE POLICY "conversations_student"
  ON conversations FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

CREATE POLICY "conversations_student_insert"
  ON conversations FOR INSERT
  WITH CHECK (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
  );

-- ============================================================
-- MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  sender_role     TEXT NOT NULL DEFAULT 'student',
  content         TEXT NOT NULL DEFAULT '',
  is_internal     BOOLEAN NOT NULL DEFAULT false,
  attachment_url  TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_conversation_access"
  ON messages FOR SELECT
  USING (
    -- Check conversation access
    conversation_id IN (
      SELECT id FROM conversations
      WHERE school_id = get_my_school_id()
         OR get_my_role() = 'hq'
         OR student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    )
    -- Students cannot see internal notes
    AND (is_internal = false OR get_my_role() IN ('hq', 'school'))
  );

CREATE POLICY "messages_insert"
  ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "messages_update_read"
  ON messages FOR UPDATE
  USING (sender_id != auth.uid()); -- Only others can mark as read

-- ============================================================
-- QUICK REPLY TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS quick_reply_templates (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  content   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE quick_reply_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quick_replies_school"
  ON quick_reply_templates FOR ALL
  USING (school_id = get_my_school_id());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_role  TEXT NOT NULL DEFAULT 'student',
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_own"
  ON notifications FOR ALL
  USING (user_id = auth.uid() OR get_my_role() = 'hq');

-- ============================================================
-- LIBRARY CONTENT (Metodo Library)
-- ============================================================

CREATE TABLE IF NOT EXISTS library_content (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id               UUID REFERENCES schools(id) ON DELETE CASCADE,
  lesson_type_id          UUID REFERENCES lesson_types(id),
  title_it                TEXT NOT NULL DEFAULT '',
  title_en                TEXT NOT NULL DEFAULT '',
  title_fr                TEXT NOT NULL DEFAULT '',
  title_es                TEXT NOT NULL DEFAULT '',
  description             TEXT,
  file_url                TEXT,
  thumbnail_url           TEXT,
  type                    TEXT NOT NULL DEFAULT 'video',
  duration_seconds        INT,
  level                   TEXT,
  language                TEXT NOT NULL DEFAULT 'en',
  visible_to_students     BOOLEAN NOT NULL DEFAULT false,
  student_access          TEXT NOT NULL DEFAULT 'included',
  price                   NUMERIC(10,2),
  stripe_product_id       TEXT,
  restricted_to_school_ids UUID[],
  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE library_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library_hq_all"
  ON library_content FOR ALL
  USING (get_my_role() = 'hq');

CREATE POLICY "library_school_read"
  ON library_content FOR SELECT
  USING (
    school_id = get_my_school_id()
    OR (
      school_id IS NULL
      AND (
        restricted_to_school_ids IS NULL
        OR get_my_school_id() = ANY(restricted_to_school_ids)
      )
    )
  );

-- ============================================================
-- VIDEO PROGRESS
-- ============================================================

CREATE TABLE IF NOT EXISTS video_progress (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id       UUID NOT NULL REFERENCES library_content(id) ON DELETE CASCADE,
  progress_seconds INT NOT NULL DEFAULT 0,
  completed        BOOLEAN NOT NULL DEFAULT false,
  last_watched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content_id)
);

ALTER TABLE video_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "video_progress_own"
  ON video_progress FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- SHOP PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS shop_products (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id         UUID REFERENCES schools(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'accessories',
  price             NUMERIC(10,2) NOT NULL DEFAULT 0,
  images            TEXT[],
  stripe_product_id TEXT,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shop_products_read"
  ON shop_products FOR SELECT
  USING (active = true);

CREATE POLICY "shop_products_write"
  ON shop_products FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- ============================================================
-- SHOP ORDERS
-- ============================================================

CREATE TABLE IF NOT EXISTS shop_orders (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id         UUID REFERENCES students(id),
  school_id          UUID REFERENCES schools(id),
  items              JSONB NOT NULL DEFAULT '[]',
  subtotal           NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  referral_school_id UUID REFERENCES schools(id),
  referral_discount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total              NUMERIC(10,2) NOT NULL DEFAULT 0,
  stripe_payment_id  TEXT,
  status             TEXT NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shop_orders_own"
  ON shop_orders FOR SELECT
  USING (
    student_id IN (SELECT id FROM students WHERE user_id = auth.uid())
    OR school_id = get_my_school_id()
    OR get_my_role() = 'hq'
  );

CREATE POLICY "shop_orders_insert"
  ON shop_orders FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- SCHOOL CLOSURES
-- ============================================================

CREATE TABLE IF NOT EXISTS school_closures (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  type      TEXT NOT NULL DEFAULT 'full_day',
  from_time TIME,
  notes     TEXT,
  UNIQUE (school_id, date)
);

ALTER TABLE school_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "school_closures_school"
  ON school_closures FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq');

CREATE POLICY "school_closures_read"
  ON school_closures FOR SELECT
  USING (true);

-- ============================================================
-- EMAIL TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID REFERENCES schools(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  language     TEXT NOT NULL DEFAULT 'en',
  subject      TEXT NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, template_key, language)
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_school"
  ON email_templates FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq' OR school_id IS NULL);

-- ============================================================
-- HELPER: increment discount code usage
-- ============================================================

CREATE OR REPLACE FUNCTION increment_discount_usage(code_id UUID)
RETURNS void AS $$
  UPDATE discount_codes SET usage_count = usage_count + 1 WHERE id = code_id;
$$ LANGUAGE SQL SECURITY DEFINER;

-- ============================================================
-- REALTIME: enable on key tables
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE lessons;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
