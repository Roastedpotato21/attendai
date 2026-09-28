-- Phase 3B: durable, tenant-isolated communication outbox.
-- Provider delivery is performed by a separately deployed server-side worker.
-- This migration deliberately never stores provider credentials in PostgreSQL.

BEGIN;

-- Consent is opt-in. Existing records are intentionally not treated as opted in
-- merely because they have a telephone number.
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS communication_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS communication_consent_updated_at TIMESTAMPTZ;

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_tenant_idempotency
  ON public.communications(institution_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_communications_provider_event
  ON public.communications(provider_name, provider_event_id)
  WHERE provider_name IS NOT NULL AND provider_event_id IS NOT NULL;

-- Defaults are intentionally conservative (three contact attempts per parent
-- per channel per rolling hour). Each institution can lower or raise them with
-- an operational change, rather than changing application code.
CREATE TABLE IF NOT EXISTS public.communication_rate_limits (
  institution_id UUID PRIMARY KEY REFERENCES public.institutions(id) ON DELETE CASCADE,
  max_per_parent_per_window INT NOT NULL DEFAULT 3 CHECK (max_per_parent_per_window > 0),
  window_length INTERVAL NOT NULL DEFAULT INTERVAL '1 hour'
    CHECK (window_length >= INTERVAL '1 minute' AND window_length <= INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
CREATE TRIGGER set_timestamp_communication_rate_limits
  BEFORE UPDATE ON public.communication_rate_limits
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS public.communication_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  communication_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'voice')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0 AND max_attempts <= 10),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  -- Payload is intentionally a reference-only envelope; recipient data and
  -- transcripts remain on their protected source rows.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  lease_owner UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT communication_jobs_communication_tenant_fkey
    FOREIGN KEY (institution_id, communication_id)
    REFERENCES public.communications(institution_id, id) ON DELETE CASCADE,
  CONSTRAINT communication_jobs_tenant_idempotency_key UNIQUE (institution_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_communication_jobs_ready
  ON public.communication_jobs(status, next_run_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_communication_jobs_tenant_status
  ON public.communication_jobs(institution_id, status, next_run_at);
CREATE INDEX idx_communication_jobs_stale ON public.communication_jobs(locked_at)
  WHERE status = 'processing';
CREATE INDEX idx_communication_jobs_communication ON public.communication_jobs(institution_id, communication_id);
CREATE TRIGGER set_timestamp_communication_jobs
  BEFORE UPDATE ON public.communication_jobs
  FOR EACH ROW EXECUTE PROCEDURE public.trigger_set_timestamp();

-- Delivery callbacks are kept separately so a duplicate provider webhook is a
-- no-op rather than a second state transition.
CREATE TABLE IF NOT EXISTS public.communication_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  communication_id UUID NOT NULL,
  provider_name TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  normalized_status TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT communication_webhook_events_communication_tenant_fkey
    FOREIGN KEY (institution_id, communication_id)
    REFERENCES public.communications(institution_id, id) ON DELETE CASCADE,
  CONSTRAINT communication_webhook_events_provider_event_key
    UNIQUE (provider_name, provider_event_id)
);

-- Claiming uses SKIP LOCKED so concurrent workers cannot process the same job.
-- Stale locks are returned to pending only after fifteen minutes, protecting a
-- worker that dies after claiming but before it records its result.
CREATE OR REPLACE FUNCTION public.claim_communication_jobs(p_limit INT DEFAULT 20)
RETURNS SETOF public.communication_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  UPDATE public.communication_jobs
  SET status = CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END,
      locked_at = NULL, lease_owner = NULL,
      last_error = COALESCE(last_error, 'worker lease expired')
  WHERE status = 'processing'
    AND locked_at < now() - INTERVAL '15 minutes';

  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.communication_jobs
    WHERE status = 'pending'
      AND attempts < max_attempts
      AND next_run_at <= now()
    ORDER BY next_run_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.communication_jobs job
  SET status = 'processing', attempts = attempts + 1, locked_at = now(),
      lease_owner = gen_random_uuid()
  FROM claimed
  WHERE job.id = claimed.id
  RETURNING job.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_communication_jobs(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_communication_jobs(INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_communication_jobs(INT) TO service_role;

-- The attendance transaction creates the communication and its outbox job in
-- one step. If attendance rolls back, no parent notification can escape it.
CREATE OR REPLACE FUNCTION public.enqueue_absence_communication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student RECORD;
  v_parent RECORD;
  v_session_date DATE;
  v_channel TEXT;
  v_key TEXT;
  v_communication_id UUID;
  v_limit INT := 3;
  v_window INTERVAL := INTERVAL '1 hour';
BEGIN
  IF NEW.status <> 'absent' THEN
    RETURN NEW;
  END IF;

  SELECT s.id, s.parent_id, s.institution_id,
         p.active AS parent_active, p.communication_consent,
         p.preferred_channel, p.language
    INTO v_student
  FROM public.students s
  JOIN public.parents p
    ON p.id = s.parent_id AND p.institution_id = s.institution_id
  WHERE s.id = NEW.student_id
    AND s.institution_id = NEW.institution_id
  FOR UPDATE OF p;

  IF NOT FOUND OR NOT COALESCE(v_student.parent_active, false)
     OR NOT v_student.communication_consent THEN
    RETURN NEW;
  END IF;

  -- The linked guardian must still be explicitly eligible for notifications.
  IF NOT EXISTS (
    SELECT 1 FROM public.student_parents sp
    WHERE sp.student_id = NEW.student_id
      AND sp.parent_id = v_student.parent_id
      AND sp.institution_id = NEW.institution_id
      AND sp.receives_notifications
  ) THEN
    RETURN NEW;
  END IF;

  SELECT date INTO v_session_date
  FROM public.attendance_sessions
  WHERE id = NEW.session_id AND institution_id = NEW.institution_id;
  IF v_session_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_per_parent_per_window, window_length
    INTO v_limit, v_window
  FROM public.communication_rate_limits
  WHERE institution_id = NEW.institution_id;

  -- The defaults above deliberately apply until an administrator configures a
  -- tenant-specific policy.
  v_limit := COALESCE(v_limit, 3);
  v_window := COALESCE(v_window, INTERVAL '1 hour');
  v_channel := v_student.preferred_channel::TEXT;

  IF (
    SELECT count(*)
    FROM public.communications c
    WHERE c.institution_id = NEW.institution_id
      AND c.parent_id = v_student.parent_id
      AND c.type::TEXT = v_channel
      AND c.created_at >= timezone('utc', now()) - v_window
  ) >= v_limit THEN
    RETURN NEW;
  END IF;

  v_key := format('absence:%s:%s:%s:%s:%s', NEW.institution_id, v_session_date, NEW.student_id, v_student.parent_id, v_channel);

  INSERT INTO public.communications (
    institution_id, student_id, parent_id, type, direction, message_status,
    call_status, attempts, body, metadata, idempotency_key
  ) VALUES (
    NEW.institution_id, NEW.student_id, v_student.parent_id, v_channel::channel_type,
    'outbound', CASE WHEN v_channel = 'voice' THEN NULL ELSE 'queued' END,
    CASE WHEN v_channel = 'voice' THEN 'scheduled' ELSE NULL END,
    CASE WHEN v_channel = 'voice' THEN 0 ELSE NULL END,
    'Attendance absence notification.',
    jsonb_build_object('purpose', 'absence-alert', 'attendance_session_id', NEW.session_id,
                       'attendance_date', v_session_date, 'language', v_student.language),
    v_key
  )
  ON CONFLICT (institution_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_communication_id;

  IF v_communication_id IS NOT NULL THEN
    INSERT INTO public.communication_jobs (
      institution_id, communication_id, channel, payload, idempotency_key
    ) VALUES (
      NEW.institution_id, v_communication_id, v_channel,
      jsonb_build_object('communication_id', v_communication_id), v_key
    ) ON CONFLICT (institution_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_absence_communication() FROM PUBLIC;
CREATE TRIGGER enqueue_absence_communication_after_attendance_record
  AFTER INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE PROCEDURE public.enqueue_absence_communication();

-- Only communication metadata is visible to operational staff. There is no
-- browser write policy: workers use a server-side service credential.
ALTER TABLE public.communication_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY communication_rate_limits_admin_read ON public.communication_rate_limits
  FOR SELECT TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin'::user_role]));
CREATE POLICY communication_rate_limits_admin_manage ON public.communication_rate_limits
  FOR ALL TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin'::user_role]))
  WITH CHECK (public.has_institution_role(institution_id, ARRAY['admin'::user_role]));
CREATE POLICY communication_jobs_operational_read ON public.communication_jobs
  FOR SELECT TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin'::user_role, 'staff'::user_role]));
CREATE POLICY communication_webhook_events_admin_read ON public.communication_webhook_events
  FOR SELECT TO authenticated
  USING (public.has_institution_role(institution_id, ARRAY['admin'::user_role]));

-- Fence stale workers and commit the delivery result and queue transition together.
CREATE FUNCTION public.finish_communication_job(p_job UUID, p_owner UUID, p_result JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; retry BOOLEAN;
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'processing' OR j.lease_owner IS DISTINCT FROM p_owner
     OR j.locked_at < now() - INTERVAL '15 minutes' THEN RETURN false; END IF;
  retry := NOT (p_result->>'ok')::boolean AND p_result->>'errorClass' = 'transient' AND j.attempts < j.max_attempts;
  UPDATE public.communications SET
    provider_name = CASE WHEN (p_result->>'ok')::boolean THEN p_result->>'provider' ELSE provider_name END,
    provider_message_id = CASE WHEN (p_result->>'ok')::boolean THEN p_result->>'providerId' ELSE provider_message_id END,
    message_status = CASE WHEN j.channel = 'voice' THEN NULL WHEN (p_result->>'ok')::boolean THEN p_result->>'status' WHEN retry THEN 'queued' ELSE 'failed' END,
    sms_status = CASE WHEN j.channel <> 'sms' THEN NULL WHEN (p_result->>'ok')::boolean THEN p_result->>'status' WHEN retry THEN 'queued' ELSE 'failed' END,
    call_status = CASE WHEN j.channel = 'voice' THEN 'failed' ELSE call_status END,
    error_details = p_result->>'message', processed_at = now()
  WHERE id = j.communication_id AND institution_id = j.institution_id;
  UPDATE public.communication_jobs SET
    status = CASE WHEN (p_result->>'ok')::boolean THEN 'completed' WHEN retry THEN 'pending' ELSE 'dead_letter' END,
    next_run_at = CASE WHEN retry THEN now() + make_interval(secs => LEAST(240, 60 * power(2, attempts - 1)::int)) ELSE next_run_at END,
    completed_at = CASE WHEN retry THEN NULL ELSE now() END,
    locked_at = NULL, lease_owner = NULL, last_error = p_result->>'message'
  WHERE id = j.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_communication_job(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_communication_job(UUID, UUID, JSONB) TO service_role;

CREATE FUNCTION public.apply_communication_callback(p_sid TEXT, p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.communications; inserted UUID; current_rank INT; incoming_rank INT;
BEGIN
  IF p_status NOT IN ('queued','sent','delivered','read','failed') OR p_status IS NULL THEN
    RAISE EXCEPTION 'unsupported provider status';
  END IF;
  SELECT * INTO c FROM public.communications WHERE provider_name = 'twilio' AND provider_message_id = p_sid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown provider message ID'; END IF;
  IF c.type = 'voice' THEN RAISE EXCEPTION 'voice callbacks are not implemented'; END IF;
  INSERT INTO public.communication_webhook_events(institution_id, communication_id, provider_name, provider_event_id, event_type, normalized_status)
  VALUES(c.institution_id, c.id, 'twilio', p_sid || ':' || p_status, 'message-status', p_status)
  ON CONFLICT(provider_name, provider_event_id) DO NOTHING RETURNING id INTO inserted;
  IF inserted IS NULL THEN RETURN jsonb_build_object('duplicate', true, 'status', c.message_status); END IF;
  current_rank := CASE c.message_status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 WHEN 'failed' THEN 5 ELSE 0 END;
  incoming_rank := CASE p_status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2 WHEN 'delivered' THEN 3 WHEN 'read' THEN 4 ELSE 5 END;
  IF c.message_status IS DISTINCT FROM 'failed' AND incoming_rank > current_rank
     AND NOT (c.message_status IN ('delivered','read') AND p_status = 'failed') THEN
    UPDATE public.communications SET message_status = p_status,
      sms_status = CASE WHEN type = 'sms' THEN CASE WHEN p_status = 'read' THEN 'delivered' ELSE p_status END ELSE NULL END
    WHERE id = c.id AND institution_id = c.institution_id;
  END IF;
  RETURN jsonb_build_object('duplicate', false, 'status', p_status);
END $$;
REVOKE ALL ON FUNCTION public.apply_communication_callback(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_communication_callback(TEXT, TEXT) TO service_role;

COMMIT;
