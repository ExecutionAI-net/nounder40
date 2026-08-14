-- Translations table for next-intl (dynamic, DB-driven UI copy)
CREATE TABLE IF NOT EXISTS translations (
  key        TEXT NOT NULL,
  locale     TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, locale)
);

ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translations_read_all" ON translations;
DROP POLICY IF EXISTS "translations_hq_write" ON translations;
CREATE POLICY "translations_read_all" ON translations FOR SELECT USING (true);
CREATE POLICY "translations_hq_write" ON translations FOR ALL USING (get_my_role() = 'hq');
