-- Guardian FCM notifications. Historical SMS rows and Twilio callbacks stay intact.
BEGIN;

ALTER TABLE public.communications DROP CONSTRAINT communications_message_status_check;
ALTER TABLE public.communications ADD CONSTRAINT communications_message_status_check CHECK (
  message_status IS NULL OR message_status IN
    ('queued','sent','delivered','read','failed','undelivered','unconfirmed',
     'provider_accepted','no_registered_device','suppressed','dead_letter')
);
ALTER TABLE public.communication_jobs DROP CONSTRAINT communication_jobs_channel_check;
ALTER TABLE public.communication_jobs ADD CONSTRAINT communication_jobs_channel_check
  CHECK (channel IN ('sms','whatsapp','voice','push'));

CREATE TABLE public.guardian_notification_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  guardian_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guardian_invitation_guardian_tenant_fkey FOREIGN KEY (institution_id, guardian_id)
    REFERENCES public.parents(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT guardian_invitation_creator_tenant_fkey FOREIGN KEY (created_by, institution_id)
    REFERENCES public.profile_institutions(profile_id, institution_id) ON DELETE RESTRICT
);
CREATE INDEX guardian_notification_invitations_guardian_idx
  ON public.guardian_notification_invitations(institution_id, guardian_id, created_at DESC);

