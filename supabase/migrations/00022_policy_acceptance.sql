-- Versioned staff policy acknowledgement. Independent of guardian consent.
BEGIN;

CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type text NOT NULL CHECK (policy_type IN ('terms', 'privacy')),
  version text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  effective_at timestamptz NOT NULL DEFAULT now(),
  content_revision text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  UNIQUE (policy_type, version)
);
CREATE UNIQUE INDEX one_active_policy_per_type ON public.policy_versions(policy_type) WHERE active;
CREATE TABLE public.user_policy_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL REFERENCES public.policy_versions(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  acceptance_method text NOT NULL CHECK (acceptance_method IN ('signup', 'access_gate')),
  UNIQUE (user_id, policy_version_id)
);
CREATE INDEX user_policy_acceptances_user_idx ON public.user_policy_acceptances(user_id);
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_policy_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_versions, public.user_policy_acceptances FROM anon, authenticated;

INSERT INTO public.policy_versions(policy_type, version, content_revision, active) VALUES
  ('terms', '2026-10-15.1', '2026-10-15.1', true),
  ('privacy', '2026-10-15.1', '2026-10-15.1', true);

CREATE FUNCTION public.has_current_policy_acceptance(p_user uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_user IS NOT NULL
    AND (p_user = auth.uid() OR auth.role() = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM public.policy_versions v
    WHERE v.active AND v.effective_at <= now() AND NOT EXISTS (
      SELECT 1 FROM public.user_policy_acceptances a
      WHERE a.user_id = p_user AND a.policy_version_id = v.id
    )
  ) AND (SELECT count(*) FROM public.policy_versions v
         WHERE v.active AND v.effective_at <= now() AND v.policy_type IN ('terms','privacy')) = 2;
$$;
REVOKE ALL ON FUNCTION public.has_current_policy_acceptance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_current_policy_acceptance(uuid) TO authenticated, service_role;

CREATE FUNCTION public.my_policy_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'type', v.policy_type, 'version', v.version,
    'accepted', EXISTS (SELECT 1 FROM public.user_policy_acceptances a
      WHERE a.user_id = auth.uid() AND a.policy_version_id = v.id)) ORDER BY v.policy_type), '[]'::jsonb)
  INTO result FROM public.policy_versions v WHERE v.active AND v.effective_at <= now();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.my_policy_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_policy_status() TO authenticated;

