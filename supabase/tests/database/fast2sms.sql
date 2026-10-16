BEGIN;
UPDATE public.parents SET phone='+919876543210',preferred_channel='sms',communication_consent=true,active=true
WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO public.sms_templates(institution_id,event_type,language,content,approved_variables,active)
VALUES('11111111-1111-4111-8111-111111111111','absence-alert','en',
  '{{student_name}} absent {{attendance_date}}',ARRAY['student_name','attendance_date'],true);
INSERT INTO public.attendance_sessions(id,class_id,date,method,total_present,total_absent,total_late,submitted_by,submitted_at,status)
VALUES('67000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  CURRENT_DATE-1,'faculty',0,1,0,'00000000-0000-4000-8000-000000000002',now(),'submitted');
INSERT INTO public.attendance_records(session_id,student_id,status)
VALUES('67000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','absent');
DO $$ DECLARE j public.communication_jobs; t UUID; report JSONB; before_history JSONB; BEGIN
  SELECT jsonb_agg(to_jsonb(c)) INTO before_history FROM public.communications c WHERE provider_name='twilio';
  SELECT q.* INTO j FROM public.communication_jobs q JOIN public.communications c ON c.id=q.communication_id
    WHERE c.type='sms' AND c.metadata->>'attendance_session_id'='67000000-0000-4000-8000-000000000001';
  UPDATE public.communication_jobs SET max_attempts=1 WHERE id=j.id;
  SELECT * INTO j FROM public.claim_sms_trial_job(j.id);
  SELECT id INTO t FROM public.sms_templates WHERE institution_id=j.institution_id AND language='en';
  IF NOT public.begin_sms_dispatch(j.id,j.lease_owner,'Student absent today',t,'+919876543210') THEN
    RAISE EXCEPTION 'valid Fast2SMS dispatch denied'; END IF;
  IF public.begin_sms_dispatch(j.id,j.lease_owner,'Student absent today',t,'+919876543210') THEN
    RAISE EXCEPTION 'duplicate Fast2SMS dispatch'; END IF;
  BEGIN
    PERFORM public.apply_communication_callback('SMforeign','delivered',j.communication_id);
    RAISE EXCEPTION 'legacy callback hijacked Fast2SMS';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'unknown provider message ID' THEN RAISE; END IF;
  END;
  IF NOT public.finish_communication_job(j.id,j.lease_owner,
    '{"ok":true,"provider":"fast2sms","providerId":"fast-db-test","status":"queued","httpStatus":200,"safeResponseBody":"safe provider response","diagnostics":{"stage":"provider_response","elapsedMs":10}}') THEN
    RAISE EXCEPTION 'acceptance not persisted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sms_dispatches WHERE job_id=j.id AND provider='fast2sms'
    AND provider_message_id='fast-db-test' AND status='submitted' AND provider_status='accepted' AND submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Fast2SMS request ID or submission metadata missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sms_dispatches WHERE job_id=j.id
    AND safe_response_body='safe provider response' AND transport_diagnostics->>'stage'='provider_response') THEN
    RAISE EXCEPTION 'Fast2SMS sanitized response evidence missing'; END IF;
  IF (SELECT message_status FROM public.communications WHERE id=j.communication_id)='delivered' THEN
    RAISE EXCEPTION 'acceptance falsely became delivery'; END IF;
  report:=public.apply_fast2sms_report('fast-db-test','pending','pending');
  IF report->>'status'='delivered' THEN RAISE EXCEPTION 'pending falsely became delivery'; END IF;
  report:=public.apply_fast2sms_report('fast-db-test','delivered','confirmed');
  IF report->>'status'<>'delivered' THEN RAISE EXCEPTION 'delivery was not persisted'; END IF;
  report:=public.apply_fast2sms_report('fast-db-test','delivered','confirmed');
  IF NOT (report->>'duplicate')::BOOLEAN THEN RAISE EXCEPTION 'duplicate report not idempotent'; END IF;
  report:=public.apply_fast2sms_report('fast-db-test','failed','late contradictory status');
  IF report->>'status'<>'delivered' THEN RAISE EXCEPTION 'terminal status regressed'; END IF;
  BEGIN
    PERFORM public.apply_fast2sms_report('foreign-request','delivered','confirmed');
    RAISE EXCEPTION 'unknown request accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'unknown Fast2SMS request' THEN RAISE; END IF;
  END;
  IF before_history IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(c)) FROM public.communications c WHERE provider_name='twilio') THEN
    RAISE EXCEPTION 'Twilio history modified'; END IF;
  IF EXISTS(SELECT 1 FROM public.enqueue_absence_sms('67000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1)) THEN
    RAISE EXCEPTION 'provider switch weakened event deduplication'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.apply_fast2sms_report('fast-db-test','delivered','forged');
    RAISE EXCEPTION 'browser forged delivery';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
