BEGIN;
CREATE FUNCTION public.can_review_verification_application(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_temp AS $$
  SELECT public.is_verification_reviewer() AND EXISTS(
    SELECT 1 FROM public.institution_verification_applications WHERE id = p_id
      AND applicant_profile_id <> public.current_profile_id());
$$;
REVOKE ALL ON FUNCTION public.can_review_verification_application(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_review_verification_application(uuid) TO authenticated;
DROP POLICY verification_contact_read ON public.institution_official_contacts;
DROP POLICY verification_confirmation_read ON public.institution_authority_confirmations;
DROP POLICY verification_review_read ON public.institution_verification_reviews;
DROP POLICY verification_event_read ON public.institution_verification_events;
CREATE POLICY verification_contact_read ON public.institution_official_contacts FOR SELECT TO authenticated
  USING(public.can_review_verification_application(application_id));
CREATE POLICY verification_confirmation_read ON public.institution_authority_confirmations FOR SELECT TO authenticated
  USING(public.can_review_verification_application(application_id));
CREATE POLICY verification_review_read ON public.institution_verification_reviews FOR SELECT TO authenticated
  USING(public.can_review_verification_application(application_id));
CREATE POLICY verification_event_read ON public.institution_verification_events FOR SELECT TO authenticated
  USING(public.can_review_verification_application(application_id));

CREATE FUNCTION public.verification_confirmation_not_disputed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS(
    SELECT 1 FROM public.institution_authority_confirmations WHERE application_id = NEW.id
      AND application_revision = NEW.revision AND NOT confirmed) THEN
    RAISE EXCEPTION 'official authority confirmation is disputed; new evidence and re-review required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.verification_confirmation_not_disputed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER verification_confirmation_not_disputed BEFORE UPDATE ON public.institution_verification_applications
  FOR EACH ROW EXECUTE FUNCTION public.verification_confirmation_not_disputed();

CREATE FUNCTION public.verification_orphan_objects()
RETURNS TABLE(object_path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'retention worker required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'institution-verification'
    AND o.created_at < now() - interval '1 hour'
    AND NOT EXISTS(SELECT 1 FROM public.institution_verification_evidence e WHERE e.object_path = o.name)
    ORDER BY o.created_at,o.name LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.verification_orphan_objects() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verification_orphan_objects() TO service_role;
COMMIT;
