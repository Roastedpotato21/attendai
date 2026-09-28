-- Secure self-service institution onboarding.
--
-- A public Auth signup creates only the neutral profile supplied by
-- handle_new_auth_user(). This function is the sole path that can turn a
-- verified, unassigned identity into the first administrator of a *new*
-- institution. It never accepts a role or institution id from the browser.

BEGIN;

CREATE TABLE public.institution_admin_onboarding (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id UUID NOT NULL UNIQUE REFERENCES public.institutions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.institution_admin_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.institution_admin_onboarding FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.provision_my_new_institution()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_auth_user UUID := auth.uid();
  current_profile UUID;
  profile_status TEXT;
  linked_student UUID;
  onboarding_institution UUID;
  institution_name TEXT;
  institution_code TEXT;
  onboarding_intent TEXT;
  onboarding_metadata JSONB;
  email_verified BOOLEAN;
  created_institution UUID;
BEGIN
  IF current_auth_user IS NULL THEN
    RAISE EXCEPTION 'authentication is required' USING ERRCODE = '42501';
  END IF;

  -- The Auth record is authoritative for verification. A submitted signup is
  -- not enough to receive an administrator membership.
  SELECT email_confirmed_at IS NOT NULL, raw_user_meta_data
    INTO email_verified, onboarding_metadata
  FROM auth.users
  WHERE id = current_auth_user;

  IF NOT FOUND OR NOT COALESCE(email_verified, FALSE) THEN
    RAISE EXCEPTION 'email verification is required' USING ERRCODE = '42501';
  END IF;

  -- Locking the profile serializes retries. A completed request becomes an
  -- idempotent return, rather than creating another tenant or role.
  SELECT id, status, student_id
    INTO current_profile, profile_status, linked_student
  FROM public.profiles
  WHERE auth_user_id = current_auth_user
  FOR UPDATE;

  IF current_profile IS NULL OR profile_status <> 'active' THEN
    RAISE EXCEPTION 'profile is not active' USING ERRCODE = '42501';
  END IF;

  SELECT institution_id
    INTO onboarding_institution
  FROM public.institution_admin_onboarding
  WHERE profile_id = current_profile;

  IF onboarding_institution IS NOT NULL THEN
    RETURN onboarding_institution;
  END IF;

  -- A student, invited staff member, or anyone already attached to a tenant
  -- must use the existing staff-invitation flow. They cannot self-promote or
  -- create another tenant through this endpoint.
  IF linked_student IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.profile_roles
      WHERE profile_id = current_profile AND role_code = 'student'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profile_institutions
      WHERE profile_id = current_profile
    ) THEN
    RAISE EXCEPTION 'this identity cannot create a new institution' USING ERRCODE = '42501';
  END IF;

  onboarding_intent := COALESCE(onboarding_metadata ->> 'onboarding_intent', '');
  institution_name := btrim(COALESCE(onboarding_metadata ->> 'onboarding_institution_name', ''));
  institution_code := lower(btrim(COALESCE(onboarding_metadata ->> 'onboarding_institution_code', '')));

  IF onboarding_intent <> 'new_institution_admin'
    OR char_length(institution_name) < 2
    OR char_length(institution_name) > 120
    OR institution_code !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'institution onboarding details are invalid' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.institutions (name, code, status)
    VALUES (institution_name, institution_code, 'active')
    RETURNING id INTO created_institution;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'institution code is unavailable' USING ERRCODE = '23505';
  END;

  INSERT INTO public.profile_institutions (
    profile_id, institution_id, status, activated_at
  ) VALUES (
    current_profile, created_institution, 'active', timezone('utc', now())
  );

  INSERT INTO public.profile_roles (
    profile_id, institution_id, role_code, assigned_by
  ) VALUES (
    current_profile, created_institution, 'admin', current_profile
  );

  INSERT INTO public.institution_admin_onboarding (profile_id, institution_id)
  VALUES (current_profile, created_institution);

  INSERT INTO public.audit_logs (
    institution_id, actor_id, action, target, ip, severity, entity_type, entity_id, metadata
  ) VALUES (
    created_institution,
    current_profile,
    'institution.created',
    institution_name,
    'database',
    'info',
    'institution',
    created_institution,
    jsonb_build_object('code', institution_code, 'provisioning', 'first_admin')
  );

  RETURN created_institution;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_my_new_institution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_my_new_institution() TO authenticated;

COMMIT;
