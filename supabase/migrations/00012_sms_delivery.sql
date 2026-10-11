-- SMS delivery hardening. Existing attendance/outbox migrations remain unchanged.
BEGIN;

-- The outbox records uncertain outcomes explicitly; the original Phase 2
-- status constraints predate these states.
ALTER TABLE public.communications
  DROP CONSTRAINT communications_message_status_check,
  DROP CONSTRAINT communications_sms_status_check;
ALTER TABLE public.communications
  ADD CONSTRAINT communications_message_status_check CHECK (
    message_status IS NULL OR message_status IN
      ('queued', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'unconfirmed')
  ),
  ADD CONSTRAINT communications_sms_status_check CHECK (
    sms_status IS NULL OR sms_status IN
      ('queued', 'sent', 'delivered', 'failed', 'undelivered', 'unconfirmed')
  );

CREATE TABLE public.sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type = 'absence-alert'),
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel = 'sms'),
  language public.language_type NOT NULL,
  content TEXT NOT NULL CHECK (length(btrim(content)) > 0 AND length(content) <= 1000),
  approved_variables TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (approved_variables <@ ARRAY['institution_name','guardian_name','student_name','attendance_date']::TEXT[]),
  active BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT sms_templates_active_required_variables CHECK (
    NOT active OR ('student_name' = ANY(approved_variables)
      AND 'attendance_date' = ANY(approved_variables))
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (institution_id, event_type, channel, language)
);
CREATE TRIGGER set_timestamp_sms_templates BEFORE UPDATE ON public.sms_templates
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();
ALTER TABLE public.sms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY sms_templates_staff_read ON public.sms_templates FOR SELECT TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin','staff','faculty']::user_role[]));
CREATE POLICY sms_templates_admin_manage ON public.sms_templates FOR ALL TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin']::user_role[]))
  WITH CHECK (public.has_institution_role(institution_id, ARRAY['admin']::user_role[]));

-- A browser may inspect its permitted SMS history, but may not fabricate a
-- send, provider SID, delivery status, or bypass the durable outbox.
DROP POLICY IF EXISTS communications_manage ON public.communications;
CREATE POLICY communications_manage_non_sms ON public.communications FOR ALL TO authenticated
  USING (public.can_manage_student(student_id) AND type <> 'sms')
  WITH CHECK (public.can_manage_student(student_id) AND type <> 'sms');

ALTER TABLE public.communication_jobs
  ADD COLUMN provider_request_started_at TIMESTAMPTZ;

