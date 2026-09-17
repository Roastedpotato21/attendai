-- Transactional multi-tenant isolation checks. Run only against a local or
-- dedicated development database. Every identity and fixture is rolled back.

BEGIN;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'da000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tenant-a-admin@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"Tenant A Admin","role":"admin"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'da000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tenant-a-faculty@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"Tenant A Faculty","role":"admin"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'da000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'tenant-a-student@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"Tenant A Student"}'::jsonb, timezone('utc', now()), timezone('utc', now())),
  ('00000000-0000-0000-0000-000000000000', 'db000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tenant-b-admin@test.invalid', '', timezone('utc', now()), '{}'::jsonb, '{"name":"Tenant B Admin","role":"admin"}'::jsonb, timezone('utc', now()), timezone('utc', now()));

-- The auth trigger must ignore user-editable role metadata and must not choose
-- an institution on the user's behalf.
DO $$
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = 'da000000-0000-4000-8000-000000000002') <> 'student' THEN
    RAISE EXCEPTION 'auth metadata granted a privileged profile role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profile_institutions
    WHERE profile_id = 'da000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'auth signup selected an institution';
  END IF;
END;
$$;

INSERT INTO public.institutions (id, name, code) VALUES
  ('da000000-0000-4000-8000-000000000010', 'Tenant Isolation A', 'tenant-isolation-a'),
  ('db000000-0000-4000-8000-000000000010', 'Tenant Isolation B', 'tenant-isolation-b');

INSERT INTO public.profile_institutions (profile_id, institution_id) VALUES
  ('da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000010'),
  ('da000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000010'),
  ('da000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000010'),
  ('db000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000010');

INSERT INTO public.profile_roles (profile_id, institution_id, role_code) VALUES
  ('da000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000010', 'admin'),
  ('da000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000010', 'faculty'),
  ('da000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000010', 'student'),
  ('db000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000010', 'admin');

INSERT INTO public.classes (
  id, institution_id, name, section, full_name, academic_year
) VALUES
  ('da000000-0000-4000-8000-000000000020', 'da000000-0000-4000-8000-000000000010', 'Shared Course', 'A', 'Shared Course - A', '2099-2100'),
  ('da000000-0000-4000-8000-000000000021', 'da000000-0000-4000-8000-000000000010', 'Unassigned Course', 'A', 'Unassigned Course - A', '2099-2100'),
  ('db000000-0000-4000-8000-000000000020', 'db000000-0000-4000-8000-000000000010', 'Shared Course', 'A', 'Shared Course - A', '2099-2100');

INSERT INTO public.parents (
  id, institution_id, name, phone, email, language, preferred_channel
) VALUES
  ('da000000-0000-4000-8000-000000000030', 'da000000-0000-4000-8000-000000000010', 'Tenant A Guardian', '+91 90000 10001', 'guardian-a@test.invalid', 'en', 'sms'),
  ('db000000-0000-4000-8000-000000000030', 'db000000-0000-4000-8000-000000000010', 'Tenant B Guardian', '+91 90000 20001', 'guardian-b@test.invalid', 'en', 'sms');

INSERT INTO public.students (
  id, institution_id, parent_id, class_id, name, roll, admission_number
) VALUES
  ('da000000-0000-4000-8000-000000000040', 'da000000-0000-4000-8000-000000000010', 'da000000-0000-4000-8000-000000000030', 'da000000-0000-4000-8000-000000000020', 'Tenant A Student', 'S-001', 'SHARED-001'),
  ('da000000-0000-4000-8000-000000000041', 'da000000-0000-4000-8000-000000000010', 'da000000-0000-4000-8000-000000000030', 'da000000-0000-4000-8000-000000000021', 'Tenant A Unassigned Student', 'S-002', 'SHARED-002'),
  ('db000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000010', 'db000000-0000-4000-8000-000000000030', 'db000000-0000-4000-8000-000000000020', 'Tenant B Student', 'S-001', 'SHARED-001');

UPDATE public.profiles
SET student_id = 'da000000-0000-4000-8000-000000000040'
WHERE id = 'da000000-0000-4000-8000-000000000003';

INSERT INTO public.student_parents (student_id, parent_id, relationship, is_primary) VALUES
  ('da000000-0000-4000-8000-000000000040', 'da000000-0000-4000-8000-000000000030', 'guardian', true),
  ('da000000-0000-4000-8000-000000000041', 'da000000-0000-4000-8000-000000000030', 'guardian', true),
  ('db000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000030', 'guardian', true);

