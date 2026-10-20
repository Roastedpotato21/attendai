BEGIN;
CREATE FUNCTION public.my_institution_verification_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE p public.profiles; a public.institution_verification_applications; verified boolean; can_apply boolean;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE auth_user_id = auth.uid() AND status = 'active';
  SELECT email_confirmed_at IS NOT NULL INTO verified FROM auth.users WHERE id = auth.uid();
  IF p.id IS NULL OR verified IS DISTINCT FROM true THEN RETURN jsonb_build_object('allowed',false); END IF;
  SELECT * INTO a FROM public.institution_verification_applications WHERE applicant_profile_id = p.id ORDER BY created_at DESC LIMIT 1;
  can_apply := p.student_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id = p.id);
  RETURN jsonb_build_object('allowed',can_apply OR a.id IS NOT NULL OR public.is_verification_reviewer(),
    'can_apply',can_apply,'reviewer',public.is_verification_reviewer(),'application_id',a.id,'status',a.status);
END $$;
REVOKE ALL ON FUNCTION public.my_institution_verification_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_institution_verification_access() TO authenticated;
COMMIT;
