-- Local-only regression of FCM schema, RLS, enrollment and per-device fencing.
BEGIN;

INSERT INTO public.guardian_notification_invitations
  (institution_id, guardian_id, token_hash, expires_at, created_by)
VALUES
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', repeat('a',64), now() + INTERVAL '15 minutes', '00000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', repeat('b',64), now() + INTERVAL '15 minutes', '00000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', repeat('c',64), now() - INTERVAL '1 minute', '00000000-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', repeat('0',64), now() + INTERVAL '15 minutes', '00000000-0000-4000-8000-000000000001');
INSERT INTO public.guardian_notification_invitations
  (institution_id, guardian_id, token_hash, expires_at, revoked_at, created_by)
VALUES ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', repeat('9',64), now() + INTERVAL '15 minutes', now(), '00000000-0000-4000-8000-000000000001');

DO $$ DECLARE first_id UUID; second_id UUID; renewed_id UUID; BEGIN
  first_id := public.consume_guardian_notification_invitation_with_consent(repeat('a',64), 'fid-guardian-phone-0001', repeat('d',64), 'attendai-41f64', '2026-10-16.1');
  second_id := public.consume_guardian_notification_invitation_with_consent(repeat('b',64), 'fid-guardian-tablet-0002', repeat('e',64), 'attendai-41f64', '2026-10-16.1');
  IF first_id = second_id OR (SELECT count(*) FROM public.guardian_notification_installations
      WHERE guardian_id = '30000000-0000-4000-8000-000000000001' AND active) <> 2 THEN
    RAISE EXCEPTION 'multi-device enrollment failed'; END IF;
  renewed_id := public.consume_guardian_notification_invitation_with_consent(repeat('0',64), 'fid-guardian-phone-0001', repeat('6',64), 'attendai-41f64', '2026-10-16.1');
  IF renewed_id <> first_id OR
     (SELECT count(*) FROM public.guardian_notification_consents
       WHERE installation_id = first_id AND status = 'accepted') <> 1 OR
     (SELECT count(*) FROM public.guardian_notification_consents
       WHERE installation_id = first_id AND status = 'revoked') <> 1 THEN
    RAISE EXCEPTION 'device re-enrollment did not preserve consent history'; END IF;
  BEGIN
    PERFORM public.consume_guardian_notification_invitation_with_consent(repeat('a',64), 'fid-guardian-replay-0003', repeat('f',64), 'attendai-41f64', '2026-10-16.1');
    RAISE EXCEPTION 'replayed invitation accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.consume_guardian_notification_invitation_with_consent(repeat('c',64), 'fid-guardian-expired-0004', repeat('f',64), 'attendai-41f64', '2026-10-16.1');
    RAISE EXCEPTION 'expired invitation accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.consume_guardian_notification_invitation_with_consent(repeat('9',64), 'fid-guardian-revoked-0005', repeat('f',64), 'attendai-41f64', '2026-10-16.1');
    RAISE EXCEPTION 'revoked invitation accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN
    PERFORM public.consume_guardian_notification_invitation_with_consent(repeat('c',64), 'fid-guardian-no-consent-0006', repeat('f',64), 'attendai-41f64', 'old-version');
    RAISE EXCEPTION 'outdated consent version accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