INSERT INTO public.faculty (id, institution_id, user_id, department, role, employee_code) VALUES
  ('da000000-0000-4000-8000-000000000050', 'da000000-0000-4000-8000-000000000010', 'da000000-0000-4000-8000-000000000002', 'Testing', 'professor', 'FAC-001');
INSERT INTO public.class_faculty (id, faculty_id, class_id) VALUES
  ('da000000-0000-4000-8000-000000000051', 'da000000-0000-4000-8000-000000000050', 'da000000-0000-4000-8000-000000000020');

INSERT INTO public.attendance_sessions (
  id, class_id, date, method, total_present, total_absent, total_late, status
) VALUES
  ('da000000-0000-4000-8000-000000000060', 'da000000-0000-4000-8000-000000000020', DATE '2099-01-01', 'faculty', 1, 0, 0, 'submitted'),
  ('db000000-0000-4000-8000-000000000060', 'db000000-0000-4000-8000-000000000020', DATE '2099-01-01', 'faculty', 1, 0, 0, 'submitted');
INSERT INTO public.attendance_records (id, session_id, student_id, status) VALUES
  ('da000000-0000-4000-8000-000000000061', 'da000000-0000-4000-8000-000000000060', 'da000000-0000-4000-8000-000000000040', 'present'),
  ('db000000-0000-4000-8000-000000000061', 'db000000-0000-4000-8000-000000000060', 'db000000-0000-4000-8000-000000000040', 'present');

INSERT INTO public.qr_sessions (id, class_id, faculty_id, date, expires_at, active) VALUES
  ('da000000-0000-4000-8000-000000000070', 'da000000-0000-4000-8000-000000000020', 'da000000-0000-4000-8000-000000000002', DATE '2099-01-01', '2099-01-02T00:00:00Z', true),
  ('db000000-0000-4000-8000-000000000070', 'db000000-0000-4000-8000-000000000020', 'db000000-0000-4000-8000-000000000001', DATE '2099-01-01', '2099-01-02T00:00:00Z', true);

INSERT INTO public.communications (
  id, student_id, parent_id, type, direction, message_status, body
) VALUES
  ('da000000-0000-4000-8000-000000000080', 'da000000-0000-4000-8000-000000000040', 'da000000-0000-4000-8000-000000000030', 'sms', 'outbound', 'delivered', 'Tenant A fixture'),
  ('db000000-0000-4000-8000-000000000080', 'db000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000030', 'sms', 'outbound', 'delivered', 'Tenant B fixture');

INSERT INTO public.interventions (
  id, student_id, risk_level, reason, status, owner_id, communication_id
) VALUES
  ('da000000-0000-4000-8000-000000000090', 'da000000-0000-4000-8000-000000000040', 'high', 'Tenant A fixture', 'pending', 'da000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000080'),
  ('db000000-0000-4000-8000-000000000090', 'db000000-0000-4000-8000-000000000040', 'high', 'Tenant B fixture', 'pending', 'db000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000080');

INSERT INTO public.escalations (
  id, student_id, class_id, intervention_id, reason, owner_id
) VALUES
  ('da000000-0000-4000-8000-0000000000a0', 'da000000-0000-4000-8000-000000000040', 'da000000-0000-4000-8000-000000000020', 'da000000-0000-4000-8000-000000000090', 'Tenant A fixture', 'da000000-0000-4000-8000-000000000002'),
  ('db000000-0000-4000-8000-0000000000a0', 'db000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000020', 'db000000-0000-4000-8000-000000000090', 'Tenant B fixture', 'db000000-0000-4000-8000-000000000001');

INSERT INTO public.audit_logs (
  id, institution_id, actor_id, action, target, ip, severity, entity_type, entity_id
) VALUES
  ('da000000-0000-4000-8000-0000000000b0', 'da000000-0000-4000-8000-000000000010', 'da000000-0000-4000-8000-000000000001', 'Tenant A audit', 'Tenant A student', '127.0.0.1', 'info', 'student', 'da000000-0000-4000-8000-000000000040'),
  ('db000000-0000-4000-8000-0000000000b0', 'db000000-0000-4000-8000-000000000010', 'db000000-0000-4000-8000-000000000001', 'Tenant B audit', 'Tenant B student', '127.0.0.1', 'info', 'student', 'db000000-0000-4000-8000-000000000040');

