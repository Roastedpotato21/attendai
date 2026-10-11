-- Keep historical registrations, but send only to installations from the new FCM project.
BEGIN;

ALTER TABLE public.guardian_notification_installations
  ADD COLUMN firebase_project_id TEXT NOT NULL DEFAULT 'siri-1b57c'
  CHECK (firebase_project_id IN ('siri-1b57c', 'attendai-41f64'));
CREATE INDEX guardian_notification_installations_project_idx
  ON public.guardian_notification_installations
  (institution_id, guardian_id, firebase_project_id, active);

CREATE FUNCTION public.consume_guardian_notification_invitation(
  p_token_hash TEXT, p_fid TEXT, p_device_secret_hash TEXT, p_project_id TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE invitation public.guardian_notification_invitations; installation_id UUID;
BEGIN
  IF p_project_id <> 'attendai-41f64' OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_device_secret_hash !~ '^[0-9a-f]{64}$'
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
      WHERE firebase_installation_id = p_fid AND
        (institution_id <> invitation.institution_id OR guardian_id <> invitation.guardian_id
         OR firebase_project_id <> p_project_id)) THEN
    RAISE EXCEPTION 'installation already enrolled' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.guardian_notification_installations
    (institution_id, guardian_id, firebase_installation_id, firebase_project_id,
     device_secret_hash, permission_state, active, revoked_at, failure_reason)
  VALUES (invitation.institution_id, invitation.guardian_id, p_fid, p_project_id,
          p_device_secret_hash, 'granted', true, NULL, NULL)
  ON CONFLICT (firebase_installation_id) DO UPDATE SET
    device_secret_hash = EXCLUDED.device_secret_hash, permission_state = 'granted',
    active = true, revoked_at = NULL, failure_reason = NULL, last_seen_at = now()
  WHERE guardian_notification_installations.institution_id = invitation.institution_id
    AND guardian_notification_installations.guardian_id = invitation.guardian_id
    AND guardian_notification_installations.firebase_project_id = p_project_id
  RETURNING id INTO installation_id;
  IF installation_id IS NULL THEN RAISE EXCEPTION 'installation unavailable'; END IF;
  UPDATE public.guardian_notification_invitations SET consumed_at = now() WHERE id = invitation.id;
  RETURN installation_id;
END $$;
REVOKE ALL ON FUNCTION public.consume_guardian_notification_invitation(TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guardian_notification_invitation(TEXT,TEXT,TEXT,TEXT)
  TO service_role;

-- A device cookie proves ownership of one existing installation. Rotate the
-- cookie and create a new row when its FCM project changes; old history stays.
CREATE FUNCTION public.refresh_guardian_notification_installation(
  p_old_secret_hash TEXT, p_new_secret_hash TEXT, p_fid TEXT, p_project_id TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE old_device public.guardian_notification_installations; installation_id UUID;
BEGIN
  IF p_project_id <> 'attendai-41f64' OR p_old_secret_hash !~ '^[0-9a-f]{64}$'
     OR p_new_secret_hash !~ '^[0-9a-f]{64}$' OR length(p_fid) NOT BETWEEN 12 AND 256 THEN
    RAISE EXCEPTION 'invalid device input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO old_device FROM public.guardian_notification_installations
  WHERE device_secret_hash = p_old_secret_hash AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'device unavailable' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_notification_installations
      WHERE firebase_installation_id = p_fid AND id <> old_device.id) THEN
    RAISE EXCEPTION 'installation already enrolled' USING ERRCODE = '23505';
  END IF;
  IF old_device.firebase_project_id = p_project_id THEN
    UPDATE public.guardian_notification_installations SET
      firebase_installation_id = p_fid, device_secret_hash = p_new_secret_hash,
      permission_state = 'granted', last_seen_at = now()
    WHERE id = old_device.id RETURNING id INTO installation_id;
  ELSE
    UPDATE public.guardian_notification_installations SET active = false,
      revoked_at = now(), failure_reason = 'fcm_project_migrated'
    WHERE id = old_device.id;
    INSERT INTO public.guardian_notification_installations
      (institution_id, guardian_id, firebase_installation_id, firebase_project_id,
       device_secret_hash, permission_state)
    VALUES (old_device.institution_id, old_device.guardian_id, p_fid, p_project_id,
            p_new_secret_hash, 'granted') RETURNING id INTO installation_id;
  END IF;
  RETURN installation_id;
END $$;
REVOKE ALL ON FUNCTION public.refresh_guardian_notification_installation(TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_guardian_notification_installation(TEXT,TEXT,TEXT,TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.begin_push_dispatch(p_job UUID, p_owner UUID, p_installation UUID)
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
  IF NOT FOUND OR NOT i.active OR i.firebase_project_id <> 'attendai-41f64'
     OR i.permission_state <> 'granted' OR i.last_seen_at < now() - INTERVAL '90 days'
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

COMMIT;