CREATE FUNCTION public.accept_current_policies(p_terms uuid, p_privacy uuid, p_method text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR p_method NOT IN ('signup', 'access_gate')
    OR p_terms IS NULL OR p_privacy IS NULL OR p_terms = p_privacy THEN
    RAISE EXCEPTION 'invalid acceptance' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_versions WHERE id = p_terms AND policy_type = 'terms' AND active AND effective_at <= now())
    OR NOT EXISTS (SELECT 1 FROM public.policy_versions WHERE id = p_privacy AND policy_type = 'privacy' AND active AND effective_at <= now()) THEN
    RAISE EXCEPTION 'current policy versions required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_policy_acceptances(user_id, policy_version_id, acceptance_method)
  VALUES (auth.uid(), p_terms, p_method), (auth.uid(), p_privacy, p_method)
  ON CONFLICT (user_id, policy_version_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.accept_current_policies(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_current_policies(uuid,uuid,text) TO authenticated;

-- Existing onboarding function remains intact but cannot be invoked without
-- durable acceptance. The wrapper is the only authenticated entry point.
ALTER FUNCTION public.provision_my_new_institution() RENAME TO provision_my_new_institution_after_policy;
REVOKE ALL ON FUNCTION public.provision_my_new_institution_after_policy() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.provision_my_new_institution()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_current_policy_acceptance(auth.uid()) THEN
    RAISE EXCEPTION 'current policy acceptance required' USING ERRCODE = '42501';
  END IF;
  RETURN public.provision_my_new_institution_after_policy();
END $$;
REVOKE ALL ON FUNCTION public.provision_my_new_institution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_my_new_institution() TO authenticated;

ALTER FUNCTION public.activate_my_staff_invitation() RENAME TO activate_my_staff_invitation_after_policy;
REVOKE ALL ON FUNCTION public.activate_my_staff_invitation_after_policy() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.activate_my_staff_invitation()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_current_policy_acceptance(auth.uid()) THEN
    RAISE EXCEPTION 'current policy acceptance required' USING ERRCODE = '42501';
  END IF;
  RETURN public.activate_my_staff_invitation_after_policy();
END $$;
REVOKE ALL ON FUNCTION public.activate_my_staff_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_my_staff_invitation() TO authenticated;

-- SECURITY DEFINER attendance RPCs bypass table RLS; gate them explicitly.
ALTER FUNCTION public.submit_attendance(uuid,date,text,jsonb) RENAME TO submit_attendance_after_policy;
REVOKE ALL ON FUNCTION public.submit_attendance_after_policy(uuid,date,text,jsonb) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.submit_attendance(p_class_id uuid, p_date date, p_method text, p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_current_policy_acceptance(auth.uid()) THEN
    RAISE EXCEPTION 'current policy acceptance required' USING ERRCODE = '42501';
  END IF;
  RETURN public.submit_attendance_after_policy(p_class_id,p_date,p_method,p_records);
END $$;
REVOKE ALL ON FUNCTION public.submit_attendance(uuid,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_attendance(uuid,date,text,jsonb) TO authenticated;

ALTER FUNCTION public.update_attendance(uuid,integer,jsonb) RENAME TO update_attendance_after_policy;
REVOKE ALL ON FUNCTION public.update_attendance_after_policy(uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.update_attendance(p_session_id uuid, p_expected_revision integer, p_records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_current_policy_acceptance(auth.uid()) THEN
    RAISE EXCEPTION 'current policy acceptance required' USING ERRCODE = '42501';
  END IF;
  RETURN public.update_attendance_after_policy(p_session_id,p_expected_revision,p_records);
END $$;
REVOKE ALL ON FUNCTION public.update_attendance(uuid,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_attendance(uuid,integer,jsonb) TO authenticated;

-- Preserve the existing atomic dispatch fence while rejecting inconsistent
-- rows that have a revocation timestamp but still appear active.
ALTER FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) RENAME TO begin_push_dispatch_before_revocation_guard;
REVOKE ALL ON FUNCTION public.begin_push_dispatch_before_revocation_guard(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.begin_push_dispatch(p_job uuid, p_owner uuid, p_installation uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_notification_installations
             WHERE id = p_installation AND revoked_at IS NOT NULL) THEN
    RETURN 'ineligible';
  END IF;
  RETURN public.begin_push_dispatch_before_revocation_guard(p_job,p_owner,p_installation);
END $$;
REVOKE ALL ON FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_push_dispatch(uuid,uuid,uuid) TO service_role;

-- Controlled trial claims one preflighted job, never the whole pending queue.
CREATE FUNCTION public.claim_specific_push_job(p_job uuid)
RETURNS SETOF public.communication_jobs LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  UPDATE public.communication_jobs j SET status = 'processing',
    attempts = attempts + 1, locked_at = now(), lease_owner = gen_random_uuid()
  WHERE j.id = p_job AND j.channel = 'push' AND j.status = 'pending'
    AND j.attempts < j.max_attempts AND j.next_run_at <= now()
  RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.claim_specific_push_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_specific_push_job(uuid) TO service_role;

-- Test notifications have no attendance relationship and cannot be mistaken
-- for an attendance dispatch in application history.
CREATE TABLE public.controlled_push_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  guardian_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  execution_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('queued','sending','provider_accepted','failed','unconfirmed')),
  provider_message_id text,
  ttl_seconds integer NOT NULL CHECK (ttl_seconds BETWEEN 60 AND 3600),
  display_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT controlled_push_tests_guardian_tenant_fkey FOREIGN KEY (institution_id, guardian_id)
    REFERENCES public.parents(institution_id,id),
  CONSTRAINT controlled_push_tests_installation_tenant_fkey FOREIGN KEY (institution_id, installation_id)
    REFERENCES public.guardian_notification_installations(institution_id,id)
);
ALTER TABLE public.controlled_push_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.controlled_push_tests FROM anon, authenticated;

-- Restrictive policy is additive to existing tenant/role policies. Service
-- role bypass remains for trusted jobs; direct staff table reads/writes wait.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'students','parents','student_parents','classes',
    'interventions','escalations',
    'attendance_sessions','attendance_records','attendance_corrections',
    'communications','communication_jobs','communication_dispatches',
    'guardian_notification_installations','guardian_notification_invitations'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY current_staff_policy_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.has_current_policy_acceptance(auth.uid())) WITH CHECK (public.has_current_policy_acceptance(auth.uid()))', table_name);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.communication_dispatches
  ADD COLUMN display_acknowledged_at timestamptz;
COMMIT;
