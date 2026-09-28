-- Staff portal identity lifecycle.  Public sign-up never creates a tenant
-- membership or a privileged role; those are provisioned only by the trusted
-- server/bootstrap paths.  A pending invite cannot access tenant data.

BEGIN;

ALTER TABLE public.profile_institutions
  DROP CONSTRAINT IF EXISTS profile_institutions_status_check;

ALTER TABLE public.profile_institutions
  ADD CONSTRAINT profile_institutions_status_check
    CHECK (status IN ('invited', 'active', 'inactive', 'suspended', 'revoked'));

ALTER TABLE public.profile_institutions
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profile_institutions_invited
  ON public.profile_institutions(institution_id, status)
  WHERE status = 'invited';

-- This is deliberately a no-argument, SECURITY DEFINER operation.  The
-- caller can only activate their own pre-provisioned invite and never chooses
-- a tenant or role from the browser.  It also works for the first trusted
-- admin, whose role was assigned by the offline bootstrap command.
CREATE OR REPLACE FUNCTION public.activate_my_staff_invitation()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID;
  target_institution UUID;
BEGIN
  SELECT id INTO current_profile
  FROM public.profiles
  WHERE auth_user_id = auth.uid() AND status = 'active';

  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'profile is not active' USING ERRCODE = '42501';
  END IF;

  SELECT membership.institution_id INTO target_institution
  FROM public.profile_institutions membership
  JOIN public.institutions institution ON institution.id = membership.institution_id
  WHERE membership.profile_id = current_profile
    AND membership.status = 'invited'
    AND institution.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.profile_roles assignment
      WHERE assignment.profile_id = current_profile
        AND assignment.institution_id = membership.institution_id
        AND assignment.role_code IN ('admin', 'faculty', 'staff')
    )
  ORDER BY membership.invited_at NULLS LAST, membership.created_at
  LIMIT 1;

  IF target_institution IS NULL THEN
    RAISE EXCEPTION 'no valid staff invitation exists' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profile_institutions
  SET status = 'active', activated_at = timezone('utc', now()), revoked_at = NULL
  WHERE profile_id = current_profile
    AND institution_id = target_institution
    AND status = 'invited';

  INSERT INTO public.audit_logs (
    institution_id, actor_id, action, target, ip, severity, entity_type, entity_id, metadata
  ) VALUES (
    target_institution, current_profile, 'staff.membership_activated', 'Staff invitation accepted',
    'database', 'info', 'profile', current_profile, '{}'::jsonb
  );

  RETURN target_institution;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_my_staff_invitation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_my_staff_invitation() TO authenticated;

COMMIT;
