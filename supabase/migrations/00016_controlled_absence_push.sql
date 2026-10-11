-- Explicit one-attempt outbox path for an already-submitted, still-absent event.
-- Historical SMS rows remain untouched. Only trusted service_role can invoke it.
BEGIN;

CREATE FUNCTION public.enqueue_existing_absence_push(
  p_session UUID, p_student UUID, p_guardian UUID, p_installation UUID
) RETURNS TABLE(communication_id UUID, job_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  event_row RECORD;
  target RECORD;
  device_count INT;
  limit_count INT := 3;
  limit_window INTERVAL := INTERVAL '1 hour';
  event_key TEXT;
  created_communication UUID;
  created_job UUID;
BEGIN
  SELECT ar.institution_id, session.date, session.status AS session_status
    INTO event_row
  FROM public.attendance_records ar
  JOIN public.attendance_sessions session
    ON session.id = ar.session_id AND session.institution_id = ar.institution_id
  WHERE ar.session_id = p_session AND ar.student_id = p_student
    AND ar.status = 'absent'
  FOR SHARE OF ar, session;
  IF NOT FOUND OR event_row.session_status <> 'submitted'
     OR event_row.date > CURRENT_DATE
     OR event_row.date < CURRENT_DATE - 14 THEN
    RAISE EXCEPTION 'submitted current absence unavailable' USING ERRCODE = '22023';
  END IF;

  SELECT p.id AS guardian_id, p.language, p.institution_id
    INTO target
  FROM public.students s
  JOIN public.parents p
    ON p.id = p_guardian AND p.institution_id = s.institution_id
  JOIN public.student_parents sp
    ON sp.student_id = s.id AND sp.parent_id = p.id
       AND sp.institution_id = s.institution_id
  JOIN public.institutions institution ON institution.id = s.institution_id
  WHERE s.id = p_student AND s.institution_id = event_row.institution_id
    AND s.parent_id = p.id AND s.enrollment_status = 'active'
    AND p.active AND p.communication_consent AND sp.receives_notifications
    AND institution.status = 'active'
  FOR SHARE OF s, p, sp, institution;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guardian or tenant is ineligible' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO device_count
  FROM public.guardian_notification_installations i
  WHERE i.institution_id = event_row.institution_id
    AND i.guardian_id = p_guardian AND i.active;
  IF device_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.guardian_notification_installations i
    WHERE i.id = p_installation AND i.institution_id = event_row.institution_id
      AND i.guardian_id = p_guardian AND i.active
      AND i.firebase_project_id = 'attendai-41f64'
      AND i.permission_state = 'granted' AND i.revoked_at IS NULL
      AND i.last_seen_at >= now() - INTERVAL '90 days'
  ) THEN
    RAISE EXCEPTION 'one current-project device required' USING ERRCODE = '22023';
  END IF;

  event_key := format('absence:%s:%s:%s:%s:push',
    event_row.institution_id, event_row.date, p_student, p_guardian);
  PERFORM pg_advisory_xact_lock(hashtextextended(event_key, 0));
  IF EXISTS (
    SELECT 1 FROM public.communications c
    WHERE c.institution_id = event_row.institution_id
      AND c.student_id = p_student AND c.parent_id = p_guardian
      AND c.type = 'push'
      AND (c.idempotency_key = event_key
        OR c.metadata->>'attendance_session_id' = p_session::TEXT)
  ) THEN
    RAISE EXCEPTION 'push already recorded for this absence' USING ERRCODE = '23505';
  END IF;
  SELECT r.max_per_parent_per_window, r.window_length
    INTO limit_count, limit_window
  FROM public.communication_rate_limits r
  WHERE r.institution_id = event_row.institution_id;
  limit_count := COALESCE(limit_count, 3);
  limit_window := COALESCE(limit_window, INTERVAL '1 hour');
  IF (
    SELECT count(*) FROM public.communications c
    WHERE c.institution_id = event_row.institution_id
      AND c.parent_id = p_guardian AND c.type = 'push'
      AND c.created_at >= timezone('utc', now()) - limit_window
  ) >= limit_count THEN
    RAISE EXCEPTION 'guardian push rate limit reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.communications
    (institution_id, student_id, parent_id, type, direction, message_status,
     body, metadata, idempotency_key)
  VALUES
    (event_row.institution_id, p_student, p_guardian, 'push', 'outbound', 'queued',
     'Attendance absence notification.',
     jsonb_build_object('purpose', 'absence-alert',
       'attendance_session_id', p_session, 'attendance_date', event_row.date,
       'language', target.language),
     event_key)
  RETURNING id INTO created_communication;
  INSERT INTO public.communication_jobs
    (institution_id, communication_id, channel, payload, idempotency_key, max_attempts)
  VALUES
    (event_row.institution_id, created_communication, 'push',
     jsonb_build_object('communication_id', created_communication), event_key, 1)
  RETURNING id INTO created_job;
  RETURN QUERY SELECT created_communication, created_job;
END $$;

REVOKE ALL ON FUNCTION public.enqueue_existing_absence_push(UUID,UUID,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_existing_absence_push(UUID,UUID,UUID,UUID)
  TO service_role;

COMMIT;