-- Composite foreign keys and validation triggers reject cross-tenant links
-- even for a database owner/service actor that bypasses RLS.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.class_faculty (faculty_id, class_id)
    VALUES ('da000000-0000-4000-8000-000000000050', 'db000000-0000-4000-8000-000000000020');
    RAISE EXCEPTION 'cross-tenant faculty assignment was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.student_parents (student_id, parent_id)
    VALUES ('da000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000030');
    RAISE EXCEPTION 'cross-tenant guardian link was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.attendance_records (session_id, student_id, status)
    VALUES ('da000000-0000-4000-8000-000000000060', 'db000000-0000-4000-8000-000000000040', 'present');
    RAISE EXCEPTION 'cross-tenant attendance record was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.qr_check_ins (session_id, student_id, status)
    VALUES ('da000000-0000-4000-8000-000000000070', 'db000000-0000-4000-8000-000000000040', 'valid');
    RAISE EXCEPTION 'cross-tenant QR check-in was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.communications (student_id, parent_id, type, body)
    VALUES ('da000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000030', 'sms', 'Cross tenant');
    RAISE EXCEPTION 'cross-tenant communication was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.interventions (student_id, risk_level, reason, communication_id)
    VALUES ('da000000-0000-4000-8000-000000000040', 'high', 'Cross tenant', 'db000000-0000-4000-8000-000000000080');
    RAISE EXCEPTION 'cross-tenant intervention was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.escalations (student_id, class_id, intervention_id, reason)
    VALUES ('da000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000020', 'db000000-0000-4000-8000-000000000090', 'Cross tenant');
    RAISE EXCEPTION 'cross-tenant escalation was accepted';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.audit_logs (
      institution_id, actor_id, action, target, ip, severity, entity_type, entity_id
    ) VALUES (
      'da000000-0000-4000-8000-000000000010',
      'da000000-0000-4000-8000-000000000001',
      'Cross tenant audit', 'Tenant B student', '127.0.0.1', 'warning',
      'student', 'db000000-0000-4000-8000-000000000040'
    );
    RAISE EXCEPTION 'cross-tenant audit target was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  visible_count INTEGER;
  changed_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count FROM public.institutions
  WHERE id IN ('da000000-0000-4000-8000-000000000010', 'db000000-0000-4000-8000-000000000010');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the institution read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.profiles
  WHERE id IN ('da000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the profile read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.classes
  WHERE id IN ('da000000-0000-4000-8000-000000000020', 'db000000-0000-4000-8000-000000000020');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the class read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.students
  WHERE id IN ('da000000-0000-4000-8000-000000000040', 'db000000-0000-4000-8000-000000000040');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the student read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.communications
  WHERE id IN ('da000000-0000-4000-8000-000000000080', 'db000000-0000-4000-8000-000000000080');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the communication read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.interventions
  WHERE id IN ('da000000-0000-4000-8000-000000000090', 'db000000-0000-4000-8000-000000000090');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the intervention read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.escalations
  WHERE id IN ('da000000-0000-4000-8000-0000000000a0', 'db000000-0000-4000-8000-0000000000a0');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the escalation read boundary'; END IF;

  SELECT count(*) INTO visible_count FROM public.audit_logs
  WHERE id IN ('da000000-0000-4000-8000-0000000000b0', 'db000000-0000-4000-8000-0000000000b0');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'tenant A admin crossed the audit read boundary'; END IF;

  WITH changed AS (
    UPDATE public.students SET name = 'Tenant B tampered'
    WHERE id = 'db000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'tenant A admin updated tenant B student data'; END IF;

  WITH changed AS (
    UPDATE public.interventions SET reason = 'Tenant B tampered'
    WHERE id = 'db000000-0000-4000-8000-000000000090' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'tenant A admin updated tenant B intervention'; END IF;

  WITH changed AS (
    UPDATE public.escalations SET reason = 'Tenant B tampered'
    WHERE id = 'db000000-0000-4000-8000-0000000000a0' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'tenant A admin updated tenant B escalation'; END IF;

  WITH changed AS (
    UPDATE public.students SET name = 'Tenant A permitted update'
    WHERE id = 'da000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 1 THEN RAISE EXCEPTION 'tenant A admin could not update same-tenant student data'; END IF;

  INSERT INTO public.attendance_sessions (
    id, class_id, date, method, total_present, total_absent, total_late
  ) VALUES (
    'da000000-0000-4000-8000-000000000062',
    'da000000-0000-4000-8000-000000000020',
    DATE '2099-01-02', 'faculty', 1, 0, 0
  );
  INSERT INTO public.attendance_records (session_id, student_id, status)
  VALUES (
    'da000000-0000-4000-8000-000000000062',
    'da000000-0000-4000-8000-000000000040',
    'present'
  );

  BEGIN
    INSERT INTO public.attendance_sessions (class_id, date, method)
    VALUES ('db000000-0000-4000-8000-000000000020', DATE '2099-01-02', 'faculty');
    RAISE EXCEPTION 'tenant A admin created attendance for tenant B';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.profile_institutions (profile_id, institution_id)
    VALUES ('da000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000010');
    RAISE EXCEPTION 'user changed their own institution membership';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
    VALUES ('da000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000010', 'admin');
    RAISE EXCEPTION 'user granted a privileged role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.audit_logs (
      institution_id, action, target, ip, severity, entity_type, entity_id
    ) VALUES (
      'da000000-0000-4000-8000-000000000010',
      'Forged browser event', 'Tenant A student', '127.0.0.1', 'critical',
      'student', 'da000000-0000-4000-8000-000000000040'
    );
    RAISE EXCEPTION 'authenticated browser inserted an audit record';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  WITH changed AS (
    UPDATE public.profile_institutions SET status = 'suspended'
    WHERE profile_id = 'da000000-0000-4000-8000-000000000001'
    RETURNING profile_id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'user modified their membership'; END IF;
END;
$$;

-- Faculty writes remain restricted to their assigned class, even inside the
-- same institution.
SELECT set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000002', true);
DO $$
DECLARE
  changed_count INTEGER;
BEGIN
  WITH changed AS (
    UPDATE public.students SET consecutive_absences = 1
    WHERE id = 'da000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 1 THEN RAISE EXCEPTION 'faculty could not manage assigned-class student'; END IF;

  WITH changed AS (
    UPDATE public.students SET consecutive_absences = 1
    WHERE id = 'da000000-0000-4000-8000-000000000041' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'faculty managed an unassigned-class student'; END IF;

  WITH changed AS (
    UPDATE public.students SET consecutive_absences = 1
    WHERE id = 'db000000-0000-4000-8000-000000000040' RETURNING id
  ) SELECT count(*) INTO changed_count FROM changed;
  IF changed_count <> 0 THEN RAISE EXCEPTION 'faculty managed another tenant student'; END IF;
END;
$$;

RESET ROLE;

-- A student can use the active QR session for their own class, but neither
-- read nor check in through another institution's session.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000003', true);
DO $$
DECLARE
  visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count FROM public.qr_sessions
  WHERE id IN ('da000000-0000-4000-8000-000000000070', 'db000000-0000-4000-8000-000000000070');
  IF visible_count <> 1 THEN RAISE EXCEPTION 'student crossed the QR session read boundary'; END IF;

  INSERT INTO public.qr_check_ins (id, session_id, student_id, status)
  VALUES (
    'da000000-0000-4000-8000-000000000071',
    'da000000-0000-4000-8000-000000000070',
    'da000000-0000-4000-8000-000000000040',
    'valid'
  );

  BEGIN
    INSERT INTO public.qr_check_ins (session_id, student_id, status)
    VALUES (
      'db000000-0000-4000-8000-000000000070',
      'db000000-0000-4000-8000-000000000040',
      'valid'
    );
    RAISE EXCEPTION 'student checked in through another tenant QR session';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR check_violation THEN NULL;
  END;
END;
$$;

RESET ROLE;

-- Suspending the protected membership immediately removes faculty capability.
UPDATE public.profile_institutions
SET status = 'suspended'
WHERE profile_id = 'da000000-0000-4000-8000-000000000002'
  AND institution_id = 'da000000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'da000000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  IF public.can_manage_class('da000000-0000-4000-8000-000000000020') THEN
    RAISE EXCEPTION 'suspended faculty membership retained class capability';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
