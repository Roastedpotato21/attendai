-- Real PostgreSQL correction, concurrency, outbox, and persona checks.
-- Seed fixtures and test mutations are rolled back together.
BEGIN;

INSERT INTO public.students (id, institution_id, class_id, parent_id, name, roll)
VALUES ('10000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111', '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001', 'Correction Student Three', 'CORRECTION-03');
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-4000-8000-000000000055', 'unassigned-correction@test.invalid');
INSERT INTO public.profile_institutions (profile_id, institution_id)
VALUES ('00000000-0000-4000-8000-000000000055', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.profile_roles (profile_id, institution_id, role_code)
VALUES ('00000000-0000-4000-8000-000000000055', '11111111-1111-4111-8111-111111111111', 'faculty');

-- Authenticated personas must have real auth/profile links; seed profiles alone
-- deliberately are historical data, not login identities.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-000000000056', 'admin-correction@test.invalid'),
  ('00000000-0000-4000-8000-000000000057', 'faculty-correction@test.invalid'),
  ('00000000-0000-4000-8000-000000000058', 'student-correction@test.invalid'),
  ('00000000-0000-4000-8000-000000000059', 'other-correction@test.invalid');
INSERT INTO public.profile_institutions (profile_id, institution_id) VALUES
  ('00000000-0000-4000-8000-000000000056', '11111111-1111-4111-8111-111111111111'),
  ('00000000-0000-4000-8000-000000000057', '11111111-1111-4111-8111-111111111111'),
  ('00000000-0000-4000-8000-000000000058', '11111111-1111-4111-8111-111111111111'),
  ('00000000-0000-4000-8000-000000000059', '22222222-2222-4222-8222-222222222222');
INSERT INTO public.profile_roles (profile_id, institution_id, role_code) VALUES
  ('00000000-0000-4000-8000-000000000056', '11111111-1111-4111-8111-111111111111', 'admin'),
  ('00000000-0000-4000-8000-000000000057', '11111111-1111-4111-8111-111111111111', 'faculty'),
  ('00000000-0000-4000-8000-000000000058', '11111111-1111-4111-8111-111111111111', 'student'),
  ('00000000-0000-4000-8000-000000000059', '22222222-2222-4222-8222-222222222222', 'admin');
UPDATE public.profiles SET student_id = '10000000-0000-4000-8000-000000000003'
WHERE id = '00000000-0000-4000-8000-000000000058';
INSERT INTO public.faculty (id, institution_id, user_id, department, role)
VALUES ('40000000-0000-4000-8000-000000000057', '11111111-1111-4111-8111-111111111111',
  '00000000-0000-4000-8000-000000000057', 'CSE', 'lecturer');
INSERT INTO public.class_faculty (faculty_id, class_id)
VALUES ('40000000-0000-4000-8000-000000000057', '20000000-0000-4000-8000-000000000001');

CREATE TEMP TABLE correction_state (id UUID, record_ids UUID[]);
GRANT ALL ON correction_state TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000056', true);
INSERT INTO correction_state (id)
SELECT (public.submit_attendance('20000000-0000-4000-8000-000000000001', '2026-09-28', 'manual',
  '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"present"},
    {"student_id":"10000000-0000-4000-8000-000000000002","status":"absent"},
    {"student_id":"10000000-0000-4000-8000-000000000003","status":"present"}]') ->> 'session_id')::UUID;
UPDATE correction_state SET record_ids =
  (SELECT array_agg(id ORDER BY id) FROM public.attendance_records WHERE session_id = correction_state.id);

DO $$ BEGIN
  IF (SELECT count(*) FROM public.attendance_records WHERE session_id = (SELECT id FROM correction_state)) <> 3
    OR NOT EXISTS (SELECT 1 FROM public.attendance_sessions WHERE id = (SELECT id FROM correction_state)
      AND total_present = 2 AND total_absent = 1 AND total_late = 0 AND revision = 0) THEN
    RAISE EXCEPTION 'first submit did not create the correct register';
  END IF;
END $$;

SELECT public.update_attendance((SELECT id FROM correction_state), 0,
  '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"present"},
    {"student_id":"10000000-0000-4000-8000-000000000002","status":"present"},
    {"student_id":"10000000-0000-4000-8000-000000000003","status":"late"}]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.attendance_sessions WHERE class_id = '20000000-0000-4000-8000-000000000001'
      AND date = '2026-09-28') <> 1 THEN RAISE EXCEPTION 'duplicate session created'; END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.attendance_records WHERE session_id = (SELECT id FROM correction_state))
    IS DISTINCT FROM (SELECT record_ids FROM correction_state) THEN RAISE EXCEPTION 'record IDs were replaced'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.attendance_sessions WHERE id = (SELECT id FROM correction_state)
      AND total_present = 2 AND total_absent = 0 AND total_late = 1 AND revision = 1
      AND modified_by = '00000000-0000-4000-8000-000000000056') THEN
    RAISE EXCEPTION 'correction counts/version/editor are wrong';
  END IF;
  IF (SELECT count(*) FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state)
        AND j.status = 'cancelled') <> 1 THEN RAISE EXCEPTION 'pending absence was not cancelled'; END IF;
  BEGIN
    PERFORM public.submit_attendance('20000000-0000-4000-8000-000000000001', '2026-09-28', 'manual',
      '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"present"}]');
    RAISE EXCEPTION 'duplicate creation was allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.update_attendance((SELECT id FROM correction_state), 0,
      '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"absent"}]');
    RAISE EXCEPTION 'stale edit was allowed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;

