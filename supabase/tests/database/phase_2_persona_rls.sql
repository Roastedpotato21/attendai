-- Phase 2 Deep Persona RLS & Privilege Escalation Verification Suite
-- Tests all requested personas:
-- 1. Student
-- 2. Ordinary Member (non-admin, non-faculty)
-- 3. Assigned Faculty
-- 4. Unassigned Faculty
-- 5. Institution Admin
-- 6. Suspended Member
-- 7. Cross-Institution User
--
-- Plus UUID guessing and all privilege escalation vectors.
-- Everything is wrapped in a transaction and rolled back.

BEGIN;

-- ============================================================================
-- 1. SETUP TENANTS & USERS
-- ============================================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p2-admin-a@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"P2 Admin A"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'ea000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'p2-faculty-a@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"P2 Faculty A"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'ea000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'p2-member-a@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"P2 Member A"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'ea000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'p2-student-a@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"P2 Student A"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'eb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p2-admin-b@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"P2 Admin B"}'::jsonb, timezone('utc', now()), timezone('utc', now()));

INSERT INTO public.institutions (id, name, code) VALUES
  ('ea000000-0000-4000-8000-000000000010', 'Persona Test Inst A', 'persona-a'),
  ('eb000000-0000-4000-8000-000000000010', 'Persona Test Inst B', 'persona-b');

INSERT INTO public.profile_institutions (profile_id, institution_id, status) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000010', 'active'),
  ('ea000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000010', 'active'),
  ('ea000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000010', 'active'),
  ('ea000000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-000000000010', 'active'),
  ('eb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000010', 'active');

INSERT INTO public.profile_roles (profile_id, institution_id, role_code) VALUES
  ('ea000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000010', 'admin'),
  ('ea000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000010', 'faculty'),
  ('ea000000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-000000000010', 'student'),
  ('eb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000010', 'admin');

-- Classes in Tenant A:
-- Class 20 is ASSIGNED to faculty ea...02
-- Class 21 is UNASSIGNED to faculty ea...02
INSERT INTO public.classes (id, institution_id, name, section, full_name, academic_year) VALUES
  ('ea000000-0000-4000-8000-000000000020', 'ea000000-0000-4000-8000-000000000010', 'Assigned Class', 'A', 'Assigned Class A', '2026-2027'),
  ('ea000000-0000-4000-8000-000000000021', 'ea000000-0000-4000-8000-000000000010', 'Unassigned Class', 'B', 'Unassigned Class B', '2026-2027'),
  ('eb000000-0000-4000-8000-000000000020', 'eb000000-0000-4000-8000-000000000010', 'Tenant B Class', 'A', 'Tenant B Class A', '2026-2027');

INSERT INTO public.parents (id, institution_id, name, phone, email, language, preferred_channel) VALUES
  ('ea000000-0000-4000-8000-000000000030', 'ea000000-0000-4000-8000-000000000010', 'Parent A', '+91 99999 00001', 'parent-a@test.invalid', 'en', 'sms'),
  ('eb000000-0000-4000-8000-000000000030', 'eb000000-0000-4000-8000-000000000010', 'Parent B', '+91 99999 00002', 'parent-b@test.invalid', 'en', 'sms');

INSERT INTO public.students (id, institution_id, parent_id, class_id, name, roll, admission_number) VALUES
  ('ea000000-0000-4000-8000-000000000040', 'ea000000-0000-4000-8000-000000000010', 'ea000000-0000-4000-8000-000000000030', 'ea000000-0000-4000-8000-000000000020', 'Assigned Student A', 'S-01', 'ADM-EA-01'),
  ('ea000000-0000-4000-8000-000000000041', 'ea000000-0000-4000-8000-000000000010', 'ea000000-0000-4000-8000-000000000030', 'ea000000-0000-4000-8000-000000000021', 'Unassigned Student A', 'S-02', 'ADM-EA-02'),
  ('eb000000-0000-4000-8000-000000000040', 'eb000000-0000-4000-8000-000000000010', 'eb000000-0000-4000-8000-000000000030', 'eb000000-0000-4000-8000-000000000020', 'Student B', 'S-01', 'ADM-EB-01');

