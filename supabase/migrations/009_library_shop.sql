-- Phase 9: Metodo Library & Shop

-- Library content
CREATE TABLE IF NOT EXISTS library_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE, -- null = HQ content
  lesson_type_id UUID REFERENCES lesson_types(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  type TEXT NOT NULL CHECK (type IN ('video', 'pdf')),
  duration_seconds INTEGER,
  level TEXT CHECK (level IN ('entry', 'intermediate', 'advanced', 'all')) DEFAULT 'all',
  language TEXT DEFAULT 'en',
  visible_to_students BOOLEAN NOT NULL DEFAULT false,
  student_access TEXT CHECK (student_access IN ('included', 'paid')) DEFAULT 'included',
  price NUMERIC(10,2),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Video progress tracking
CREATE TABLE IF NOT EXISTS video_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES library_content(id) ON DELETE CASCADE,
  progress_seconds INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

-- Shop products
CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE, -- null = HQ product
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  price NUMERIC(10,2) NOT NULL,
  images TEXT[] DEFAULT '{}',
  stripe_product_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Shop orders
CREATE TABLE IF NOT EXISTS shop_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES auth.users(id),
  school_id UUID REFERENCES schools(id),
  items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  stripe_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE library_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library_hq_all" ON library_content FOR ALL USING (get_my_role() = 'hq');
CREATE POLICY "library_school_own" ON library_content FOR ALL USING (school_id = get_my_school_id() AND get_my_role() = 'school');
CREATE POLICY "library_read_active" ON library_content FOR SELECT USING (active = true AND (school_id IS NULL OR school_id = get_my_school_id()));
CREATE POLICY "progress_own" ON video_progress FOR ALL USING (user_id = auth.uid());
CREATE POLICY "shop_products_read" ON shop_products FOR SELECT USING (active = true);
CREATE POLICY "shop_products_hq_all" ON shop_products FOR ALL USING (get_my_role() = 'hq');
CREATE POLICY "shop_products_school_own" ON shop_products FOR ALL USING (school_id = get_my_school_id() AND get_my_role() = 'school');
CREATE POLICY "shop_orders_own" ON shop_orders FOR ALL USING (student_id = auth.uid());
CREATE POLICY "shop_orders_school" ON shop_orders FOR SELECT USING (school_id = get_my_school_id() AND get_my_role() = 'school');
CREATE POLICY "shop_orders_hq" ON shop_orders FOR SELECT USING (get_my_role() = 'hq');