-- Force failure only after an earlier record and its outbox trigger changed.
RESET ROLE;
CREATE FUNCTION pg_temp.reject_halfway_correction() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id = '10000000-0000-4000-8000-000000000003' AND NEW.status = 'absent' THEN
    IF NOT EXISTS (SELECT 1 FROM public.attendance_records WHERE session_id = NEW.session_id
      AND student_id = '10000000-0000-4000-8000-000000000001' AND status = 'absent') THEN
      RAISE EXCEPTION 'failure injection did not occur halfway';
    END IF;
    RAISE EXCEPTION 'forced halfway failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_halfway_correction BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE PROCEDURE pg_temp.reject_halfway_correction();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.update_attendance((SELECT id FROM correction_state), 1,
      '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"absent"},
        {"student_id":"10000000-0000-4000-8000-000000000002","status":"absent"},
        {"student_id":"10000000-0000-4000-8000-000000000003","status":"absent"}]');
    RAISE EXCEPTION 'forced failure did not roll back';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'forced halfway failure' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE session_id = (SELECT id FROM correction_state)
      AND status = 'absent') OR NOT EXISTS (SELECT 1 FROM public.attendance_sessions
      WHERE id = (SELECT id FROM correction_state) AND revision = 1 AND total_present = 2
        AND total_absent = 0 AND total_late = 1) THEN RAISE EXCEPTION 'partial correction survived'; END IF;
  IF (SELECT count(*) FROM public.communications WHERE metadata->>'attendance_session_id'
      = (SELECT id::TEXT FROM correction_state)) <> 1 THEN RAISE EXCEPTION 'partial outbox survived'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER test_halfway_correction ON public.attendance_records;

-- Assigned faculty can restore an absence without duplicating the cancelled job.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000057', true);
SELECT public.update_attendance((SELECT id FROM correction_state), 1,
  '[{"student_id":"10000000-0000-4000-8000-000000000002","status":"absent"}]');
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state)) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state) AND j.status = 'pending') THEN
    RAISE EXCEPTION 'restored absence did not reuse its pending job';
  END IF;
END $$;

-- Delivered history must survive subsequent correction.
UPDATE public.communication_jobs SET status = 'completed'
WHERE communication_id IN (SELECT id FROM public.communications
  WHERE metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state));
UPDATE public.communications SET provider_message_id = 'test-delivered-correction', message_status = 'delivered'
WHERE metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000056', true);
SELECT public.update_attendance((SELECT id FROM correction_state), 2,
  '[{"student_id":"10000000-0000-4000-8000-000000000002","status":"present"}]');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.communications WHERE provider_message_id = 'test-delivered-correction'
      AND message_status = 'delivered') THEN RAISE EXCEPTION 'delivered history was changed'; END IF;
END $$;

-- A genuinely new absence on an existing record gets one consented job.
SELECT public.update_attendance((SELECT id FROM correction_state), 3,
  '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"absent"}]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.communications WHERE metadata->>'attendance_session_id'
      = (SELECT id::TEXT FROM correction_state)) <> 2 OR NOT EXISTS (
      SELECT 1 FROM public.communication_jobs j JOIN public.communications c ON c.id = j.communication_id
      WHERE c.metadata->>'attendance_session_id' = (SELECT id::TEXT FROM correction_state)
        AND c.student_id = '10000000-0000-4000-8000-000000000001' AND j.status = 'pending') THEN
    RAISE EXCEPTION 'new correction absence did not enqueue exactly one pending job';
  END IF;
END $$;
SELECT public.update_attendance((SELECT id FROM correction_state), 4,
  '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"present"}]');

-- Unassigned faculty, students, and another tenant cannot modify the register.
DO $$ DECLARE identity UUID; BEGIN
  FOREACH identity IN ARRAY ARRAY['00000000-0000-4000-8000-000000000055'::UUID,
    '00000000-0000-4000-8000-000000000058'::UUID, '00000000-0000-4000-8000-000000000059'::UUID] LOOP
    PERFORM set_config('request.jwt.claim.sub', identity::TEXT, true);
    BEGIN
      PERFORM public.update_attendance((SELECT id FROM correction_state), 5,
        '[{"student_id":"10000000-0000-4000-8000-000000000001","status":"absent"}]');
      RAISE EXCEPTION 'unauthorized persona modified attendance';
    EXCEPTION WHEN insufficient_privilege OR no_data_found THEN NULL; END;
  END LOOP;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.attendance_sessions WHERE id = (SELECT id FROM correction_state))
    OR EXISTS (SELECT 1 FROM public.attendance_records WHERE session_id = (SELECT id FROM correction_state)) THEN
    RAISE EXCEPTION 'other tenant can read attendance';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
