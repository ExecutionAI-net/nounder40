-- Schema↔code audit: tables and columns the app references but were never
-- migrated. Each item below caused a live 500/silent failure.

-- 1. schools — cancellation policy broke /api/student/lessons (students saw
--    NO lessons at all), settings page, booking cancellation
ALTER TABLE schools ADD COLUMN IF NOT EXISTS cancellation_policy_hours INT NOT NULL DEFAULT 24;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS free_first_lesson BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS min_booking_notice_hours INT NOT NULL DEFAULT 2;

-- 2. profiles.city — student book/dashboard read it
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city TEXT;

-- 3. school_closures.end_date — calendar + settings
ALTER TABLE school_closures ADD COLUMN IF NOT EXISTS end_date DATE;

-- 4. compensation_plans.bonus_max_threshold
ALTER TABLE compensation_plans ADD COLUMN IF NOT EXISTS bonus_max_threshold NUMERIC;

-- 5. attendance statuses (School > Settings > Statuses + attendance flow)
CREATE TABLE IF NOT EXISTS attendance_statuses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,
  burns_credit BOOLEAN NOT NULL DEFAULT false,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE attendance_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attendance_statuses_school" ON attendance_statuses;
CREATE POLICY "attendance_statuses_school" ON attendance_statuses FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq')
  WITH CHECK (school_id = get_my_school_id() OR get_my_role() = 'hq');

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status_id UUID REFERENCES attendance_statuses(id) ON DELETE SET NULL;

-- 6. email_templates — code uses key/locale (schema had template_key/language)
ALTER TABLE email_templates RENAME COLUMN template_key TO key;
ALTER TABLE email_templates RENAME COLUMN language TO locale;
CREATE UNIQUE INDEX IF NOT EXISTS email_templates_key_locale ON email_templates (key, locale);

-- 7. email_settings (HQ email on/off switches)
CREATE TABLE IF NOT EXISTS email_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_settings_read" ON email_settings;
CREATE POLICY "email_settings_read" ON email_settings FOR SELECT USING (true);

-- 8. manual credit grants log (School > Credits)
CREATE TABLE IF NOT EXISTS manual_credit_grants (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id      UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  package_id     UUID REFERENCES student_packages(id) ON DELETE SET NULL,
  package_name   TEXT,
  granted_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  amount         INT NOT NULL,
  reason         TEXT,
  note           TEXT,
  price          NUMERIC,
  payment_method TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE manual_credit_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manual_credit_grants_school" ON manual_credit_grants;
CREATE POLICY "manual_credit_grants_school" ON manual_credit_grants FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq')
  WITH CHECK (school_id = get_my_school_id() OR get_my_role() = 'hq');

-- 9. teacher compensation payments (School > Compensation)
CREATE TABLE IF NOT EXISTS teacher_compensation_payments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  month      TEXT NOT NULL, -- 'YYYY-MM'
  amount     NUMERIC NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending',
  paid_at    TIMESTAMPTZ,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_id, month)
);
ALTER TABLE teacher_compensation_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "teacher_comp_payments_school" ON teacher_compensation_payments;
CREATE POLICY "teacher_comp_payments_school" ON teacher_compensation_payments FOR ALL
  USING (school_id = get_my_school_id() OR get_my_role() = 'hq')
  WITH CHECK (school_id = get_my_school_id() OR get_my_role() = 'hq');
DROP POLICY IF EXISTS "teacher_comp_payments_teacher_read" ON teacher_compensation_payments;
CREATE POLICY "teacher_comp_payments_teacher_read" ON teacher_compensation_payments FOR SELECT
  USING (teacher_id IN (SELECT id FROM teachers WHERE user_id = auth.uid()));

-- 10. library_content multilingual titles (code writes title_it/en/fr/es)
ALTER TABLE library_content ADD COLUMN IF NOT EXISTS title_it TEXT;
ALTER TABLE library_content ADD COLUMN IF NOT EXISTS title_en TEXT;
ALTER TABLE library_content ADD COLUMN IF NOT EXISTS title_fr TEXT;
ALTER TABLE library_content ADD COLUMN IF NOT EXISTS title_es TEXT;

-- 11. course image shown to students when booking
ALTER TABLE courses ADD COLUMN IF NOT EXISTS image_url TEXT;
