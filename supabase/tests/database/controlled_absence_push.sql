-- Local-only regression for a historical submitted absence with one device.
BEGIN;

INSERT INTO public.guardian_notification_installations
  (institution_id, guardian_id, firebase_installation_id,
   firebase_project_id, device_secret_hash, permission_state)
VALUES
  ('11111111-1111-4111-8111-111111111111',
   '30000000-0000-4000-8000-000000000001',
   'fid-controlled-once-0001', 'attendai-41f64', repeat('9', 64), 'granted');

INSERT INTO public.attendance_sessions
  (id, class_id, date, method, total_present, total_absent, total_late,
   submitted_by, submitted_at, status)
VALUES
  ('65000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001',
   CURRENT_DATE - 1, 'faculty', 1, 0, 0,
   '00000000-0000-4000-8000-000000000002', now(), 'submitted');
INSERT INTO public.attendance_records (session_id, student_id, status)
VALUES ('65000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'present');
-- Model an absence recorded before the push trigger was installed. The current
-- trigger handles both INSERT and UPDATE, so suspend it only for this fixture.
ALTER TABLE public.attendance_records
  DISABLE TRIGGER enqueue_absence_communication_after_attendance_record;
UPDATE public.attendance_records SET status = 'absent'
WHERE session_id = '65000000-0000-4000-8000-000000000001'
  AND student_id = '10000000-0000-4000-8000-000000000001';
ALTER TABLE public.attendance_records
  ENABLE TRIGGER enqueue_absence_communication_after_attendance_record;

DO $$ DECLARE device_id UUID; created RECORD; BEGIN
  SELECT id INTO device_id FROM public.guardian_notification_installations
  WHERE firebase_installation_id = 'fid-controlled-once-0001';
  SELECT * INTO created FROM public.enqueue_existing_absence_push(
    '65000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', device_id);
  IF created.communication_id IS NULL OR created.job_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.communication_jobs j
       WHERE j.id = created.job_id AND j.channel = 'push'
         AND j.max_attempts = 1 AND j.status = 'pending'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.communications c
       WHERE c.id = created.communication_id AND c.type = 'push'
         AND c.metadata->>'attendance_session_id' =
           '65000000-0000-4000-8000-000000000001'
         AND c.metadata->>'attendance_date' = (CURRENT_DATE - 1)::TEXT
     ) THEN RAISE EXCEPTION 'controlled enqueue did not create one bounded job'; END IF;
  BEGIN
    PERFORM public.enqueue_existing_absence_push(
      '65000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', device_id);
    RAISE EXCEPTION 'duplicate controlled push was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_existing_absence_push(
      '65000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'browser role invoked controlled enqueue';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

ROLLBACK;
