-- Accountless guardian consent is separate from staff policy acceptance,
-- guardian communication_consent, relationship preferences, and browser permission.
BEGIN;

CREATE TABLE public.guardian_notification_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  invitation_id uuid NOT NULL UNIQUE REFERENCES public.guardian_notification_invitations(id) ON DELETE RESTRICT,
  installation_id uuid NOT NULL,
  consent_version text NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'revoked')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardian_notification_consent_guardian_fkey FOREIGN KEY (institution_id, guardian_id)
    REFERENCES public.parents(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT guardian_notification_consent_installation_fkey FOREIGN KEY (institution_id, installation_id)
    REFERENCES public.guardian_notification_installations(institution_id, id) ON DELETE RESTRICT,
  CONSTRAINT guardian_notification_consent_state_check
    CHECK ((status = 'accepted' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX guardian_notification_consents_device_idx
  ON public.guardian_notification_consents(institution_id, installation_id, status);
CREATE UNIQUE INDEX one_active_guardian_notice_per_installation
  ON public.guardian_notification_consents(installation_id) WHERE status = 'accepted';
ALTER TABLE public.guardian_notification_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_notification_consents FROM anon, authenticated;

ALTER TABLE public.controlled_push_tests ADD COLUMN student_id uuid;
ALTER TABLE public.controlled_push_tests
  ADD CONSTRAINT controlled_push_tests_student_tenant_fkey FOREIGN KEY (institution_id, student_id)
    REFERENCES public.students(institution_id, id) ON DELETE RESTRICT;

CREATE FUNCTION public.consume_guardian_notification_invitation_with_consent(
  p_token_hash text, p_fid text, p_device_secret_hash text, p_project_id text,
  p_consent_version text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE invitation public.guardian_notification_invitations; new_installation_id uuid;
BEGIN
  IF p_consent_version <> '2026-10-16.1' THEN
    RAISE EXCEPTION 'current guardian notification notice required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO invitation FROM public.guardian_notification_invitations
    WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR invitation.consumed_at IS NOT NULL OR invitation.revoked_at IS NOT NULL
     OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parents p JOIN public.institutions i
      ON i.id = p.institution_id
      WHERE p.id = invitation.guardian_id AND p.institution_id = invitation.institution_id
        AND p.active AND p.communication_consent AND i.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.student_parents sp
       JOIN public.students s ON s.id = sp.student_id AND s.institution_id = sp.institution_id
       WHERE sp.institution_id = invitation.institution_id
         AND sp.parent_id = invitation.guardian_id
         AND sp.receives_notifications AND s.enrollment_status = 'active') THEN
    RAISE EXCEPTION 'guardian notification eligibility unavailable' USING ERRCODE = '22023';
  END IF;
  new_installation_id := public.consume_guardian_notification_invitation(
    p_token_hash, p_fid, p_device_secret_hash, p_project_id);
  UPDATE public.guardian_notification_consents c
    SET status = 'revoked', revoked_at = now()
    WHERE c.installation_id = new_installation_id AND c.status = 'accepted';
  INSERT INTO public.guardian_notification_consents
    (institution_id, guardian_id, invitation_id, installation_id, consent_version)
  VALUES (invitation.institution_id, invitation.guardian_id, invitation.id,
          new_installation_id, p_consent_version);
  RETURN new_installation_id;
END $$;
REVOKE ALL ON FUNCTION public.consume_guardian_notification_invitation_with_consent(text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guardian_notification_invitation_with_consent(text,text,text,text,text)
  TO service_role;

-- Existing installations have no recorded affirmative consent. They remain in
-- history and can be re-enrolled with a new invitation, but cannot receive new sends.
CREATE OR REPLACE FUNCTION public.begin_push_dispatch(p_job uuid, p_owner uuid, p_installation uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.guardian_notification_installations
             WHERE id = p_installation AND revoked_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.guardian_notification_consents c
       WHERE c.installation_id = p_installation AND c.status = 'accepted'
         AND c.revoked_at IS NULL AND c.consent_version = '2026-10-16.1') THEN
    RETURN 'ineligible';
  END IF;
  RETURN public.begin_push_dispatch_before_revocation_guard(p_job,p_owner,p_installation);
END $$;

COMMIT;