UPDATE public.profiles SET student_id = 'ea000000-0000-4000-8000-000000000040'
WHERE id = 'ea000000-0000-4000-8000-000000000004';

INSERT INTO public.student_parents (student_id, parent_id, relationship, is_primary) VALUES
  ('ea000000-0000-4000-8000-000000000040', 'ea000000-0000-4000-8000-000000000030', 'guardian', true),
  ('ea000000-0000-4000-8000-000000000041', 'ea000000-0000-4000-8000-000000000030', 'guardian', true),
  ('eb000000-0000-4000-8000-000000000040', 'eb000000-0000-4000-8000-000000000030', 'guardian', true);

INSERT INTO public.faculty (id, institution_id, user_id, department, role, employee_code) VALUES
  ('ea000000-0000-4000-8000-000000000050', 'ea000000-0000-4000-8000-000000000010', 'ea000000-0000-4000-8000-000000000002', 'Computer Science', 'professor', 'FAC-EA-01');

-- Assign faculty ea...02 ONLY to class ea...20
INSERT INTO public.class_faculty (id, faculty_id, class_id) VALUES
  ('ea000000-0000-4000-8000-000000000051', 'ea000000-0000-4000-8000-000000000050', 'ea000000-0000-4000-8000-000000000020');

INSERT INTO public.attendance_sessions (id, class_id, date, method, total_present, total_absent, total_late, status) VALUES
  ('ea000000-0000-4000-8000-000000000060', 'ea000000-0000-4000-8000-000000000020', DATE '2026-09-10', 'faculty', 1, 0, 0, 'submitted'),
  ('eb000000-0000-4000-8000-000000000060', 'eb000000-0000-4000-8000-000000000020', DATE '2026-09-10', 'faculty', 1, 0, 0, 'submitted');

INSERT INTO public.attendance_records (id, session_id, student_id, status) VALUES
  ('ea000000-0000-4000-8000-000000000061', 'ea000000-0000-4000-8000-000000000060', 'ea000000-0000-4000-8000-000000000040', 'present'),
  ('eb000000-0000-4000-8000-000000000061', 'eb000000-0000-4000-8000-000000000060', 'eb000000-0000-4000-8000-000000000040', 'present');

INSERT INTO public.qr_sessions (id, class_id, faculty_id, date, expires_at, active) VALUES
  ('ea000000-0000-4000-8000-000000000070', 'ea000000-0000-4000-8000-000000000020', 'ea000000-0000-4000-8000-000000000002', DATE '2026-09-10', '2026-09-11T00:00:00Z', true),
  ('eb000000-0000-4000-8000-000000000070', 'eb000000-0000-4000-8000-000000000020', 'eb000000-0000-4000-8000-000000000001', DATE '2026-09-10', '2026-09-11T00:00:00Z', true);

INSERT INTO public.communications (id, student_id, parent_id, type, direction, message_status, body) VALUES
  ('ea000000-0000-4000-8000-000000000080', 'ea000000-0000-4000-8000-000000000040', 'ea000000-0000-4000-8000-000000000030', 'sms', 'outbound', 'delivered', 'Comm A'),
  ('eb000000-0000-4000-8000-000000000080', 'eb000000-0000-4000-8000-000000000040', 'eb000000-0000-4000-8000-000000000030', 'sms', 'outbound', 'delivered', 'Comm B');

INSERT INTO public.interventions (id, student_id, risk_level, reason, status, owner_id, communication_id) VALUES
  ('ea000000-0000-4000-8000-000000000090', 'ea000000-0000-4000-8000-000000000040', 'high', 'Intervention A', 'pending', 'ea000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000080'),
  ('eb000000-0000-4000-8000-000000000090', 'eb000000-0000-4000-8000-000000000040', 'high', 'Intervention B', 'pending', 'eb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000080');

