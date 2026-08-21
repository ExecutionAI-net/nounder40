-- Connected sample graph in the FINAL Supabase schema, to exercise every
-- tricky ETL path: the auth.users+profiles join & password mapping, id→user_id,
-- the _id-strip FK fallback (assigned_to/validated_by/invited_by), composite
-- auto-id link tables, JSONB (files/badges/data), UUID[] & TEXT[] arrays, and
-- the cyclic schools.user_id ↔ profiles.school_id ownership pair.

-- The auto-profile trigger from migration 001 would fight our explicit inserts.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 1) auth.users (login side). student has NO password (OAuth-only).
INSERT INTO auth.users (id, email, encrypted_password, created_at, last_sign_in_at) VALUES
 ('11111111-1111-1111-1111-111111111111','hq@nou40.test',     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy','2026-01-01T09:00:00Z','2026-08-01T09:00:00Z'),
 ('22222222-2222-2222-2222-222222222222','school@nou40.test', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy','2026-01-02T09:00:00Z',NULL),
 ('33333333-3333-3333-3333-333333333333','student@nou40.test', NULL,                                                        '2026-01-03T09:00:00Z','2026-08-10T09:00:00Z'),
 ('44444444-4444-4444-4444-444444444444','teacher@nou40.test','$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy','2026-01-04T09:00:00Z',NULL);

-- 2) schools (owner = school user via user_id) — insert before profiles(school).
INSERT INTO schools (id, name, slug, email, user_id, city, country, active, website) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','No Under 40 Milano','nou40-milano','milano@nou40.test','22222222-2222-2222-2222-222222222222','Milano','Italy',true,'https://milano.nou40.test');

-- 3) profiles (profile side). school user carries the active school_id.
INSERT INTO profiles (id, email, name, role, hq_sub_role, school_sub_role, school_id, language_preference, roles, phone, city) VALUES
 ('11111111-1111-1111-1111-111111111111','hq@nou40.test',     'HQ Admin',     'hq',     'super_admin', NULL,   NULL,                                    'en', ARRAY['hq'],     '+390200000001','Milano'),
 ('22222222-2222-2222-2222-222222222222','school@nou40.test', 'School Owner', 'school', NULL,          'admin','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  'it', ARRAY['school'], '+390200000002','Milano'),
 ('33333333-3333-3333-3333-333333333333','student@nou40.test','Bea Student',  'student',NULL,          NULL,   NULL,                                    'it', ARRAY['student'],'+390200000003','Roma'),
 ('44444444-4444-4444-4444-444444444444','teacher@nou40.test','Teo Teacher',  'teacher',NULL,          NULL,   NULL,                                    'it', ARRAY['teacher'],'+390200000004','Milano');

-- 4) hq_members (PK id references profiles.id → becomes user_id in Django)
INSERT INTO hq_members (id, email, name, sub_role, active) VALUES
 ('11111111-1111-1111-1111-111111111111','hq@nou40.test','HQ Admin','super_admin',true);

-- 5) school_memberships (composite PK, no surrogate id)
INSERT INTO school_memberships (profile_id, school_id, sub_role) VALUES
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','admin');

-- 6) locations, rooms, doc type
INSERT INTO school_locations (id, school_id, name, address) VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Sede Centrale','Via Roma 1, Milano');
INSERT INTO school_rooms (id, location_id, name, capacity) VALUES
 ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Sala A',20);
INSERT INTO school_document_types (id, school_id, code, name, variants, has_expiry, required, sort_order) VALUES
 ('d0000000-0000-0000-0000-0000000000d1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','medical_cert','Certificato medico', ARRAY[]::text[], true, true, 1);

-- 7) lesson type, teacher, comp plan, teacher_schools (composite)
INSERT INTO lesson_types (id, code, name_it, name_en, active) VALUES
 ('dddddddd-dddd-dddd-dddd-dddddddddddd','classical','Classica','Classical',true);
INSERT INTO teachers (id, user_id, name, email, active) VALUES
 ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','44444444-4444-4444-4444-444444444444','Teo Teacher','teacher@nou40.test',true);
INSERT INTO compensation_plans (id, school_id, name, base_fee, bonus_threshold, bonus_per_student) VALUES
 ('c0000000-0000-0000-0000-0000000000c1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Base Plan',30,5,2);
INSERT INTO teacher_schools (teacher_id, school_id, compensation_plan_id, active) VALUES
 ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c0000000-0000-0000-0000-0000000000c1',true);

-- 8) course, lesson
INSERT INTO courses (id, school_id, lesson_type_id, teacher_id, room_id, name, frequency, credit_cost, max_capacity, start_time, duration_minutes) VALUES
 ('ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cccccccc-cccc-cccc-cccc-cccccccccccc','Classica Adulti','weekly',1,20,'18:00',60);
