-- Development-only multi-tenant fixture data. These rows are historical data:
-- this file does not send messages, call providers, invoke AI, or run automation.

BEGIN;

INSERT INTO public.institutions (id, name, code, status) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Northstar Institute of Technology', 'northstar', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'Riverside College of Engineering', 'riverside', 'active')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, code = EXCLUDED.code, status = EXCLUDED.status,
  updated_at = timezone('utc', now());

INSERT INTO public.profiles (id, name, email, role, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Aditi Menon', 'aditi.menon@northstar.attendai.test', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'Dr. Meera Rao', 'meera.rao@northstar.attendai.test', 'faculty', 'active'),
  ('00000000-0000-4000-8000-000000000003', 'Anitha N', 'anitha.n@northstar.attendai.test', 'staff', 'active'),
  ('00000000-0000-4000-8000-000000000004', 'Aarav Reddy', 'aarav.reddy@northstar.attendai.test', 'student', 'active'),
  ('01000000-0000-4000-8000-000000000001', 'Kabir Singh', 'kabir.singh@riverside.attendai.test', 'admin', 'active'),
  ('01000000-0000-4000-8000-000000000002', 'Prof. Leela Das', 'leela.das@riverside.attendai.test', 'faculty', 'active'),
  ('01000000-0000-4000-8000-000000000003', 'Diya Shah', 'diya.shah@riverside.attendai.test', 'student', 'active')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
  status = EXCLUDED.status, updated_at = timezone('utc', now());

INSERT INTO public.profile_institutions (profile_id, institution_id, status) VALUES
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'active'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'active'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'active'),
  ('00000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'active'),
  ('01000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'active'),
  ('01000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'active'),
  ('01000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'active')
ON CONFLICT (profile_id, institution_id) DO UPDATE SET
  status = EXCLUDED.status, updated_at = timezone('utc', now());

INSERT INTO public.profile_roles (profile_id, institution_id, role_code) VALUES
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'admin'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'faculty'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'staff'),
  ('00000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'student'),
  ('01000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'admin'),
  ('01000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'faculty'),
  ('01000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'student')
ON CONFLICT (profile_id, institution_id, role_code) DO NOTHING;

-- Both tenants intentionally use the same class identity, admission number,
-- and employee code to verify that business uniqueness is tenant scoped.
INSERT INTO public.classes (id, institution_id, name, section, full_name, academic_year, active) VALUES
  ('20000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'B.Tech CSE', 'A', 'B.Tech CSE - A', '2026-2027', true),
  ('20000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'B.Tech ECE', 'A', 'B.Tech ECE - A', '2026-2027', true),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'B.Tech CSE', 'A', 'B.Tech CSE - A', '2026-2027', true)
ON CONFLICT (id) DO UPDATE SET
  institution_id = EXCLUDED.institution_id, name = EXCLUDED.name,
  section = EXCLUDED.section, full_name = EXCLUDED.full_name,
  academic_year = EXCLUDED.academic_year, active = EXCLUDED.active,
  updated_at = timezone('utc', now());

INSERT INTO public.parents (id, institution_id, name, phone, email, language, preferred_channel, active, communication_consent, communication_consent_updated_at) VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Lakshmi Reddy', '+91 98765 01001', 'lakshmi@northstar.attendai.test', 'te', 'sms', true, true, timezone('utc', now())),
  ('30000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Srinivas Kumar', '+91 98765 01002', 'srinivas@northstar.attendai.test', 'en', 'whatsapp', true, true, timezone('utc', now())),
  ('31000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Maya Shah', '+91 98765 02001', 'maya@riverside.attendai.test', 'hi', 'sms', true, true, timezone('utc', now()))
ON CONFLICT (id) DO UPDATE SET
  institution_id = EXCLUDED.institution_id, name = EXCLUDED.name,
  phone = EXCLUDED.phone, email = EXCLUDED.email, language = EXCLUDED.language,
  preferred_channel = EXCLUDED.preferred_channel, active = EXCLUDED.active,
  communication_consent = EXCLUDED.communication_consent,
  communication_consent_updated_at = EXCLUDED.communication_consent_updated_at,
  updated_at = timezone('utc', now());

INSERT INTO public.students (
  id, institution_id, parent_id, class_id, name, roll, admission_number,
  attendance_rate, consecutive_absences, status, risk, enrollment_status
) VALUES
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Aarav Reddy', 'CSE-A-01', 'ATD-2026-001', 68.50, 3, 'absent', 'high', 'active'),
  ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Nisha Kumar', 'CSE-A-02', 'ATD-2026-002', 88.00, 0, 'present', 'low', 'active'),
  ('11000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Diya Shah', 'CSE-A-01', 'ATD-2026-001', 72.00, 2, 'late', 'medium', 'active')
ON CONFLICT (id) DO UPDATE SET
  institution_id = EXCLUDED.institution_id, parent_id = EXCLUDED.parent_id,
  class_id = EXCLUDED.class_id, name = EXCLUDED.name, roll = EXCLUDED.roll,
  admission_number = EXCLUDED.admission_number,
  attendance_rate = EXCLUDED.attendance_rate,
  consecutive_absences = EXCLUDED.consecutive_absences,
  status = EXCLUDED.status, risk = EXCLUDED.risk,
  enrollment_status = EXCLUDED.enrollment_status,
  updated_at = timezone('utc', now());

UPDATE public.profiles SET student_id = '10000000-0000-4000-8000-000000000001'
WHERE id = '00000000-0000-4000-8000-000000000004';
UPDATE public.profiles SET student_id = '11000000-0000-4000-8000-000000000001'
WHERE id = '01000000-0000-4000-8000-000000000003';

INSERT INTO public.student_parents (
  student_id, parent_id, relationship, is_primary, receives_notifications
) VALUES
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'mother', true, true),
  ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'father', true, true),
  ('11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'mother', true, true)
ON CONFLICT (student_id, parent_id) DO UPDATE SET
  relationship = EXCLUDED.relationship, is_primary = EXCLUDED.is_primary,
  receives_notifications = EXCLUDED.receives_notifications,
  updated_at = timezone('utc', now());

INSERT INTO public.faculty (
  id, institution_id, user_id, department, role, employee_code, active
) VALUES
  ('40000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002', 'Computer Science', 'professor', 'EMP-CSE-001', true),
  ('41000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '01000000-0000-4000-8000-000000000002', 'Computer Science', 'professor', 'EMP-CSE-001', true)
ON CONFLICT (id) DO UPDATE SET
  institution_id = EXCLUDED.institution_id, user_id = EXCLUDED.user_id,
  department = EXCLUDED.department, role = EXCLUDED.role,
  employee_code = EXCLUDED.employee_code, active = EXCLUDED.active,
  updated_at = timezone('utc', now());

INSERT INTO public.class_faculty (id, faculty_id, class_id) VALUES
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('51000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET
  faculty_id = EXCLUDED.faculty_id, class_id = EXCLUDED.class_id,
  updated_at = timezone('utc', now());

INSERT INTO public.attendance_sessions (
  id, class_id, date, method, total_present, total_absent, total_late,
  submitted_by, submitted_at, status
) VALUES
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', DATE '2026-09-08', 'faculty', 1, 1, 0, '00000000-0000-4000-8000-000000000002', '2026-09-08T09:15:00Z', 'submitted'),
  ('61000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', DATE '2026-09-08', 'faculty', 0, 0, 1, '01000000-0000-4000-8000-000000000002', '2026-09-08T09:20:00Z', 'submitted')
ON CONFLICT (id) DO UPDATE SET
  class_id = EXCLUDED.class_id, date = EXCLUDED.date, method = EXCLUDED.method,
  total_present = EXCLUDED.total_present, total_absent = EXCLUDED.total_absent,
  total_late = EXCLUDED.total_late, submitted_by = EXCLUDED.submitted_by,
  submitted_at = EXCLUDED.submitted_at, status = EXCLUDED.status,
  updated_at = timezone('utc', now());

INSERT INTO public.attendance_records (id, session_id, student_id, status) VALUES
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'absent'),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'present'),
  ('71000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'late')
ON CONFLICT (id) DO UPDATE SET
  session_id = EXCLUDED.session_id, student_id = EXCLUDED.student_id,
  status = EXCLUDED.status, updated_at = timezone('utc', now());

INSERT INTO public.qr_sessions (
  id, class_id, faculty_id, date, expires_at, active
) VALUES
  ('72000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', DATE '2026-09-08', '2026-09-08T09:15:00Z', false),
  ('73000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '01000000-0000-4000-8000-000000000002', DATE '2026-09-08', '2026-09-08T09:20:00Z', false)
ON CONFLICT (id) DO UPDATE SET
  class_id = EXCLUDED.class_id, faculty_id = EXCLUDED.faculty_id,
  date = EXCLUDED.date, expires_at = EXCLUDED.expires_at,
  active = EXCLUDED.active, updated_at = timezone('utc', now());

INSERT INTO public.qr_check_ins (
  id, session_id, student_id, timestamp, status
) VALUES
  ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '2026-09-08T09:10:00Z', 'valid'),
  ('75000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '2026-09-08T09:15:00Z', 'valid')
ON CONFLICT (id) DO UPDATE SET
  session_id = EXCLUDED.session_id, student_id = EXCLUDED.student_id,
  timestamp = EXCLUDED.timestamp, status = EXCLUDED.status,
  updated_at = timezone('utc', now());

INSERT INTO public.communications (
  id, student_id, parent_id, type, direction, message_status, body,
  parent_phone, provider_name, metadata, created_at
) VALUES
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'sms', 'outbound', 'delivered', 'Historical attendance notification.', '+91 98765 01001', 'seed-data', '{"purpose":"absence-alert"}'::jsonb, '2026-09-08T10:00:00Z'),
  ('81000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'sms', 'outbound', 'delivered', 'Historical attendance notification.', '+91 98765 02001', 'seed-data', '{"purpose":"late-alert"}'::jsonb, '2026-09-08T10:05:00Z')
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id, parent_id = EXCLUDED.parent_id,
  type = EXCLUDED.type, direction = EXCLUDED.direction,
  message_status = EXCLUDED.message_status, body = EXCLUDED.body,
  parent_phone = EXCLUDED.parent_phone, provider_name = EXCLUDED.provider_name,
  metadata = EXCLUDED.metadata, created_at = EXCLUDED.created_at,
  updated_at = timezone('utc', now());

INSERT INTO public.interventions (
  id, student_id, risk_level, reason, status, priority, action_taken,
  owner_id, communication_id, due_at
) VALUES
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'high', 'Three consecutive absences require follow-up.', 'in-progress', 'high', 'Guardian notified.', '00000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', '2026-09-12T12:00:00Z'),
  ('91000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'medium', 'Two recent attendance exceptions require review.', 'pending', 'medium', NULL, '01000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '2026-09-13T12:00:00Z')
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id, risk_level = EXCLUDED.risk_level,
  reason = EXCLUDED.reason, status = EXCLUDED.status,
  priority = EXCLUDED.priority, action_taken = EXCLUDED.action_taken,
  owner_id = EXCLUDED.owner_id, communication_id = EXCLUDED.communication_id,
  due_at = EXCLUDED.due_at, updated_at = timezone('utc', now());

INSERT INTO public.escalations (
  id, student_id, class_id, intervention_id, reason, level, owner_id, status
) VALUES
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'No recovery after guardian contact.', 'L2 Counselor', '00000000-0000-4000-8000-000000000003', 'open'),
  ('a1000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Attendance pattern needs faculty review.', 'L1 Faculty', '01000000-0000-4000-8000-000000000002', 'open')
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id, class_id = EXCLUDED.class_id,
  intervention_id = EXCLUDED.intervention_id, reason = EXCLUDED.reason,
  level = EXCLUDED.level, owner_id = EXCLUDED.owner_id,
  status = EXCLUDED.status, updated_at = timezone('utc', now());

INSERT INTO public.audit_logs (
  id, institution_id, actor_id, action, target, ip, severity,
  entity_type, entity_id, metadata
) VALUES
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000002', 'Recorded attendance', 'ATD-2026-001', '127.0.0.1', 'info', 'attendance_session', '60000000-0000-4000-8000-000000000001', '{"source":"seed"}'::jsonb),
  ('b1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '01000000-0000-4000-8000-000000000002', 'Recorded attendance', 'ATD-2026-001', '127.0.0.1', 'info', 'attendance_session', '61000000-0000-4000-8000-000000000001', '{"source":"seed"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  institution_id = EXCLUDED.institution_id, actor_id = EXCLUDED.actor_id,
  action = EXCLUDED.action, target = EXCLUDED.target, ip = EXCLUDED.ip,
  severity = EXCLUDED.severity, entity_type = EXCLUDED.entity_type,
  entity_id = EXCLUDED.entity_id, metadata = EXCLUDED.metadata,
  updated_at = timezone('utc', now());

COMMIT;