CREATE TABLE public.guardian_notification_installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  guardian_id UUID NOT NULL,
  firebase_installation_id TEXT NOT NULL UNIQUE CHECK (length(firebase_installation_id) BETWEEN 12 AND 256),
  device_secret_hash TEXT NOT NULL UNIQUE CHECK (device_secret_hash ~ '^[0-9a-f]{64}$'),
  platform TEXT NOT NULL DEFAULT 'web' CHECK (platform = 'web'),
  permission_state TEXT NOT NULL CHECK (permission_state IN ('granted','denied','default')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  failure_reason TEXT,
  CONSTRAINT guardian_installation_guardian_tenant_fkey FOREIGN KEY (institution_id, guardian_id)
    REFERENCES public.parents(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT guardian_installation_id_tenant_key UNIQUE (institution_id, id),
  CONSTRAINT guardian_installation_active_permission_check
    CHECK (NOT active OR (permission_state = 'granted' AND revoked_at IS NULL))
);
CREATE INDEX guardian_notification_installations_guardian_idx
  ON public.guardian_notification_installations(institution_id, guardian_id, active);
CREATE TRIGGER set_timestamp_guardian_notification_installations BEFORE UPDATE
  ON public.guardian_notification_installations FOR EACH ROW
  EXECUTE PROCEDURE public.trigger_set_timestamp();

ALTER TABLE public.communication_jobs ADD CONSTRAINT communication_jobs_id_tenant_key UNIQUE (institution_id, id);
CREATE TABLE public.communication_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
  communication_id UUID NOT NULL,
  job_id UUID NOT NULL,
  guardian_id UUID NOT NULL,
  installation_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'fcm' CHECK (provider = 'fcm'),
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','sending','provider_accepted','invalid_device','failed','unconfirmed')),
  attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  failure_reason TEXT,
  provider_request_started_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT communication_dispatches_communication_tenant_fkey
    FOREIGN KEY (institution_id, communication_id)
    REFERENCES public.communications(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT communication_dispatches_job_tenant_fkey
    FOREIGN KEY (institution_id, job_id)
    REFERENCES public.communication_jobs(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT communication_dispatches_guardian_tenant_fkey
    FOREIGN KEY (institution_id, guardian_id)
    REFERENCES public.parents(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT communication_dispatches_installation_tenant_fkey
    FOREIGN KEY (institution_id, installation_id)
    REFERENCES public.guardian_notification_installations(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT communication_dispatches_once_per_installation UNIQUE (communication_id, installation_id)
);
CREATE INDEX communication_dispatches_job_idx ON public.communication_dispatches(job_id, status);
CREATE TRIGGER set_timestamp_communication_dispatches BEFORE UPDATE
  ON public.communication_dispatches FOR EACH ROW
  EXECUTE PROCEDURE public.trigger_set_timestamp();

ALTER TABLE public.guardian_notification_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardian_notification_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_dispatches ENABLE ROW LEVEL SECURITY;
-- No browser role may read invitation hashes, installation identities or device secrets.
REVOKE ALL ON public.guardian_notification_invitations FROM anon, authenticated;
REVOKE ALL ON public.guardian_notification_installations FROM anon, authenticated;
REVOKE ALL ON public.communication_dispatches FROM anon, authenticated;

-- Atomic, one-time enrollment. The public link is only a bearer capability;
-- all lookup and insertion happen in trusted server code with service_role.
CREATE FUNCTION public.consume_guardian_notification_invitation(
  p_token_hash TEXT, p_fid TEXT, p_device_secret_hash TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE invitation public.guardian_notification_invitations; installation_id UUID;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_device_secret_hash !~ '^[0-9a-f]{64}$'
     OR length(p_fid) NOT BETWEEN 12 AND 256 THEN
    RAISE EXCEPTION 'invalid enrollment input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO invitation FROM public.guardian_notification_invitations
  WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR invitation.consumed_at IS NOT NULL OR invitation.revoked_at IS NOT NULL
     OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_notification_installations
             WHERE firebase_installation_id = p_fid
               AND (institution_id <> invitation.institution_id OR guardian_id <> invitation.guardian_id)) THEN
    RAISE EXCEPTION 'installation already enrolled' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.guardian_notification_installations
    (institution_id, guardian_id, firebase_installation_id, device_secret_hash,
     permission_state, active, revoked_at, failure_reason)
  VALUES (invitation.institution_id, invitation.guardian_id, p_fid,
          p_device_secret_hash, 'granted', true, NULL, NULL)
  ON CONFLICT (firebase_installation_id) DO UPDATE SET
    device_secret_hash = EXCLUDED.device_secret_hash, permission_state = 'granted',
    active = true, revoked_at = NULL, failure_reason = NULL, last_seen_at = now()
  WHERE guardian_notification_installations.institution_id = invitation.institution_id
    AND guardian_notification_installations.guardian_id = invitation.guardian_id
  RETURNING id INTO installation_id;
  IF installation_id IS NULL THEN RAISE EXCEPTION 'installation unavailable'; END IF;
  UPDATE public.guardian_notification_invitations SET consumed_at = now()
  WHERE id = invitation.id;
  RETURN installation_id;
END $$;
REVOKE ALL ON FUNCTION public.consume_guardian_notification_invitation(TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guardian_notification_invitation(TEXT,TEXT,TEXT)
  TO service_role;

COMMIT;

BEGIN;

-- New absence records use push after this migration. Existing communication
-- rows keep their original type/provider and pending legacy jobs stay legacy.
CREATE OR REPLACE FUNCTION public.enqueue_absence_communication()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE guardian RECORD; session_date DATE; limit_count INT := 3;
  limit_window INTERVAL := INTERVAL '1 hour'; key TEXT; communication_id UUID;
BEGIN
  IF NEW.status <> 'absent' THEN RETURN NEW; END IF;
  SELECT s.parent_id, p.active, p.communication_consent, p.language INTO guardian
  FROM public.students s JOIN public.parents p
    ON p.id = s.parent_id AND p.institution_id = s.institution_id
  WHERE s.id = NEW.student_id AND s.institution_id = NEW.institution_id
  FOR UPDATE OF p;
  IF NOT FOUND OR NOT guardian.active OR NOT guardian.communication_consent THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.student_parents sp
    WHERE sp.institution_id = NEW.institution_id AND sp.student_id = NEW.student_id
      AND sp.parent_id = guardian.parent_id AND sp.receives_notifications) THEN RETURN NEW; END IF;
  SELECT date INTO session_date FROM public.attendance_sessions
  WHERE id = NEW.session_id AND institution_id = NEW.institution_id;
  IF session_date IS NULL THEN RETURN NEW; END IF;
  SELECT max_per_parent_per_window, window_length INTO limit_count, limit_window
  FROM public.communication_rate_limits WHERE institution_id = NEW.institution_id;
  limit_count := COALESCE(limit_count, 3);
  limit_window := COALESCE(limit_window, INTERVAL '1 hour');
  IF (SELECT count(*) FROM public.communications c
      WHERE c.institution_id = NEW.institution_id AND c.parent_id = guardian.parent_id
        -- communications.created_at uses the legacy UTC wall-clock default.
        AND c.type = 'push' AND c.created_at >= timezone('utc', now()) - limit_window) >= limit_count THEN RETURN NEW; END IF;
  key := format('absence:%s:%s:%s:%s:push', NEW.institution_id, session_date,
                NEW.student_id, guardian.parent_id);
  INSERT INTO public.communications
    (institution_id, student_id, parent_id, type, direction, message_status,
     body, metadata, idempotency_key)
  VALUES (NEW.institution_id, NEW.student_id, guardian.parent_id, 'push',
    'outbound', 'queued', 'Attendance absence notification.',
    jsonb_build_object('purpose','absence-alert','attendance_session_id',NEW.session_id,
      'attendance_date',session_date,'language',guardian.language), key)
  ON CONFLICT (institution_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO communication_id;
  IF communication_id IS NOT NULL THEN
    INSERT INTO public.communication_jobs
      (institution_id, communication_id, channel, payload, idempotency_key)
    VALUES (NEW.institution_id, communication_id, 'push',
      jsonb_build_object('communication_id', communication_id), key)
    ON CONFLICT (institution_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- Keep the legacy claim path for historical jobs. It cannot claim a push job.
CREATE OR REPLACE FUNCTION public.claim_communication_jobs(p_limit INT DEFAULT 20)
RETURNS SETOF public.communication_jobs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
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
  UPDATE public.communication_jobs SET
    status = CASE WHEN provider_request_started_at IS NOT NULL OR attempts >= max_attempts
      THEN 'dead_letter' ELSE 'pending' END,
    locked_at = NULL, lease_owner = NULL,
    last_error = CASE WHEN provider_request_started_at IS NOT NULL
      THEN 'Provider outcome unknown; manual reconciliation required'
      ELSE COALESCE(last_error, 'worker lease expired') END
  WHERE channel <> 'push' AND status = 'processing'
    AND locked_at < now() - INTERVAL '15 minutes';
  RETURN QUERY WITH claimed AS (
    SELECT id FROM public.communication_jobs
    WHERE channel <> 'push' AND status = 'pending' AND attempts < max_attempts
      AND next_run_at <= now()
    ORDER BY next_run_at, created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE public.communication_jobs job SET
    status = 'processing', attempts = attempts + 1, locked_at = now(),
    lease_owner = gen_random_uuid()
  FROM claimed WHERE job.id = claimed.id RETURNING job.*;
END $$;

CREATE FUNCTION public.claim_push_jobs(p_limit INT DEFAULT 20)
RETURNS SETOF public.communication_jobs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  UPDATE public.communication_dispatches d SET status = 'unconfirmed',
    failure_reason = 'Provider outcome unknown after worker lease expired'
  FROM public.communication_jobs j
  WHERE d.job_id = j.id AND j.channel = 'push' AND j.status = 'processing'
    AND j.locked_at < now() - INTERVAL '15 minutes' AND d.status = 'sending';
  UPDATE public.communications c SET message_status = 'unconfirmed',
    error_details = 'Provider outcome unknown; manual reconciliation required'
  FROM public.communication_jobs j
  WHERE j.communication_id = c.id AND j.channel = 'push' AND j.status = 'processing'
    AND j.locked_at < now() - INTERVAL '15 minutes'
    AND EXISTS (SELECT 1 FROM public.communication_dispatches d
      WHERE d.job_id = j.id AND d.status = 'unconfirmed')
    AND c.message_status <> 'provider_accepted';
  UPDATE public.communication_jobs j SET
    status = CASE WHEN j.attempts >= j.max_attempts OR EXISTS
      (SELECT 1 FROM public.communication_dispatches d
       WHERE d.job_id = j.id AND d.status = 'unconfirmed')
      THEN 'dead_letter' ELSE 'pending' END,
    locked_at = NULL, lease_owner = NULL,
    last_error = 'Push worker lease expired; uncertain sends need reconciliation'
  WHERE j.channel = 'push' AND j.status = 'processing'
    AND j.locked_at < now() - INTERVAL '15 minutes';
  RETURN QUERY WITH claimed AS (
    SELECT id FROM public.communication_jobs
    WHERE channel = 'push' AND status = 'pending' AND attempts < max_attempts
      AND next_run_at <= now()
    ORDER BY next_run_at, created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE public.communication_jobs job SET
    status = 'processing', attempts = attempts + 1, locked_at = now(),
    lease_owner = gen_random_uuid()
  FROM claimed WHERE job.id = claimed.id RETURNING job.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_push_jobs(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_jobs(INT) TO service_role;

-- A server request must acquire this fence immediately before every FCM call.
-- It repeats the business and attendance checks under the job's current lease.
CREATE FUNCTION public.begin_push_dispatch(p_job UUID, p_owner UUID, p_installation UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; c public.communications; i public.guardian_notification_installations;
  d public.communication_dispatches; limit_count INT := 3; limit_window INTERVAL := INTERVAL '1 hour';
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.channel <> 'push' OR j.status <> 'processing'
     OR j.lease_owner IS DISTINCT FROM p_owner
     OR j.locked_at < now() - INTERVAL '15 minutes' THEN RETURN 'lease_lost'; END IF;
  SELECT * INTO c FROM public.communications
  WHERE id = j.communication_id AND institution_id = j.institution_id FOR UPDATE;
  SELECT * INTO i FROM public.guardian_notification_installations
  WHERE id = p_installation AND institution_id = j.institution_id FOR UPDATE;
  IF NOT FOUND OR NOT i.active OR i.permission_state <> 'granted'
     OR i.last_seen_at < now() - INTERVAL '90 days'
     OR i.guardian_id <> c.parent_id THEN RETURN 'ineligible'; END IF;
  IF c.type <> 'push' OR c.message_status IN ('suppressed','dead_letter','no_registered_device')
     OR NOT EXISTS (SELECT 1 FROM public.parents p
       WHERE p.id = c.parent_id AND p.institution_id = c.institution_id
         AND p.active AND p.communication_consent)
     OR NOT EXISTS (SELECT 1 FROM public.students s
       WHERE s.id = c.student_id AND s.institution_id = c.institution_id
         AND s.enrollment_status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.student_parents sp
       WHERE sp.institution_id = c.institution_id AND sp.student_id = c.student_id
         AND sp.parent_id = c.parent_id AND sp.receives_notifications)
     OR NOT EXISTS (SELECT 1 FROM public.attendance_records ar
       WHERE ar.institution_id = c.institution_id AND ar.student_id = c.student_id
         AND ar.session_id::TEXT = c.metadata->>'attendance_session_id'
         AND ar.status = 'absent') THEN RETURN 'ineligible'; END IF;
  SELECT max_per_parent_per_window, window_length INTO limit_count, limit_window
  FROM public.communication_rate_limits WHERE institution_id = j.institution_id;
  IF (SELECT count(*) FROM public.communications prior
      WHERE prior.institution_id = j.institution_id AND prior.parent_id = c.parent_id
        AND prior.type = 'push' AND prior.id <> c.id
        AND prior.message_status = 'provider_accepted'
        AND prior.processed_at >= now() - COALESCE(limit_window, INTERVAL '1 hour'))
      >= COALESCE(limit_count, 3) THEN RETURN 'rate_limited'; END IF;
  SELECT * INTO d FROM public.communication_dispatches
  WHERE communication_id = c.id AND installation_id = i.id FOR UPDATE;
  IF FOUND THEN
    IF d.status = 'provider_accepted' THEN RETURN 'already_accepted'; END IF;
    IF d.status IN ('sending','unconfirmed') THEN RETURN 'unconfirmed'; END IF;
    IF d.status IN ('invalid_device','failed') THEN RETURN 'already_failed'; END IF;
    IF d.next_run_at > now() THEN RETURN 'wait'; END IF;
    IF d.attempt_count >= j.max_attempts THEN RETURN 'already_failed'; END IF;
    UPDATE public.communication_dispatches SET status = 'sending',
      attempt_count = attempt_count + 1, provider_request_started_at = now(),
      failure_code = NULL, failure_reason = NULL WHERE id = d.id;
  ELSE
    INSERT INTO public.communication_dispatches
      (institution_id, communication_id, job_id, guardian_id, installation_id,
       status, attempt_count, provider_request_started_at)
    VALUES (j.institution_id, c.id, j.id, c.parent_id, i.id, 'sending', 1, now());
  END IF;
  RETURN 'send';
END $$;
REVOKE ALL ON FUNCTION public.begin_push_dispatch(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_push_dispatch(UUID,UUID,UUID) TO service_role;

CREATE FUNCTION public.finish_push_dispatch(p_job UUID, p_owner UUID, p_installation UUID,
  p_status TEXT, p_provider_id TEXT DEFAULT NULL, p_code TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; d public.communication_dispatches; delay_seconds INT;
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.channel <> 'push' OR j.status <> 'processing'
     OR j.lease_owner IS DISTINCT FROM p_owner OR j.locked_at < now() - INTERVAL '15 minutes'
     OR p_status NOT IN ('provider_accepted','pending','invalid_device','failed','unconfirmed')
     OR p_code IS NOT NULL AND p_code !~ '^[a-z0-9_/-]{1,80}$' THEN RETURN false; END IF;
  SELECT * INTO d FROM public.communication_dispatches
  WHERE job_id = j.id AND installation_id = p_installation AND status = 'sending' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  delay_seconds := LEAST(3600, 60 * power(2, LEAST(d.attempt_count - 1, 6))::INT)
    + floor(random() * 30)::INT;
  UPDATE public.communication_dispatches SET status = p_status,
    provider_message_id = CASE WHEN p_status = 'provider_accepted' THEN p_provider_id ELSE NULL END,
    failure_code = p_code,
    failure_reason = CASE WHEN p_status = 'provider_accepted' THEN NULL ELSE p_status END,
    next_run_at = CASE WHEN p_status = 'pending' THEN now() + make_interval(secs => delay_seconds)
      ELSE next_run_at END WHERE id = d.id;
  IF p_status = 'invalid_device' THEN
    UPDATE public.guardian_notification_installations SET active = false,
      revoked_at = now(), failure_reason = COALESCE(p_code, 'invalid_device')
    WHERE id = p_installation AND institution_id = j.institution_id;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_push_dispatch(UUID,UUID,UUID,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_dispatch(UUID,UUID,UUID,TEXT,TEXT,TEXT)
  TO service_role;

CREATE FUNCTION public.complete_push_job(p_job UUID, p_owner UUID, p_suppressed BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public.communication_jobs; accepted INT; pending INT; uncertain INT; total INT;
  next_time TIMESTAMPTZ; final_status TEXT; final_job_status TEXT;
BEGIN
  SELECT * INTO j FROM public.communication_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.channel <> 'push' OR j.status <> 'processing'
     OR j.lease_owner IS DISTINCT FROM p_owner
     OR j.locked_at < now() - INTERVAL '15 minutes' THEN RETURN 'lease_lost'; END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'provider_accepted'),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status IN ('sending','unconfirmed')),
    min(next_run_at) FILTER (WHERE status = 'pending')
  INTO total, accepted, pending, uncertain, next_time
  FROM public.communication_dispatches WHERE job_id = j.id;
  IF uncertain > 0 THEN
    final_status := CASE WHEN accepted > 0 THEN 'provider_accepted' ELSE 'unconfirmed' END;
    final_job_status := 'dead_letter';
  ELSIF pending > 0 AND j.attempts < j.max_attempts AND NOT p_suppressed THEN
    final_status := CASE WHEN accepted > 0 THEN 'provider_accepted' ELSE 'queued' END;
    final_job_status := 'pending';
  ELSIF accepted > 0 THEN
    final_status := 'provider_accepted'; final_job_status := 'completed';
  ELSIF p_suppressed THEN
    final_status := 'suppressed'; final_job_status := 'completed';
  ELSIF total = 0 THEN
    final_status := 'no_registered_device'; final_job_status := 'completed';
  ELSE
    final_status := 'failed'; final_job_status := 'dead_letter';
  END IF;
  UPDATE public.communications SET provider_name = 'fcm', message_status = final_status,
    provider_message_id = (SELECT provider_message_id FROM public.communication_dispatches
      WHERE job_id = j.id AND status = 'provider_accepted' ORDER BY created_at LIMIT 1),
    error_details = CASE WHEN final_status = 'provider_accepted' THEN NULL ELSE final_status END,
    processed_at = now() WHERE id = j.communication_id AND institution_id = j.institution_id;
  UPDATE public.communication_jobs SET status = final_job_status,
    next_run_at = CASE WHEN final_job_status = 'pending'
      THEN GREATEST(now() + INTERVAL '1 second', COALESCE(next_time, now() + INTERVAL '1 minute'))
      ELSE next_run_at END,
    completed_at = CASE WHEN final_job_status = 'pending' THEN NULL ELSE now() END,
    locked_at = NULL, lease_owner = NULL, last_error = CASE
      WHEN final_job_status = 'completed' THEN NULL ELSE final_status END
  WHERE id = j.id;
  RETURN final_status;
END $$;
REVOKE ALL ON FUNCTION public.complete_push_job(UUID,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_job(UUID,UUID,BOOLEAN) TO service_role;

COMMIT;