-- Mark an outbound attempt before issuing the POST. A crash or lost HTTP
-- response after this point must not cause an automatic paid resend.
CREATE FUNCTION public.mark_sms_dispatch_started(p_job UUID, p_owner UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE updated_id UUID;
BEGIN
  UPDATE public.communication_jobs SET provider_request_started_at = now()
  WHERE id = p_job AND lease_owner = p_owner AND channel = 'sms'
    AND status = 'processing' AND provider_request_started_at IS NULL
    AND locked_at >= now() - INTERVAL '15 minutes'
  RETURNING id INTO updated_id;
  RETURN updated_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_sms_dispatch_started(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_dispatch_started(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_communication_jobs(p_limit INT DEFAULT 20)
RETURNS SETOF public.communication_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  UPDATE public.communications c
  SET message_status = 'unconfirmed', sms_status = 'unconfirmed',
      error_details = 'Provider outcome unknown; manual reconciliation required'
  FROM public.communication_jobs j
  WHERE j.communication_id = c.id AND j.institution_id = c.institution_id
    AND j.channel = 'sms' AND j.status = 'processing'
    AND j.locked_at < now() - INTERVAL '15 minutes'
    AND j.provider_request_started_at IS NOT NULL
    AND c.provider_message_id IS NULL AND c.message_status IN ('queued','sent');

  UPDATE public.communication_jobs
  SET status = CASE
        WHEN provider_request_started_at IS NOT NULL OR attempts >= max_attempts
          THEN 'dead_letter' ELSE 'pending' END,
      locked_at = NULL, lease_owner = NULL,
      last_error = CASE WHEN provider_request_started_at IS NOT NULL
        THEN 'Provider outcome unknown; manual reconciliation required'
        ELSE COALESCE(last_error, 'worker lease expired') END
  WHERE status = 'processing' AND locked_at < now() - INTERVAL '15 minutes';

  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.communication_jobs
    WHERE status = 'pending' AND attempts < max_attempts AND next_run_at <= now()
    ORDER BY next_run_at, created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.communication_jobs job
  SET status = 'processing', attempts = attempts + 1, locked_at = now(),
      lease_owner = gen_random_uuid()
  FROM claimed WHERE job.id = claimed.id RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_communication_job(p_job UUID, p_owner UUID, p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; retry BOOLEAN; current_status TEXT; incoming_status TEXT;
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'processing' OR j.lease_owner IS DISTINCT FROM p_owner
     OR j.locked_at < now() - INTERVAL '15 minutes' THEN RETURN false; END IF;
  retry := NOT (p_result->>'ok')::boolean
    AND p_result->>'errorClass' = 'transient' AND j.attempts < j.max_attempts;
  SELECT message_status INTO current_status FROM public.communications
    WHERE id = j.communication_id AND institution_id = j.institution_id FOR UPDATE;
  incoming_status := CASE WHEN (p_result->>'ok')::boolean
    THEN p_result->>'status' WHEN retry THEN 'queued'
    WHEN p_result->>'errorClass' = 'ambiguous' THEN 'unconfirmed'
    ELSE 'failed' END;
  -- A signed callback may already have recorded delivery before this finish.
  IF current_status IN ('delivered','read','failed','undelivered')
    THEN incoming_status := current_status; END IF;
  UPDATE public.communications SET
    provider_name = CASE WHEN (p_result->>'ok')::boolean
      THEN COALESCE(provider_name, p_result->>'provider') ELSE provider_name END,
    provider_message_id = CASE WHEN (p_result->>'ok')::boolean
      THEN COALESCE(provider_message_id, p_result->>'providerId') ELSE provider_message_id END,
    message_status = CASE WHEN j.channel = 'voice' THEN NULL ELSE incoming_status END,
    sms_status = CASE WHEN j.channel = 'sms' THEN incoming_status ELSE sms_status END,
    call_status = CASE WHEN j.channel = 'voice' THEN 'failed' ELSE call_status END,
    body = CASE WHEN j.channel = 'sms' AND (p_result->>'ok')::boolean
      THEN COALESCE(p_result->>'body', body) ELSE body END,
    template_id = CASE WHEN j.channel = 'sms' AND (p_result->>'ok')::boolean
      THEN COALESCE(NULLIF(p_result->>'templateId', '')::UUID, template_id) ELSE template_id END,
    parent_phone = CASE WHEN j.channel = 'sms' AND (p_result->>'ok')::boolean
      THEN COALESCE(p_result->>'recipient', parent_phone) ELSE parent_phone END,
    error_details = CASE WHEN current_status IN ('failed','undelivered')
      THEN error_details WHEN incoming_status = 'unconfirmed'
      THEN 'Provider outcome unknown; manual reconciliation required'
      ELSE p_result->>'message' END,
    processed_at = now()
  WHERE id = j.communication_id AND institution_id = j.institution_id;
  UPDATE public.communication_jobs SET
    status = CASE WHEN (p_result->>'ok')::boolean THEN 'completed'
      WHEN retry THEN 'pending' ELSE 'dead_letter' END,
    next_run_at = CASE WHEN retry THEN now() +
      make_interval(secs => LEAST(240, 60 * power(2, attempts - 1)::int))
      ELSE next_run_at END,
    completed_at = CASE WHEN retry THEN NULL ELSE now() END,
    locked_at = NULL, lease_owner = NULL, last_error = p_result->>'message',
    provider_request_started_at = CASE WHEN retry THEN NULL ELSE provider_request_started_at END
  WHERE id = j.id;
  RETURN true;
END $$;

DROP FUNCTION public.apply_communication_callback(TEXT, TEXT);
CREATE FUNCTION public.apply_communication_callback(
  p_sid TEXT, p_status TEXT, p_communication_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.communications; inserted UUID; current_rank INT; incoming_rank INT;
BEGIN
  IF p_status NOT IN ('queued','sent','delivered','read','failed','undelivered')
     OR p_status IS NULL OR p_sid IS NULL OR length(p_sid) < 4 THEN
    RAISE EXCEPTION 'unsupported callback data';
  END IF;
  SELECT * INTO c FROM public.communications
    WHERE provider_name IN ('twilio','twilio-simulated') AND provider_message_id = p_sid
    FOR UPDATE;
  IF NOT FOUND AND p_communication_id IS NOT NULL THEN
    SELECT * INTO c FROM public.communications
      WHERE id = p_communication_id AND type = 'sms' FOR UPDATE;
    IF NOT FOUND OR c.provider_message_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM public.communication_jobs j
      WHERE j.communication_id = c.id AND j.institution_id = c.institution_id
        AND j.channel = 'sms' AND j.provider_request_started_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'unknown provider message ID';
    END IF;
    UPDATE public.communications SET provider_name = 'twilio',
      provider_message_id = p_sid WHERE id = c.id AND institution_id = c.institution_id;
  ELSIF NOT FOUND THEN
    RAISE EXCEPTION 'unknown provider message ID';
  END IF;
  IF c.type = 'voice' THEN RAISE EXCEPTION 'voice callbacks are not implemented'; END IF;
  IF p_communication_id IS NOT NULL AND c.id <> p_communication_id THEN
    RAISE EXCEPTION 'callback communication mismatch';
  END IF;
  INSERT INTO public.communication_webhook_events(
    institution_id, communication_id, provider_name, provider_event_id,
    event_type, normalized_status
  ) VALUES (
    c.institution_id, c.id, 'twilio', p_sid || ':' || p_status,
    'message-status', p_status
  ) ON CONFLICT(provider_name, provider_event_id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'status', c.message_status);
  END IF;
  current_rank := CASE c.message_status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'failed' THEN 5
    WHEN 'undelivered' THEN 5 ELSE 0 END;
  incoming_rank := CASE p_status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 5 END;
  IF c.message_status NOT IN ('failed','undelivered')
    AND incoming_rank > current_rank
    AND NOT (c.message_status IN ('delivered','read')
      AND p_status IN ('failed','undelivered')) THEN
    UPDATE public.communications SET message_status = p_status,
      sms_status = CASE WHEN c.type = 'sms' THEN CASE WHEN p_status = 'read'
        THEN 'delivered' ELSE p_status END ELSE sms_status END,
      error_details = CASE WHEN p_status IN ('failed','undelivered')
        THEN 'Twilio reported delivery failure' ELSE error_details END
    WHERE id = c.id AND institution_id = c.institution_id;
    RETURN jsonb_build_object('duplicate', false, 'status', p_status);
  END IF;
  RETURN jsonb_build_object('duplicate', false, 'status', c.message_status);
END $$;
REVOKE ALL ON FUNCTION public.apply_communication_callback(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_communication_callback(TEXT, TEXT, UUID) TO service_role;

COMMIT;