INSERT INTO lessons (id, course_id, school_id, teacher_id, room_id, lesson_type_id, date, start_time, end_time, max_capacity, current_bookings, status) VALUES
 ('00000000-0000-0000-0000-00000000a001','ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cccccccc-cccc-cccc-cccc-cccccccccccc','dddddddd-dddd-dddd-dddd-dddddddddddd','2026-09-01','18:00','19:00',20,1,'scheduled');

-- 9) package, student, enrollment, student package, booking
INSERT INTO packages (id, school_id, name_it, name_en, credits, validity_days, price, lesson_type_restriction, active) VALUES
 ('00000000-0000-0000-0000-0000000000c1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Pacchetto 10','10 Pack',10,90,100,'all',true);
INSERT INTO students (id, user_id, name, email, school_id, city) VALUES
 ('00000000-0000-0000-0000-0000000000b1','33333333-3333-3333-3333-333333333333','Bea Student','student@nou40.test','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Roma');
INSERT INTO school_students (id, school_id, student_id, free_lesson_used) VALUES
 ('00000000-0000-0000-0000-0000000000b2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1',false);
INSERT INTO student_packages (id, student_id, school_id, package_id, credits_total, credits_remaining, status, payment_method) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000c1',10,9,'active','stripe');
INSERT INTO bookings (id, student_id, lesson_id, school_id, access_source, student_package_id, credits_deducted, status) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000a001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','package','00000000-0000-0000-0000-0000000000d1',1,'confirmed');

-- 10) chat: conversation (assigned_to → hq, no _id suffix), message (sender_id)
INSERT INTO conversations (id, type, school_id, student_id, status, priority, assigned_to, tags) VALUES
 ('00000000-0000-0000-0000-0000000000f1','school_student','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-0000000000b1','open','medium','11111111-1111-1111-1111-111111111111', ARRAY['support']);
INSERT INTO messages (id, conversation_id, sender_id, sender_role, content, is_internal) VALUES
 ('00000000-0000-0000-0000-00000000a1a1','00000000-0000-0000-0000-0000000000f1','33333333-3333-3333-3333-333333333333','student','Ciao, vorrei informazioni',false);

-- 11) student document (validated_by → school, no _id suffix; files JSONB, type_id)
INSERT INTO student_documents (id, student_id, school_id, type, type_id, status, validated_by, files, variant, note) VALUES
 ('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000b1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','medical_cert','d0000000-0000-0000-0000-0000000000d1','valid','22222222-2222-2222-2222-222222222222',
  '[{"path":"documents/2026/cert.pdf","name":"cert.pdf","mime":"application/pdf","size":10234}]'::jsonb, NULL, 'ok');

-- 12) library content (school NULL = HQ, restricted_to_school_ids UUID[])
INSERT INTO library_content (id, school_id, lesson_type_id, title_it, title_en, type, language, visible_to_students, student_access, restricted_to_school_ids, active) VALUES
 ('00000000-0000-0000-0000-0000000000c2', NULL,'dddddddd-dddd-dddd-dddd-dddddddddddd','Sbarra base','Barre basics','video','en',true,'included', ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], true);

-- 13) shop product (TEXT[] arrays + badges JSONB) + variant
INSERT INTO shop_products (id, school_id, name, category, price, images, colors, sizes, badges, active) VALUES
 ('00000000-0000-0000-0000-0000000000d2', NULL,'Body Danza','clothing',25, ARRAY['a.jpg','b.jpg'], ARRAY['black','white'], ARRAY['S','M','L'], '[{"text":"New","color":"#0f0"}]'::jsonb, true);
INSERT INTO shop_product_variants (id, product_id, size, color, stock, sold) VALUES
 ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000d2','M','black',100,3);

-- 14) pending invitation (invited_by → hq, no _id suffix)
INSERT INTO pending_invitations (id, type, name, email, school_id, invited_by) VALUES
 ('00000000-0000-0000-0000-0000000000f2','school_teacher','New Teacher','newteacher@nou40.test','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111');

-- 15) notification (data JSONB)
INSERT INTO notifications (id, user_id, user_role, type, title, body, data) VALUES
 ('00000000-0000-0000-0000-00000000aa01','33333333-3333-3333-3333-333333333333','student','booking_confirmed','Prenotazione confermata','La tua lezione è prenotata','{"lesson_id":"00000000-0000-0000-0000-00000000a001"}'::jsonb);

-- 16) translations (composite PK, no id) + email template + email setting
INSERT INTO translations (key, locale, value) VALUES
 ('landing.title','en','No Under 40'),
 ('landing.title','it','No Under 40');
INSERT INTO email_templates (id, school_id, key, locale, subject, body_html) VALUES
 ('00000000-0000-0000-0000-00000000ee01', NULL,'welcome','en','Welcome','<p>Hi {{user_name}}</p>');
INSERT INTO email_settings (key, value) VALUES ('welcome_enabled','true');
