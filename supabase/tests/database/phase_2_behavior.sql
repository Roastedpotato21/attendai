-- Transactional Phase 2 database behavior checks.
-- Run only against a local or dedicated development database. Every fixture is rolled back.

BEGIN;

DO $$
DECLARE
  previous_updated_at TIMESTAMPTZ;
  current_updated_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.classes (id, institution_id, name, section, full_name, academic_year)
  VALUES ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Phase 2 Test', 'A', 'Phase 2 Test - A', '2099-2100');

  INSERT INTO public.classes (id, institution_id, name, section, full_name, academic_year)
  VALUES ('d0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Phase 2 Test', 'B', 'Phase 2 Test - B', '2099-2100');

  INSERT INTO public.parents (id, institution_id, name, phone, language, preferred_channel)
  VALUES ('d0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Test Guardian', '+91 90000 00000', 'en', 'sms');

  INSERT INTO public.students (
    id, institution_id, parent_id, class_id, name, roll, attendance_rate,
    consecutive_absences, status, risk, enrollment_status
  ) VALUES (
    'd0000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'd0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000001',
    'Test Student', 'P2-001', 80, 0, 'present', 'low', 'active'
  );

  INSERT INTO public.students (
    id, institution_id, parent_id, class_id, name, roll, attendance_rate,
    consecutive_absences, status, risk, enrollment_status
  ) VALUES (
    'd0000000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'd0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000002',
    'Other Class Student', 'P2-002', 80, 0, 'present', 'low', 'active'
  );

  INSERT INTO public.student_parents (student_id, parent_id, relationship, is_primary)
  VALUES (
    'd0000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000003',
    'guardian', true
  );

  BEGIN
    INSERT INTO public.students (
      institution_id, parent_id, class_id, name, roll, attendance_rate,
      consecutive_absences, status, risk, enrollment_status
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'd0000000-0000-4000-8000-000000000099',
      'd0000000-0000-4000-8000-000000000001',
      'Bad FK', 'P2-BAD-FK', 80, 0, 'present', 'low', 'active'
    );
    RAISE EXCEPTION 'expected foreign-key rejection did not occur';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.classes (institution_id, name, section, full_name, academic_year)
    VALUES ('11111111-1111-4111-8111-111111111111', NULL, 'Z', 'Missing required name', '2099-2100');
    RAISE EXCEPTION 'expected NOT NULL rejection did not occur';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.students
    SET attendance_rate = 101
    WHERE id = 'd0000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'expected attendance-rate CHECK rejection did not occur';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.students
    SET status = 'not-a-status'
    WHERE id = 'd0000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'expected enum rejection did not occur';
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;

  INSERT INTO public.attendance_sessions (
    id, class_id, date, method, total_present, total_absent, total_late, status
  ) VALUES (
    'd0000000-0000-4000-8000-000000000005',
    'd0000000-0000-4000-8000-000000000001',
    DATE '2099-01-01', 'faculty', 1, 0, 0, 'submitted'
  );

  BEGIN
    INSERT INTO public.attendance_sessions (
      class_id, date, method, total_present, total_absent, total_late, status
    ) VALUES (
      'd0000000-0000-4000-8000-000000000001',
      DATE '2099-01-01', 'faculty', 1, 0, 0, 'submitted'
    );
    RAISE EXCEPTION 'expected duplicate attendance rejection did not occur';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.attendance_records (session_id, student_id, status)
    VALUES (
      'd0000000-0000-4000-8000-000000000005',
      'd0000000-0000-4000-8000-000000000006',
      'present'
    );
    RAISE EXCEPTION 'expected class-integrity rejection did not occur';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.attendance_records (session_id, student_id, status)
  VALUES (
    'd0000000-0000-4000-8000-000000000005',
    'd0000000-0000-4000-8000-000000000004',
    'present'
  );

  BEGIN
    DELETE FROM public.parents WHERE id = 'd0000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'expected parent relationship protection did not occur';
  EXCEPTION WHEN foreign_key_violation OR SQLSTATE '23001' THEN
    NULL;
  END;

  SELECT updated_at INTO previous_updated_at
  FROM public.classes WHERE id = 'd0000000-0000-4000-8000-000000000001';
  PERFORM pg_sleep(0.01);
  UPDATE public.classes SET full_name = 'Phase 2 Test - A updated'
  WHERE id = 'd0000000-0000-4000-8000-000000000001';
  SELECT updated_at INTO current_updated_at
  FROM public.classes WHERE id = 'd0000000-0000-4000-8000-000000000001';
  IF current_updated_at <= previous_updated_at THEN
    RAISE EXCEPTION 'updated_at trigger did not advance the timestamp';
  END IF;
END;
$$;

SET LOCAL ROLE anon;

DO $$
DECLARE
  exposed_count INTEGER;
BEGIN
  SELECT count(*) INTO exposed_count FROM public.profiles;
  IF exposed_count <> 0 THEN
    RAISE EXCEPTION 'anon role can read protected profiles';
  END IF;

  BEGIN
    INSERT INTO public.profiles (name, email, role)
    VALUES ('Unauthorized', 'unauthorized@attendai.test', 'admin');
    RAISE EXCEPTION 'anon role unexpectedly inserted a profile';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;
