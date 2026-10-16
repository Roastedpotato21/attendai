BEGIN;
CREATE TABLE public.sms_controlled_trials (
  execution_key TEXT PRIMARY KEY,
  institution_id UUID NOT NULL REFERENCES public.institutions(id),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id),
  student_id UUID NOT NULL REFERENCES public.students(id),
  parent_id UUID NOT NULL REFERENCES public.parents(id),
  communication_id UUID NOT NULL UNIQUE REFERENCES public.communications(id),
  job_id UUID NOT NULL UNIQUE REFERENCES public.communication_jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id,student_id,parent_id)
);
ALTER TABLE public.sms_controlled_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_controlled_trials FROM anon,authenticated;
GRANT SELECT ON public.sms_controlled_trials TO service_role;

-- Existing cancelled, never-attempted envelopes remain immutable history.
-- No failed/unknown/accepted provider attempt can be replaced through this path.
CREATE FUNCTION public.prepare_safe_sms_trial(p_execution_key TEXT,p_session UUID,p_student UUID,p_guardian UUID)
RETURNS public.sms_controlled_trials LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e RECORD; g RECORD; trial public.sms_controlled_trials; event_key TEXT; c_id UUID; j_id UUID;
BEGIN
  IF p_execution_key IS NULL OR length(p_execution_key) NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'invalid execution key'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_execution_key,1));
  SELECT * INTO trial FROM public.sms_controlled_trials WHERE execution_key=p_execution_key;
  IF FOUND THEN
    IF trial.session_id<>p_session OR trial.student_id<>p_student OR trial.parent_id<>p_guardian THEN
      RAISE EXCEPTION 'trial target mismatch'; END IF;
    RETURN trial;
  END IF;
  SELECT a.institution_id,s.date INTO e FROM public.attendance_records a
    JOIN public.attendance_sessions s ON s.id=a.session_id AND s.institution_id=a.institution_id
    WHERE a.session_id=p_session AND a.student_id=p_student AND a.status='absent' AND s.status='submitted'
      AND s.date BETWEEN CURRENT_DATE-14 AND CURRENT_DATE AND s.date<>'2026-10-05'::DATE
    FOR SHARE OF a,s;
  IF NOT FOUND THEN RAISE EXCEPTION 'no safe current absence'; END IF;
  SELECT p.language INTO g FROM public.parents p
    JOIN public.students st ON st.parent_id=p.id AND st.institution_id=p.institution_id
    JOIN public.student_parents sp ON sp.parent_id=p.id AND sp.student_id=st.id AND sp.institution_id=p.institution_id
    JOIN public.institutions i ON i.id=p.institution_id
    WHERE st.id=p_student AND p.id=p_guardian AND p.institution_id=e.institution_id
      AND st.enrollment_status='active' AND i.status='active' AND p.active AND p.communication_consent
      AND p.preferred_channel='sms' AND sp.receives_notifications
      AND regexp_replace(p.phone,'[ ()-]','','g') ~ '^\+91[6-9][0-9]{9}$' FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'guardian ineligible'; END IF;
  IF NOT COALESCE((SELECT sms_enabled FROM public.notification_channel_settings WHERE institution_id=e.institution_id),true)
    OR NOT public.sms_trial_rate_available(e.institution_id,p_guardian) THEN RAISE EXCEPTION 'SMS policy or rate limit'; END IF;
  event_key:=format('absence:%s:%s:%s:%s:sms',e.institution_id,e.date,p_student,p_guardian);
  PERFORM pg_advisory_xact_lock(hashtextextended(event_key,0));
  IF EXISTS(SELECT 1 FROM public.communications c WHERE c.institution_id=e.institution_id
    AND c.student_id=p_student AND c.parent_id=p_guardian AND c.type='sms'
    AND (c.metadata->>'attendance_session_id'=p_session::TEXT OR c.idempotency_key=event_key)
    AND (c.message_status IS DISTINCT FROM 'failed' OR c.provider_message_id IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.sms_dispatches d WHERE d.communication_id=c.id)
      OR NOT EXISTS(SELECT 1 FROM public.communication_jobs j WHERE j.communication_id=c.id)
      OR EXISTS(SELECT 1 FROM public.communication_jobs j WHERE j.communication_id=c.id
        AND (j.status<>'cancelled' OR j.attempts<>0 OR j.provider_request_started_at IS NOT NULL)))) THEN
    RAISE EXCEPTION 'prior SMS risk'; END IF;
  INSERT INTO public.communications(institution_id,student_id,parent_id,type,direction,message_status,sms_status,body,metadata,idempotency_key)
    VALUES(e.institution_id,p_student,p_guardian,'sms','outbound','queued','queued','Attendance absence notification.',
      jsonb_build_object('purpose','absence-alert','attendance_session_id',p_session,'attendance_date',e.date,
        'language',g.language,'controlled_trial',p_execution_key),event_key||':controlled:'||p_execution_key) RETURNING id INTO c_id;
  INSERT INTO public.communication_jobs(institution_id,communication_id,channel,payload,idempotency_key,max_attempts)
    VALUES(e.institution_id,c_id,'sms',jsonb_build_object('communication_id',c_id),event_key||':controlled:'||p_execution_key,1) RETURNING id INTO j_id;
  INSERT INTO public.sms_controlled_trials(execution_key,institution_id,session_id,student_id,parent_id,communication_id,job_id)
    VALUES(p_execution_key,e.institution_id,p_session,p_student,p_guardian,c_id,j_id) RETURNING * INTO trial;
  RETURN trial;
END $$;
REVOKE ALL ON FUNCTION public.prepare_safe_sms_trial(TEXT,UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_safe_sms_trial(TEXT,UUID,UUID,UUID) TO service_role;
COMMIT;