INSERT INTO public.escalations (id, student_id, class_id, intervention_id, reason, owner_id) VALUES
  ('ea000000-0000-4000-8000-0000000000a0', 'ea000000-0000-4000-8000-000000000040', 'ea000000-0000-4000-8000-000000000020', 'ea000000-0000-4000-8000-000000000090', 'Escalation A', 'ea000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-0000000000a0', 'eb000000-0000-4000-8000-000000000040', 'eb000000-0000-4000-8000-000000000020', 'eb000000-0000-4000-8000-000000000090', 'Escalation B', 'eb000000-0000-4000-8000-000000000001');

INSERT INTO public.audit_logs (id, institution_id, actor_id, action, target, ip, severity, entity_type, entity_id) VALUES
  ('ea000000-0000-4000-8000-0000000000b0', 'ea000000-0000-4000-8000-000000000010', 'ea000000-0000-4000-8000-000000000001', 'Audit A', 'Target A', '127.0.0.1', 'info', 'student', 'ea000000-0000-4000-8000-000000000040'),
  ('eb000000-0000-4000-8000-0000000000b0', 'eb000000-0000-4000-8000-000000000010', 'eb000000-0000-4000-8000-000000000001', 'Audit B', 'Target B', '127.0.0.1', 'info', 'student', 'eb000000-0000-4000-8000-000000000040');

-- ============================================================================
-- 2. PERSONA: CROSS-INSTITUTION USER (Tenant B Admin reading Tenant A)
-- ============================================================================
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_count INTEGER;
  c_count INTEGER;
