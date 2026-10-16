BEGIN;
-- All mutations are disposable fixtures and roll back at the end.
UPDATE public.parents SET phone='+919876543210', preferred_channel='sms',
  communication_consent=true,active=true
WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO public.sms_templates(institution_id,event_type,language,content,approved_variables,active)
VALUES('11111111-1111-4111-8111-111111111111','absence-alert','en',
  '{{student_name}} absent {{attendance_date}}',ARRAY['student_name','attendance_date'],true);
INSERT INTO public.attendance_sessions(id,class_id,date,method,total_present,total_absent,total_late,submitted_by,submitted_at,status)
VALUES('66000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  CURRENT_DATE-2,'faculty',0,1,0,'00000000-0000-4000-8000-000000000002',now(),'submitted');
INSERT INTO public.attendance_records(session_id,student_id,status)
VALUES('66000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','absent');

DO $$ DECLARE j public.communication_jobs; t UUID; sid TEXT; BEGIN
  IF (SELECT count(DISTINCT type) FROM public.communications
      WHERE metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000001')<>2 THEN
    RAISE EXCEPTION 'absence must enqueue independent SMS and push'; END IF;
  IF EXISTS(SELECT 1 FROM public.guardian_notification_installations WHERE active) THEN
    RAISE EXCEPTION 'fixture must have no enrolled push devices'; END IF;
  PERFORM public.enqueue_absence_sms('66000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1);
  IF (SELECT count(*) FROM public.communications WHERE type='sms'
    AND metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000001')<>1 THEN
    RAISE EXCEPTION 'duplicate SMS enqueued'; END IF;
  SELECT * INTO j FROM public.claim_communication_jobs(100)
    WHERE communication_id IN(SELECT id FROM public.communications WHERE type='sms'
      AND metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000001');
  IF j.id IS NULL THEN RAISE EXCEPTION 'SMS cannot be claimed independently'; END IF;
  SELECT id INTO t FROM public.sms_templates WHERE institution_id=j.institution_id AND language='en';
  UPDATE public.parents SET communication_consent=false WHERE id='30000000-0000-4000-8000-000000000001';
  IF public.mark_sms_dispatch_started(j.id,j.lease_owner) THEN RAISE EXCEPTION 'revoked consent passed fence'; END IF;
  UPDATE public.parents SET communication_consent=true WHERE id='30000000-0000-4000-8000-000000000001';
  UPDATE public.student_parents SET receives_notifications=false WHERE student_id='10000000-0000-4000-8000-000000000001';
  IF public.mark_sms_dispatch_started(j.id,j.lease_owner) THEN RAISE EXCEPTION 'revoked relationship passed fence'; END IF;
  UPDATE public.student_parents SET receives_notifications=true WHERE student_id='10000000-0000-4000-8000-000000000001';
  UPDATE public.attendance_records SET status='present' WHERE session_id='66000000-0000-4000-8000-000000000001';
  IF public.mark_sms_dispatch_started(j.id,j.lease_owner) THEN RAISE EXCEPTION 'corrected absence passed fence'; END IF;
  UPDATE public.attendance_records SET status='absent' WHERE session_id='66000000-0000-4000-8000-000000000001';
  IF public.mark_sms_dispatch_started(j.id,gen_random_uuid()) THEN RAISE EXCEPTION 'foreign lease passed fence'; END IF;
  BEGIN
    UPDATE public.communication_jobs SET institution_id='22222222-2222-4222-8222-222222222222' WHERE id=j.id;
    RAISE EXCEPTION 'cross tenant dispatch was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF NOT public.begin_sms_dispatch(j.id,j.lease_owner,'Student absent today',t,'+919876543210') THEN
    RAISE EXCEPTION 'eligible SMS was blocked without FCM device'; END IF;
  IF public.begin_sms_dispatch(j.id,j.lease_owner,'Student absent today',t,'+919876543210') THEN
    RAISE EXCEPTION 'duplicate provider attempt allowed'; END IF;
  IF NOT public.finish_communication_job(j.id,j.lease_owner,
    '{"ok":false,"errorClass":"permanent","httpStatus":422,"providerCode":"572002","message":"trial rejected"}') THEN
    RAISE EXCEPTION 'SMS rejection not persisted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sms_dispatches WHERE job_id=j.id AND status='failed'
    AND http_status=422 AND provider_code='572002' AND request_body='Student absent today') THEN
    RAISE EXCEPTION 'SMS attempt evidence missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.communication_jobs q JOIN public.communications c ON c.id=q.communication_id
    WHERE q.channel='push' AND q.status='pending'
      AND c.metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'SMS failure affected push'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.attendance_records WHERE session_id='66000000-0000-4000-8000-000000000001'
    AND status='absent') THEN RAISE EXCEPTION 'SMS failure affected attendance'; END IF;
END $$;

-- Opting out of push must not affect creation of an SMS path.
INSERT INTO public.notification_channel_settings(institution_id,push_enabled)
VALUES('11111111-1111-4111-8111-111111111111',false);
INSERT INTO public.attendance_sessions(id,class_id,date,method,total_present,total_absent,total_late,submitted_by,submitted_at,status)
VALUES('66000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',
  CURRENT_DATE-3,'faculty',0,1,0,'00000000-0000-4000-8000-000000000002',now(),'submitted');
INSERT INTO public.attendance_records(session_id,student_id,status)
VALUES('66000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','absent');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.communications WHERE metadata->>'attendance_session_id'=
    '66000000-0000-4000-8000-000000000002')<>1 OR NOT EXISTS(SELECT 1 FROM public.communications
    WHERE type='sms' AND metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'disabled push blocked SMS or created push'; END IF;
END $$;
UPDATE public.attendance_records SET status='present' WHERE session_id='66000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.communication_jobs j JOIN public.communications c ON c.id=j.communication_id
    WHERE c.metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000002' AND j.status='cancelled') THEN
    RAISE EXCEPTION 'pending SMS was not cancelled after correction'; END IF;
END $$;
-- The controlled path claims one named job once and exhausts even a 429.
INSERT INTO public.attendance_sessions(id,class_id,date,method,total_present,total_absent,total_late,submitted_by,submitted_at,status)
VALUES('66000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',
  CURRENT_DATE-4,'faculty',0,1,0,'00000000-0000-4000-8000-000000000002',now(),'submitted');
INSERT INTO public.attendance_records(session_id,student_id,status)
VALUES('66000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','absent');
DO $$ DECLARE j public.communication_jobs; BEGIN
  SELECT q.* INTO j FROM public.communication_jobs q JOIN public.communications c ON c.id=q.communication_id
    WHERE c.type='sms' AND c.metadata->>'attendance_session_id'='66000000-0000-4000-8000-000000000003';
  IF EXISTS(SELECT 1 FROM public.claim_sms_trial_job(j.id)) THEN RAISE EXCEPTION 'trial accepted retryable job'; END IF;
  UPDATE public.communication_jobs SET max_attempts=1 WHERE id=j.id;
  SELECT * INTO j FROM public.claim_sms_trial_job(j.id);
  IF j.id IS NULL OR EXISTS(SELECT 1 FROM public.claim_sms_trial_job(j.id)) THEN
    RAISE EXCEPTION 'trial claim is not exactly once'; END IF;
  INSERT INTO public.communication_rate_limits(institution_id,max_per_parent_per_window)
    VALUES(j.institution_id,1) ON CONFLICT(institution_id) DO UPDATE SET max_per_parent_per_window=1;
  IF public.sms_trial_rate_available(j.institution_id,'30000000-0000-4000-8000-000000000001')
    OR public.mark_sms_dispatch_started(j.id,j.lease_owner) THEN RAISE EXCEPTION 'SMS rate limit bypassed'; END IF;
  PERFORM public.finish_communication_job(j.id,j.lease_owner,'{"ok":false,"errorClass":"transient","message":"429 rejected"}');
  IF (SELECT status FROM public.communication_jobs WHERE id=j.id)<>'dead_letter' THEN
    RAISE EXCEPTION 'single-attempt trial scheduled a retry'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_absence_sms('66000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'browser could enqueue an arbitrary SMS';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.sms_dispatches) THEN RAISE EXCEPTION 'browser read private SMS dispatch'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
