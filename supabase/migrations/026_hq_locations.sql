-- HQ-managed countries
CREATE TABLE IF NOT EXISTS hq_countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HQ-managed cities, linked to a country
CREATE TABLE IF NOT EXISTS hq_cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES hq_countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read access (schools, students, booking page)
ALTER TABLE hq_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq_cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hq_countries_public_read" ON hq_countries
  FOR SELECT USING (true);

CREATE POLICY "hq_cities_public_read" ON hq_cities
  FOR SELECT USING (true);

-- HQ users can insert/update/delete
CREATE POLICY "hq_countries_hq_write" ON hq_countries
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'hq'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'hq'));

CREATE POLICY "hq_cities_hq_write" ON hq_cities
  FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'hq'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'hq'));