BEGIN
  -- UUID Guessing on all Tenant A objects must return 0 rows
  SELECT count(*) INTO v_count FROM public.students WHERE id = 'ea000000-0000-4000-8000-000000000040';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: student visible'; END IF;

  SELECT count(*) INTO v_count FROM public.parents WHERE id = 'ea000000-0000-4000-8000-000000000030';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: parent visible'; END IF;

  SELECT count(*) INTO v_count FROM public.faculty WHERE id = 'ea000000-0000-4000-8000-000000000050';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: faculty visible'; END IF;

  SELECT count(*) INTO v_count FROM public.classes WHERE id = 'ea000000-0000-4000-8000-000000000020';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: class visible'; END IF;

  SELECT count(*) INTO v_count FROM public.attendance_sessions WHERE id = 'ea000000-0000-4000-8000-000000000060';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: attendance_session visible'; END IF;

  SELECT count(*) INTO v_count FROM public.attendance_records WHERE id = 'ea000000-0000-4000-8000-000000000061';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: attendance_record visible'; END IF;

  SELECT count(*) INTO v_count FROM public.qr_sessions WHERE id = 'ea000000-0000-4000-8000-000000000070';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: qr_session visible'; END IF;

  SELECT count(*) INTO v_count FROM public.communications WHERE id = 'ea000000-0000-4000-8000-000000000080';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: communication visible'; END IF;

  SELECT count(*) INTO v_count FROM public.interventions WHERE id = 'ea000000-0000-4000-8000-000000000090';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: intervention visible'; END IF;

  SELECT count(*) INTO v_count FROM public.escalations WHERE id = 'ea000000-0000-4000-8000-0000000000a0';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: escalation visible'; END IF;

  SELECT count(*) INTO v_count FROM public.audit_logs WHERE id = 'ea000000-0000-4000-8000-0000000000b0';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: audit_log visible'; END IF;

  SELECT count(*) INTO v_count FROM public.profile_institutions WHERE profile_id = 'ea000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: profile_institution visible'; END IF;

  SELECT count(*) INTO v_count FROM public.profile_roles WHERE profile_id = 'ea000000-0000-4000-8000-000000000001';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant leak: profile_roles visible'; END IF;

  -- Tampering / updates to Tenant A rows by Tenant B user must affect 0 rows
  WITH changed AS (
    UPDATE public.students SET name = 'Tampered B' WHERE id = 'ea000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant write: student updated'; END IF;

  WITH changed AS (
    DELETE FROM public.students WHERE id = 'ea000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 0 THEN RAISE EXCEPTION 'Cross-tenant delete: student deleted'; END IF;
END;
$$;

-- ============================================================================
-- 3. PERSONA: STUDENT (ea...04)
-- ============================================================================
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000004', true);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Can read own student record
  SELECT count(*) INTO v_count FROM public.students WHERE id = 'ea000000-0000-4000-8000-000000000040';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Student could not read own student record'; END IF;

  -- Cannot read unassigned / other student record
  SELECT count(*) INTO v_count FROM public.students WHERE id = 'ea000000-0000-4000-8000-000000000041';
  IF v_count <> 0 THEN RAISE EXCEPTION 'Student could read another student record'; END IF;

  -- Cannot read audit logs
  SELECT count(*) INTO v_count FROM public.audit_logs;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Student could read audit logs'; END IF;

  -- Cannot create attendance session
  BEGIN
    INSERT INTO public.attendance_sessions (class_id, date, method)
    VALUES ('ea000000-0000-4000-8000-000000000020', DATE '2026-09-11', 'faculty');
    RAISE EXCEPTION 'Student created attendance session';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- Cannot create interventions
  BEGIN
    INSERT INTO public.interventions (student_id, risk_level, reason)
    VALUES ('ea000000-0000-4000-8000-000000000040', 'low', 'Self intervention');
    RAISE EXCEPTION 'Student created intervention';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- ============================================================================
-- 4. PERSONA: ORDINARY MEMBER (ea...03: staff, non-admin, non-faculty)
-- ============================================================================
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);

DO $$
BEGIN
  -- cannot manage classes
  IF public.can_manage_class('ea000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Ordinary member has manage_class privileges';
  END IF;

  -- cannot create attendance session
  BEGIN
    INSERT INTO public.attendance_sessions (class_id, date, method)
    VALUES ('ea000000-0000-4000-8000-000000000020', DATE '2026-09-11', 'faculty');
    RAISE EXCEPTION 'Ordinary member created attendance session';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- cannot create class
  BEGIN
    INSERT INTO public.classes (institution_id, name, section, full_name, academic_year)
    VALUES ('ea000000-0000-4000-8000-000000000010', 'Staff Class', 'X', 'Staff Class X', '2026-2027');
    RAISE EXCEPTION 'Ordinary member created class';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- ============================================================================
-- 5. PERSONA: ASSIGNED FACULTY VS UNASSIGNED FACULTY (ea...02)
-- Assigned: ea...20
-- Unassigned: ea...21
-- ============================================================================
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);

DO $$
DECLARE
  c_count INTEGER;
  new_sess_id UUID := 'ea000000-0000-4000-8000-000000000062';
BEGIN
  -- Assigned class capability: true
  IF NOT public.can_manage_class('ea000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Assigned faculty cannot manage assigned class';
  END IF;

  -- Unassigned class capability: false
  IF public.can_manage_class('ea000000-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'Faculty can manage unassigned class';
  END IF;

  -- CAN create attendance session for assigned class
  INSERT INTO public.attendance_sessions (
    id, class_id, date, method, total_present, total_absent, total_late, status
  ) VALUES (
    new_sess_id, 'ea000000-0000-4000-8000-000000000020',
    DATE '2026-09-11', 'faculty', 1, 0, 0, 'submitted'
  );

  -- CAN mark attendance for assigned class student
  INSERT INTO public.attendance_records (session_id, student_id, status)
  VALUES (new_sess_id, 'ea000000-0000-4000-8000-000000000040', 'present');

  -- CANNOT create attendance session for unassigned class
  BEGIN
    INSERT INTO public.attendance_sessions (class_id, date, method)
    VALUES ('ea000000-0000-4000-8000-000000000021', DATE '2026-09-11', 'faculty');
    RAISE EXCEPTION 'Faculty created attendance session for unassigned class';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- CAN update student in assigned class
  WITH changed AS (
    UPDATE public.students SET consecutive_absences = 2
    WHERE id = 'ea000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 1 THEN RAISE EXCEPTION 'Faculty could not update assigned class student'; END IF;

  -- CANNOT update student in unassigned class
  WITH changed AS (
    UPDATE public.students SET consecutive_absences = 2
    WHERE id = 'ea000000-0000-4000-8000-000000000041' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 0 THEN RAISE EXCEPTION 'Faculty updated unassigned class student'; END IF;
END;
$$;

-- ============================================================================
-- 6. PERSONA: INSTITUTION ADMIN (ea...01)
-- ============================================================================
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_count INTEGER;
  c_count INTEGER;
BEGIN
  -- Can manage all classes in same tenant
  IF NOT public.can_manage_class('ea000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Admin cannot manage assigned class';
  END IF;
  IF NOT public.can_manage_class('ea000000-0000-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'Admin cannot manage unassigned class';
  END IF;

  -- Cannot manage other tenant class
  IF public.can_manage_class('eb000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Admin can manage other tenant class';
  END IF;

  -- Legitimate update to same-tenant student succeeds
  WITH changed AS (
    UPDATE public.students SET name = 'Permitted Admin Edit'
    WHERE id = 'ea000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 1 THEN RAISE EXCEPTION 'Admin could not update same-tenant student'; END IF;

  -- Legitimate insert into same-tenant classes succeeds
  INSERT INTO public.classes (
    id, institution_id, name, section, full_name, academic_year
  ) VALUES (
    'ea000000-0000-4000-8000-000000000029', 'ea000000-0000-4000-8000-000000000010',
    'Admin Created Class', 'C', 'Admin Created Class C', '2026-2027'
  );
END;
$$;

-- ============================================================================
-- 7. PERSONA: SUSPENDED MEMBER
-- ============================================================================
RESET ROLE;

UPDATE public.profile_institutions
SET status = 'suspended'
WHERE profile_id = 'ea000000-0000-4000-8000-000000000002'
  AND institution_id = 'ea000000-0000-4000-8000-000000000010';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- capability revoked
  IF public.can_manage_class('ea000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'Suspended faculty retained can_manage_class';
  END IF;

  -- cannot read students
  SELECT count(*) INTO v_count FROM public.students;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Suspended member can read students: count %', v_count;
  END IF;

  -- cannot insert attendance
  BEGIN
    INSERT INTO public.attendance_sessions (class_id, date, method)
    VALUES ('ea000000-0000-4000-8000-000000000020', DATE '2026-09-12', 'faculty');
    RAISE EXCEPTION 'Suspended member created attendance session';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR check_violation THEN NULL;
  END;
END;
$$;

-- ============================================================================
-- 8. PRIVILEGE ESCALATION ATTACK VECTORS
-- ============================================================================
SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);

DO $$
DECLARE
  c_count INTEGER;
BEGIN
  -- Vector 1: Change own institution membership
  BEGIN
    INSERT INTO public.profile_institutions (profile_id, institution_id)
    VALUES ('ea000000-0000-4000-8000-000000000003', 'eb000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'User changed/added their own institution membership';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
  END;

  -- Vector 2: Self-grant admin role
  BEGIN
    INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
    VALUES ('ea000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000010', 'admin');
    RAISE EXCEPTION 'User self-granted admin role in profile_roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Vector 3: Promote profile.role directly
  WITH changed AS (
    UPDATE public.profiles SET role = 'admin'
    WHERE id = 'ea000000-0000-4000-8000-000000000003' RETURNING id
  ) SELECT count(*) INTO c_count FROM changed;
  IF c_count <> 0 THEN
    RAISE EXCEPTION 'User directly altered profiles.role';
  END IF;

  -- Vector 4: Forge trusted audit log
  BEGIN
    INSERT INTO public.audit_logs (
      institution_id, actor_id, action, target, ip, severity, entity_type, entity_id
    ) VALUES (
      'ea000000-0000-4000-8000-000000000010', 'ea000000-0000-4000-8000-000000000003',
      'Forged Event', 'Target', '127.0.0.1', 'critical', 'student', 'ea000000-0000-4000-8000-000000000040'
    );
    RAISE EXCEPTION 'Authenticated user forged audit_logs entry';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;
