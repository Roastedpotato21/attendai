BEGIN;
CREATE TABLE public.institution_claim_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  registry_id uuid REFERENCES public.institution_registry(id),
  institution_name text NOT NULL CHECK (length(btrim(institution_name)) BETWEEN 2 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX institution_claim_recovery_pending ON public.institution_claim_recovery_requests(
  applicant_profile_id, public.normalize_institution_name(institution_name)) WHERE status = 'pending';
ALTER TABLE public.institution_claim_recovery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_claim_recovery_requests FROM anon,authenticated;
GRANT ALL ON public.institution_claim_recovery_requests TO service_role;
GRANT SELECT ON public.institution_claim_recovery_requests TO authenticated;
CREATE POLICY recovery_own_or_reviewer ON public.institution_claim_recovery_requests
  FOR SELECT TO authenticated USING(applicant_profile_id = public.current_profile_id() OR public.is_verification_reviewer());
CREATE FUNCTION public.request_institution_claim_recovery(p_registry uuid,p_name text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE actor uuid; result uuid;
BEGIN
  actor := public.verification_actor();
  IF (SELECT count(*) FROM public.institution_claim_recovery_requests
    WHERE applicant_profile_id = actor AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'administrator review request limit reached' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.institution_claim_recovery_requests(applicant_profile_id,registry_id,institution_name,reason)
  VALUES(actor,p_registry,p_name,p_reason)
  ON CONFLICT(applicant_profile_id,public.normalize_institution_name(institution_name)) WHERE status = 'pending'
  DO UPDATE SET applicant_profile_id = EXCLUDED.applicant_profile_id RETURNING id INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.request_institution_claim_recovery(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_institution_claim_recovery(uuid,text,text) TO authenticated;
COMMIT;
