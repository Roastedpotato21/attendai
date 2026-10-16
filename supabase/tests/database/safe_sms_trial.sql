BEGIN;
UPDATE public.parents SET phone='+919876543210',preferred_channel='sms',communication_consent=true,active=true
WHERE id='30000000-0000-4000-8000-000000000001';
INSERT INTO public.attendance_sessions(id,class_id,date,method,total_present,total_absent,total_late,submitted_by,submitted_at,status)
VALUES('68000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  CURRENT_DATE-2,'faculty',0,1,0,'00000000-0000-4000-8000-000000000002',now(),'submitted');
INSERT INTO public.attendance_records(session_id,student_id,status)
VALUES('68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','absent');
DO $$ DECLARE old_id UUID; old_job UUID; original JSONB; trial public.sms_controlled_trials; again public.sms_controlled_trials; j public.communication_jobs; BEGIN
  SELECT c.id,q.id INTO old_id,old_job FROM public.communications c JOIN public.communication_jobs q ON q.communication_id=c.id
    WHERE c.type='sms' AND c.metadata->>'attendance_session_id'='68000000-0000-4000-8000-000000000001';
  -- A pending original is not eligible for a replacement.
  BEGIN
    PERFORM public.prepare_safe_sms_trial('safe-trial-test','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'pending SMS allowed replacement';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'prior SMS risk' THEN RAISE; END IF; END;
  UPDATE public.communications SET message_status='failed',sms_status='failed',error_details='Cancelled without attempt' WHERE id=old_id;
  UPDATE public.communication_jobs SET status='cancelled',last_error='Cancelled without attempt' WHERE id=old_job;
  -- Even a cancelled job is unsafe if a provider boundary was crossed.
  UPDATE public.communication_jobs SET attempts=1,provider_request_started_at=now() WHERE id=old_job;
  BEGIN
    PERFORM public.prepare_safe_sms_trial('safe-trial-test','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'uncertain SMS allowed replacement';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'prior SMS risk' THEN RAISE; END IF; END;
  UPDATE public.communication_jobs SET attempts=0,provider_request_started_at=NULL WHERE id=old_job;
  SELECT to_jsonb(c) INTO original FROM public.communications c WHERE id=old_id;
  trial:=public.prepare_safe_sms_trial('safe-trial-test','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
  again:=public.prepare_safe_sms_trial('safe-trial-test','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
  IF trial.job_id IS DISTINCT FROM again.job_id OR trial.communication_id=old_id THEN RAISE EXCEPTION 'trial is not separate and idempotent'; END IF;
  IF original IS DISTINCT FROM (SELECT to_jsonb(c) FROM public.communications c WHERE id=old_id) THEN RAISE EXCEPTION 'history overwritten'; END IF;
  BEGIN
    PERFORM public.prepare_safe_sms_trial('another-trial-test','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'second execution allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'prior SMS risk' THEN RAISE; END IF; END;
  SELECT * INTO j FROM public.claim_sms_trial_job(trial.job_id);
  IF j.max_attempts<>1 OR j.attempts<>1 OR EXISTS(SELECT 1 FROM public.claim_sms_trial_job(trial.job_id)) THEN RAISE EXCEPTION 'claim not one-use'; END IF;
  PERFORM public.finish_communication_job(j.id,j.lease_owner,'{"ok":false,"errorClass":"ambiguous","message":"unknown"}');
  IF (SELECT status FROM public.communication_jobs WHERE id=j.id)<>'dead_letter' THEN RAISE EXCEPTION 'uncertain trial retried'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.prepare_safe_sms_trial('forged-trial','68000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'browser created trial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
