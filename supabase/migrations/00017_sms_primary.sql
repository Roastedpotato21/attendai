-- SMS and push are independent outboxes. Existing history is never rewritten.
BEGIN;

CREATE TABLE public.notification_channel_settings (
  institution_id UUID PRIMARY KEY REFERENCES public.institutions(id),
  sms_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.notification_channel_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_channel_settings FROM anon, authenticated;
GRANT ALL ON public.notification_channel_settings TO service_role;

CREATE TABLE public.sms_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  communication_id UUID NOT NULL REFERENCES public.communications(id),
  job_id UUID NOT NULL REFERENCES public.communication_jobs(id),
  attempt INT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'twilio',
  status TEXT NOT NULL DEFAULT 'sending',
  provider_message_id TEXT,
  http_status INT,
  provider_code TEXT,
  error_message TEXT,
  request_body TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE(job_id, attempt)
);
ALTER TABLE public.sms_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_dispatches FROM anon, authenticated;
GRANT ALL ON public.sms_dispatches TO service_role;

-- Used by new-event trigger and the explicitly authorized existing-absence path.
-- A prior envelope, including an uncertain attempt, always prevents a second job.
CREATE FUNCTION public.enqueue_absence_sms(
  p_session UUID, p_student UUID, p_guardian UUID, p_max_attempts INT DEFAULT 3
) RETURNS TABLE(communication_id UUID, job_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e RECORD; g RECORD; event_key TEXT; c_id UUID; j_id UUID;
BEGIN
  IF p_max_attempts NOT BETWEEN 1 AND 3 OR p_max_attempts IS NULL THEN
    RAISE EXCEPTION 'invalid attempt budget';
  END IF;
  SELECT a.institution_id, s.date INTO e
  FROM public.attendance_records a JOIN public.attendance_sessions s
    ON s.id = a.session_id AND s.institution_id = a.institution_id
  WHERE a.session_id = p_session AND a.student_id = p_student AND a.status = 'absent'
    AND s.status = 'submitted' AND s.date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE
  FOR SHARE OF a, s;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT p.id, p.language INTO g FROM public.parents p
  JOIN public.students st ON st.parent_id = p.id AND st.institution_id = p.institution_id
  JOIN public.student_parents sp ON sp.parent_id = p.id AND sp.student_id = st.id
    AND sp.institution_id = p.institution_id
  JOIN public.institutions i ON i.id = p.institution_id
  WHERE st.id = p_student AND p.id = p_guardian AND p.institution_id = e.institution_id
    AND st.enrollment_status = 'active' AND i.status = 'active'
    AND p.active AND p.communication_consent AND p.preferred_channel = 'sms'
    AND sp.receives_notifications
  FOR UPDATE OF p;
  IF NOT FOUND OR NOT COALESCE((SELECT sms_enabled FROM public.notification_channel_settings
    WHERE institution_id = e.institution_id), true) THEN RETURN; END IF;
  event_key := format('absence:%s:%s:%s:%s:sms', e.institution_id,e.date,p_student,p_guardian);
  PERFORM pg_advisory_xact_lock(hashtextextended(event_key,0));
  IF EXISTS (SELECT 1 FROM public.communications c WHERE c.institution_id = e.institution_id
    AND c.student_id = p_student AND c.parent_id = p_guardian AND c.type = 'sms'
    AND (c.idempotency_key = event_key OR c.metadata->>'attendance_session_id' = p_session::TEXT))
    THEN RETURN; END IF;
  INSERT INTO public.communications
    (institution_id,student_id,parent_id,type,direction,message_status,sms_status,body,metadata,idempotency_key)
  VALUES(e.institution_id,p_student,p_guardian,'sms','outbound','queued','queued',
    'Attendance absence notification.',jsonb_build_object('purpose','absence-alert',
      'attendance_session_id',p_session,'attendance_date',e.date,'language',g.language),event_key)
  RETURNING id INTO c_id;
  INSERT INTO public.communication_jobs
    (institution_id,communication_id,channel,payload,idempotency_key,max_attempts)
  VALUES(e.institution_id,c_id,'sms',jsonb_build_object('communication_id',c_id),event_key,p_max_attempts)
  RETURNING id INTO j_id;
  RETURN QUERY SELECT c_id,j_id;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_absence_sms(UUID,UUID,UUID,INT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_absence_sms(UUID,UUID,UUID,INT) TO service_role;

CREATE FUNCTION public.enqueue_sms_absence_communication() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE guardian UUID;
BEGIN
  SELECT parent_id INTO guardian FROM public.students
    WHERE id = NEW.student_id AND institution_id = NEW.institution_id;
  PERFORM public.enqueue_absence_sms(NEW.session_id,NEW.student_id,guardian);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_sms_absence_communication() FROM PUBLIC,anon,authenticated;
-- PostgreSQL runs same-event triggers alphabetically: SMS becomes eligible first.
CREATE TRIGGER enqueue_0_sms_absence AFTER INSERT OR UPDATE OF status ON public.attendance_records
  FOR EACH ROW WHEN (NEW.status = 'absent') EXECUTE FUNCTION public.enqueue_sms_absence_communication();

-- Retain the push trigger, history, and its existing idempotency keys. Add a
-- per-institution gate without making either channel depend on the other.
DO $$ DECLARE definition TEXT; BEGIN
  SELECT pg_get_functiondef('public.enqueue_absence_communication()'::regprocedure) INTO definition;
  IF position('IF NEW.status <> ''absent'' THEN RETURN NEW; END IF;' IN definition)=0 THEN
    RAISE EXCEPTION 'unexpected push enqueue definition'; END IF;
  definition := replace(definition,
    'IF NEW.status <> ''absent'' THEN RETURN NEW; END IF;',
    'IF NEW.status <> ''absent'' OR NOT COALESCE((SELECT push_enabled FROM public.notification_channel_settings WHERE institution_id = NEW.institution_id), true) THEN RETURN NEW; END IF;');
  EXECUTE definition;
END $$;

-- Recheck business eligibility at the last database boundary before the POST.
CREATE OR REPLACE FUNCTION public.mark_sms_dispatch_started(p_job UUID,p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; c public.communications; cap INT; window_size INTERVAL;
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.channel <> 'sms' OR j.status <> 'processing'
    OR j.lease_owner IS DISTINCT FROM p_owner OR j.locked_at < now() - INTERVAL '15 minutes'
    OR j.provider_request_started_at IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO c FROM public.communications WHERE id = j.communication_id
    AND institution_id = j.institution_id FOR UPDATE;
  IF NOT FOUND OR c.type <> 'sms' OR c.provider_message_id IS NOT NULL
    OR c.message_status <> 'queued' THEN RETURN false; END IF;
  PERFORM 1 FROM public.parents p JOIN public.students s
    ON s.parent_id = p.id AND s.institution_id = p.institution_id
  JOIN public.student_parents sp ON sp.student_id = s.id AND sp.parent_id = p.id
    AND sp.institution_id = p.institution_id
  JOIN public.institutions i ON i.id = p.institution_id
  WHERE s.id = c.student_id AND p.id = c.parent_id AND p.institution_id = c.institution_id
    AND s.enrollment_status = 'active' AND i.status = 'active' AND p.active
    AND p.communication_consent AND p.preferred_channel = 'sms' AND sp.receives_notifications
    AND regexp_replace(p.phone,'[ ()-]','','g') ~ '^\+[1-9][0-9]{7,14}$'
  FOR UPDATE OF p;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.attendance_records a JOIN public.attendance_sessions s
    ON s.id = a.session_id AND s.institution_id = a.institution_id
  WHERE a.student_id = c.student_id AND a.institution_id = c.institution_id
    AND a.session_id::TEXT = c.metadata->>'attendance_session_id'
    AND a.status = 'absent' AND s.status = 'submitted'
    AND s.date BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE
  FOR SHARE OF a,s;
  IF NOT FOUND OR NOT COALESCE((SELECT sms_enabled FROM public.notification_channel_settings
    WHERE institution_id = c.institution_id),true) THEN RETURN false; END IF;
  SELECT max_per_parent_per_window,window_length INTO cap,window_size
    FROM public.communication_rate_limits WHERE institution_id = c.institution_id;
  IF (SELECT count(*) FROM public.sms_dispatches d JOIN public.communications m
    ON m.id=d.communication_id AND m.institution_id=d.institution_id
    WHERE d.institution_id=c.institution_id AND m.parent_id=c.parent_id
      AND d.started_at >= now()-COALESCE(window_size,INTERVAL '1 hour')) >= COALESCE(cap,3)
    THEN RETURN false; END IF;
  UPDATE public.communication_jobs SET provider_request_started_at=now() WHERE id=j.id;
  RETURN true;
END $$;

-- Save the exact provider body before the network boundary, even on rejection.
CREATE FUNCTION public.begin_sms_dispatch(p_job UUID,p_owner UUID,p_body TEXT,p_template UUID,p_recipient TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs;
BEGIN
  IF NOT public.mark_sms_dispatch_started(p_job,p_owner) THEN RETURN false; END IF;
  SELECT * INTO j FROM public.communication_jobs WHERE id=p_job;
  IF NOT EXISTS(SELECT 1 FROM public.sms_templates t JOIN public.communications c
    ON c.id=j.communication_id AND c.institution_id=t.institution_id
    JOIN public.parents p ON p.id=c.parent_id AND p.institution_id=c.institution_id
    WHERE t.id=p_template AND t.active AND t.channel='sms'
      AND regexp_replace(p.phone,'[ ()-]','','g')=p_recipient)
    OR length(btrim(p_body))=0 OR length(p_body)>280 THEN
    RAISE EXCEPTION 'SMS dispatch payload is invalid';
  END IF;
  INSERT INTO public.sms_dispatches(institution_id,communication_id,job_id,attempt,request_body)
    VALUES(j.institution_id,j.communication_id,j.id,j.attempts,p_body);
  UPDATE public.communications SET body=p_body,template_id=p_template,parent_phone=p_recipient,
    provider_name='twilio' WHERE id=j.communication_id AND institution_id=j.institution_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.begin_sms_dispatch(UUID,UUID,TEXT,UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_sms_dispatch(UUID,UUID,TEXT,UUID,TEXT) TO service_role;

-- Targeted operator trial: never consume any other guardian's queue or retry.
CREATE FUNCTION public.claim_sms_trial_job(p_job UUID)
RETURNS SETOF public.communication_jobs LANGUAGE sql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  UPDATE public.communication_jobs SET status='processing',attempts=1,
    locked_at=now(),lease_owner=gen_random_uuid()
  WHERE id=p_job AND channel='sms' AND status='pending' AND attempts=0
    AND max_attempts=1 AND provider_request_started_at IS NULL AND next_run_at<=now()
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.claim_sms_trial_job(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_trial_job(UUID) TO service_role;

CREATE FUNCTION public.sms_trial_rate_available(p_institution UUID,p_guardian UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT count(*) < COALESCE((SELECT max_per_parent_per_window FROM public.communication_rate_limits
    WHERE institution_id=p_institution),3)
  FROM public.sms_dispatches d JOIN public.communications c
    ON c.id=d.communication_id AND c.institution_id=d.institution_id
  WHERE d.institution_id=p_institution AND c.parent_id=p_guardian
    AND d.started_at>=now()-COALESCE((SELECT window_length FROM public.communication_rate_limits
      WHERE institution_id=p_institution),INTERVAL '1 hour');
$$;
REVOKE ALL ON FUNCTION public.sms_trial_rate_available(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_trial_rate_available(UUID,UUID) TO service_role;

-- Extend existing finish/callback behavior; no mutation of historical rows.
ALTER FUNCTION public.finish_communication_job(UUID,UUID,JSONB) RENAME TO finish_communication_job_legacy;
REVOKE ALL ON FUNCTION public.finish_communication_job_legacy(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finish_communication_job(p_job UUID,p_owner UUID,p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE success BOOLEAN; BEGIN
  success:=public.finish_communication_job_legacy(p_job,p_owner,p_result);
  IF success THEN
    UPDATE public.sms_dispatches SET
      status=CASE WHEN status IN ('delivered','failed','undelivered') THEN status
        WHEN (p_result->>'ok')::BOOLEAN THEN COALESCE(p_result->>'status','queued')
        WHEN p_result->>'errorClass'='ambiguous' THEN 'unconfirmed' ELSE 'failed' END,
      provider_message_id=COALESCE(provider_message_id,p_result->>'providerId'),
      http_status=(p_result->>'httpStatus')::INT,provider_code=p_result->>'providerCode',
      error_message=p_result->>'message',finished_at=now()
    WHERE job_id=p_job AND attempt=(SELECT attempts FROM public.communication_jobs WHERE id=p_job);
  END IF;
  RETURN success;
END $$;
REVOKE ALL ON FUNCTION public.finish_communication_job(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_communication_job(UUID,UUID,JSONB) TO service_role;

CREATE FUNCTION public.sync_sms_dispatch_status() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.type='sms' THEN
    UPDATE public.sms_dispatches SET status=NEW.sms_status,
      provider_message_id=COALESCE(provider_message_id,NEW.provider_message_id)
    WHERE communication_id=NEW.id AND institution_id=NEW.institution_id
      AND (provider_message_id IS NULL OR provider_message_id=NEW.provider_message_id)
      AND status IN ('sending','queued','sent','unconfirmed') AND NEW.sms_status IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_sms_dispatch_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_sms_dispatch_status AFTER UPDATE OF sms_status ON public.communications
  FOR EACH ROW EXECUTE FUNCTION public.sync_sms_dispatch_status();
COMMIT;