-- Existing records without project identity are labeled old. They cannot be
-- dispatched by the new fence; refreshing keeps that historical row.
DO $$ DECLARE old_id UUID; new_id UUID; BEGIN
  INSERT INTO public.guardian_notification_installations
    (institution_id, guardian_id, firebase_installation_id, device_secret_hash, permission_state)
  VALUES ('11111111-1111-4111-8111-111111111111',
    '30000000-0000-4000-8000-000000000001', 'fid-old-project-0007', repeat('7',64), 'granted')
  RETURNING id INTO old_id;
  IF (SELECT firebase_project_id FROM public.guardian_notification_installations WHERE id = old_id)
      <> 'siri-1b57c' THEN RAISE EXCEPTION 'historical project was not labeled'; END IF;
  new_id := public.refresh_guardian_notification_installation(
    repeat('7',64), repeat('8',64), 'fid-new-project-0008', 'attendai-41f64');
  IF new_id = old_id OR NOT EXISTS (SELECT 1 FROM public.guardian_notification_installations
       WHERE id = old_id AND NOT active AND failure_reason = 'fcm_project_migrated')
     OR NOT EXISTS (SELECT 1 FROM public.guardian_notification_installations
       WHERE id = new_id AND active AND firebase_project_id = 'attendai-41f64') THEN
    RAISE EXCEPTION 'project migration did not preserve old installation'; END IF;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO public.guardian_notification_installations
      (institution_id, guardian_id, firebase_installation_id, device_secret_hash, permission_state)
    VALUES ('22222222-2222-4222-8222-222222222222', '30000000-0000-4000-8000-000000000001',
      'fid-cross-tenant-0005', repeat('f',64), 'granted');
    RAISE EXCEPTION 'cross-tenant installation accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.guardian_notification_installations) THEN
      RAISE EXCEPTION 'authenticated role read device identifier'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.consume_guardian_notification_invitation(repeat('a',64), 'fid-unauthorized-0006', repeat('f',64), 'attendai-41f64');
    RAISE EXCEPTION 'authenticated role consumed invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ DECLARE j public.communication_jobs; device RECORD; decision TEXT; outcome TEXT; old_id UUID; BEGIN
  SELECT job.* INTO j FROM public.communication_jobs job
  JOIN public.communications c ON c.id = job.communication_id
  WHERE c.student_id = '10000000-0000-4000-8000-000000000001'
    AND c.type = 'push' AND job.status = 'pending' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'seed absence did not create push job'; END IF;
  SELECT * INTO j FROM public.claim_push_jobs(10) WHERE id = j.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'push job not leased'; END IF;
  SELECT id INTO old_id FROM public.guardian_notification_installations
    WHERE firebase_project_id = 'siri-1b57c' LIMIT 1;
  IF public.begin_push_dispatch(j.id, j.lease_owner, old_id) <> 'ineligible' THEN
    RAISE EXCEPTION 'old-project device passed new FCM dispatch fence'; END IF;
  SELECT id INTO old_id FROM public.guardian_notification_installations
    WHERE firebase_installation_id = 'fid-new-project-0008';
  IF public.begin_push_dispatch(j.id, j.lease_owner, old_id) <> 'ineligible' THEN
    RAISE EXCEPTION 'legacy device without explicit notice consent passed dispatch fence'; END IF;
  FOR device IN SELECT i.id FROM public.guardian_notification_installations i
    JOIN public.guardian_notification_consents c ON c.installation_id = i.id
    WHERE i.guardian_id = '30000000-0000-4000-8000-000000000001' AND i.active
      AND c.status = 'accepted' LOOP
    decision := public.begin_push_dispatch(j.id, j.lease_owner, device.id);
    IF decision <> 'send' THEN RAISE EXCEPTION 'device send fence failed: %', decision; END IF;
    IF NOT public.finish_push_dispatch(j.id, j.lease_owner, device.id, 'provider_accepted',
      'projects/attendai-41f64/messages/test', NULL) THEN
      RAISE EXCEPTION 'device result not stored'; END IF;
    IF public.begin_push_dispatch(j.id, j.lease_owner, device.id) <> 'already_accepted' THEN
      RAISE EXCEPTION 'accepted device could be sent twice'; END IF;
  END LOOP;
  outcome := public.complete_push_job(j.id, j.lease_owner, false);
  IF outcome <> 'provider_accepted' OR
     (SELECT count(*) FROM public.communication_dispatches WHERE job_id = j.id
       AND status = 'provider_accepted') <> 2 THEN
    RAISE EXCEPTION 'multi-device accepted state was not preserved'; END IF;
  IF (SELECT message_status FROM public.communications WHERE id = j.communication_id)
     <> 'provider_accepted' THEN RAISE EXCEPTION 'FCM acceptance was mislabeled'; END IF;
END $$;

-- A guardian without any installation is visible as such in communication
-- history; the job cannot be reported as delivered or provider accepted.
WITH communication AS (
  INSERT INTO public.communications
    (institution_id, student_id, parent_id, type, message_status, metadata)
  VALUES ('11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002', 'push', 'queued',
    '{"purpose":"absence-alert"}'::jsonb)
  RETURNING id
)
INSERT INTO public.communication_jobs
  (institution_id, communication_id, channel, idempotency_key)
SELECT '11111111-1111-4111-8111-111111111111', id, 'push',
  'guardian-no-device-test' FROM communication;

DO $$ DECLARE j public.communication_jobs; BEGIN
  SELECT * INTO j FROM public.claim_push_jobs(1);
  IF NOT FOUND OR public.complete_push_job(j.id, j.lease_owner, false)
      <> 'no_registered_device' THEN
    RAISE EXCEPTION 'no-device push was falsely marked accepted'; END IF;
  IF (SELECT c.message_status FROM public.communications c WHERE c.id = j.communication_id)
      <> 'no_registered_device' THEN
    RAISE EXCEPTION 'no-device history status was not stored'; END IF;
END $$;

-- Consent revoked after enqueue must fail the per-dispatch database fence.
WITH communication AS (
  INSERT INTO public.communications
    (institution_id, student_id, parent_id, type, message_status, metadata)
  VALUES ('11111111-1111-4111-8111-111111111111',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', 'push', 'queued',
    '{"purpose":"absence-alert","attendance_session_id":"60000000-0000-4000-8000-000000000001"}'::jsonb)
  RETURNING id
)
INSERT INTO public.communication_jobs
  (institution_id, communication_id, channel, idempotency_key)
SELECT '11111111-1111-4111-8111-111111111111', id, 'push',
  'guardian-revoked-consent-test' FROM communication;

DO $$ DECLARE j public.communication_jobs; device_id UUID; BEGIN
  SELECT id INTO device_id FROM public.guardian_notification_installations
  WHERE guardian_id = '30000000-0000-4000-8000-000000000001' LIMIT 1;
  SELECT * INTO j FROM public.claim_push_jobs(1);
  UPDATE public.parents SET communication_consent = false
  WHERE id = '30000000-0000-4000-8000-000000000001';
  IF public.begin_push_dispatch(j.id, j.lease_owner, device_id) <> 'ineligible' THEN
    RAISE EXCEPTION 'revoked consent passed dispatch fence'; END IF;
  IF public.complete_push_job(j.id, j.lease_owner, true) <> 'suppressed' THEN
    RAISE EXCEPTION 'revoked consent did not suppress push'; END IF;
  UPDATE public.parents SET communication_consent = true
  WHERE id = '30000000-0000-4000-8000-000000000001';
END $$;

ROLLBACK;
