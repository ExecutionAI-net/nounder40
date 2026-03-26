-- Platform settings for landing page
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (key, value) VALUES
  ('stat_teachers',        '20'),
  ('stat_students',        '249'),
  ('stat_lessons_monthly', '950'),
  ('stat_schools',         '3')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_settings_public_read" ON platform_settings;
DROP POLICY IF EXISTS "platform_settings_hq_write"   ON platform_settings;

CREATE POLICY "platform_settings_public_read" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_hq_write"    ON platform_settings FOR ALL    USING (get_my_role() = 'hq');
