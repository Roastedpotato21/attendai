-- Fresh authority review reuses Problem #1 quarantined evidence, revision gates,
-- independent contacts, confirmations, photo challenges, privacy and retention.
BEGIN;
ALTER TABLE public.institution_verification_applications DROP CONSTRAINT institution_verification_applications_institution_id_key;
ALTER TABLE public.institution_verification_applications ADD COLUMN purpose text NOT NULL DEFAULT 'initial'
 CHECK(purpose IN ('initial','ownership_recovery','leadership_replacement')),
 ADD COLUMN target_staff_id uuid REFERENCES public.staff_records(id),
 ADD COLUMN expected_owner_profile_id uuid REFERENCES public.profiles(id),
 ADD COLUMN requested_capability text CHECK(requested_capability IN ('institution_owner','institution_admin')),
 ADD COLUMN request_reason text CHECK(length(btrim(request_reason)) BETWEEN 20 AND 2000);
ALTER TABLE public.institution_verification_applications ADD COLUMN candidate_updated_at timestamptz;
ALTER TABLE public.institution_verification_applications ADD CHECK((purpose='initial' AND target_staff_id IS NULL AND requested_capability IS NULL)
 OR (purpose<>'initial' AND target_staff_id IS NOT NULL AND requested_capability IS NOT NULL AND request_reason IS NOT NULL));
DROP INDEX public.verification_applicant_open;
DROP INDEX public.verification_name_claim;
CREATE UNIQUE INDEX verification_initial_institution ON public.institution_verification_applications(institution_id) WHERE purpose='initial';
CREATE UNIQUE INDEX verification_applicant_open ON public.institution_verification_applications(applicant_profile_id) WHERE purpose='initial' AND status NOT IN ('rejected','revoked');
CREATE UNIQUE INDEX verification_name_claim ON public.institution_verification_applications(claim_key) WHERE purpose='initial' AND status NOT IN ('rejected','revoked');
CREATE UNIQUE INDEX staff_authority_open ON public.institution_verification_applications(institution_id,target_staff_id)
 WHERE purpose<>'initial' AND status NOT IN ('approved','rejected','revoked');
CREATE OR REPLACE FUNCTION public.can_review_verification_application(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_verification_reviewer() AND EXISTS(SELECT 1 FROM public.institution_verification_applications a
 WHERE a.id=p_id AND a.applicant_profile_id<>public.current_profile_id()
 AND (a.purpose='initial' OR NOT EXISTS(SELECT 1 FROM public.profile_institutions m
  WHERE m.institution_id=a.institution_id AND m.profile_id=public.current_profile_id())));
$$;
CREATE OR REPLACE FUNCTION public.verification_actor(p_application uuid DEFAULT NULL,p_reviewer boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 SELECT p.id INTO actor FROM public.profiles p JOIN auth.users u ON u.id=p.auth_user_id
  WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL AND p.status='active';
 IF actor IS NULL OR NOT public.has_current_policy_acceptance(auth.uid()) THEN RAISE EXCEPTION 'verified identity and current policies required' USING ERRCODE='42501'; END IF;
 IF p_reviewer AND (NOT public.is_verification_reviewer() OR (p_application IS NOT NULL AND NOT public.can_review_verification_application(p_application))) THEN
  RAISE EXCEPTION 'independent platform reviewer required' USING ERRCODE='42501'; END IF;
 IF p_application IS NOT NULL AND NOT p_reviewer AND NOT EXISTS(SELECT 1 FROM public.institution_verification_applications WHERE id=p_application AND applicant_profile_id=actor) THEN
  RAISE EXCEPTION 'application unavailable' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION public.recovery_candidate_valid(p_staff uuid,p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_records s JOIN public.profiles p ON p.id=s.profile_id JOIN auth.users u ON u.id=p.auth_user_id
 WHERE s.id=p_staff AND s.institution_id=p_institution AND s.status IN ('draft','inactive','left_institution','active') AND p.status='active' AND p.student_id IS NULL
 AND u.email_confirmed_at IS NOT NULL AND lower(u.email)=s.email AND public.lifecycle_current_policies(u.id));
$$;
CREATE FUNCTION public.activate_reviewed_successor(p_staff uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 IF NOT public.recovery_candidate_valid(s.id,s.institution_id) THEN RAISE EXCEPTION 'reviewed successor identity changed' USING ERRCODE='42501'; END IF;
 IF NOT public.lifecycle_eligible_staff(s.id,s.institution_id) THEN
  UPDATE public.staff_role_grants SET active=false,closed_at=now(),ended_on=coalesce(ended_on,greatest(valid_from-1,public.setup_today(s.institution_id)-1)),end_reason=p_reason WHERE staff_id=s.id AND active;
  UPDATE public.staff_records SET status='active',legacy_class_assignments=false,lifecycle_reason=p_reason,lifecycle_actor=public.current_profile_id(),lifecycle_at=now(),updated_at=now() WHERE id=s.id;
  INSERT INTO public.profile_institutions(profile_id,institution_id,status,activated_at) VALUES(s.profile_id,s.institution_id,'active',now())
  ON CONFLICT(profile_id,institution_id) DO UPDATE SET status='active',revoked_at=NULL,activated_at=now();
  PERFORM public.lifecycle_event(s.institution_id,s.id,'staff.authority_activated',to_jsonb(s),jsonb_build_object('status','active'),p_reason);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.recovery_candidate_valid(uuid,uuid),public.activate_reviewed_successor(uuid,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.start_staff_authority_review(p_institution uuid,p_purpose text,p_capability text,p_details jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; i public.institutions; original public.institution_verification_applications; s public.staff_records; result uuid; institution_value uuid;
BEGIN
 actor:=public.verification_actor();PERFORM public.validate_verification_details(p_details);
 institution_value:=p_institution;
 IF institution_value IS NULL THEN
  SELECT min(id::text)::uuid INTO institution_value FROM public.institutions WHERE status='active'
   AND public.normalize_institution_name(name)=public.normalize_institution_name(p_details->>'institution_name')
   AND public.normalize_institution_name(state)=public.normalize_institution_name(p_details->>'state') HAVING count(*)=1;
 END IF;
 PERFORM public.lock_staff_lifecycle(institution_value);
 SELECT * INTO i FROM public.institutions WHERE id=institution_value FOR UPDATE;
 SELECT * INTO original FROM public.institution_verification_applications WHERE id=i.verification_application_id AND purpose='initial' AND status='approved';
 SELECT * INTO s FROM public.staff_records WHERE institution_id=institution_value AND profile_id=actor FOR UPDATE;
 IF p_purpose IS NULL OR p_purpose NOT IN ('ownership_recovery','leadership_replacement') OR p_capability IS NULL
 OR p_capability NOT IN ('institution_owner','institution_admin') OR (p_purpose='ownership_recovery' AND p_capability<>'institution_owner')
 OR original.id IS NULL OR NOT original.existence_verified OR NOT original.authority_verified
 OR (p_capability='institution_owner' AND i.owner_profile_id=actor)
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000 THEN
  RAISE EXCEPTION 'verified institution, eligible successor and specific authority review reason required' USING ERRCODE='42501'; END IF;
 IF p_details->>'institution_name' IS DISTINCT FROM i.name OR p_details->>'state' IS DISTINCT FROM original.state
 OR p_details->>'institution_type' IS DISTINCT FROM original.institution_type THEN RAISE EXCEPTION 'verified institution identity cannot change' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.institution_verification_applications WHERE applicant_profile_id=actor AND purpose<>'initial' AND created_at>now()-interval '30 days')>=3
 OR EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND student_id IS NOT NULL) THEN RAISE EXCEPTION 'authority request unavailable or limit reached' USING ERRCODE='42501'; END IF;
 IF s.id IS NULL THEN
  INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,phone,designation,status,created_by)
  VALUES(i.id,actor,btrim(p_details->>'applicant_name'),(SELECT lower(email) FROM auth.users WHERE id=auth.uid()),p_details->>'applicant_phone',btrim(p_details->>'designation'),'draft',actor)
  RETURNING * INTO s;
 END IF;
 IF NOT public.recovery_candidate_valid(s.id,i.id) THEN RAISE EXCEPTION 'verified successor identity required; invited staff must finish invitation and on-leave staff must return first' USING ERRCODE='42501'; END IF;
 INSERT INTO public.institution_verification_applications(institution_id,applicant_profile_id,registry_id,institution_name,institution_type,state,city,
 claim_key,applicant_name,account_email,applicant_phone,official_email,designation,leadership_role,signatory_name,signatory_designation,authorization_date,
 authority_statement,matched_sources,registry_confidence,purpose,target_staff_id,expected_owner_profile_id,requested_capability,request_reason,candidate_updated_at)
 VALUES(i.id,actor,i.registry_id,i.name,original.institution_type,original.state,original.city,original.claim_key,
 btrim(p_details->>'applicant_name'),s.email,p_details->>'applicant_phone',nullif(p_details->>'official_email',''),btrim(p_details->>'designation'),
 p_details->>'leadership_role',btrim(p_details->>'signatory_name'),btrim(p_details->>'signatory_designation'),(p_details->>'authorization_date')::date,
 btrim(p_details->>'authority_statement'),original.matched_sources,original.registry_confidence,p_purpose,s.id,i.owner_profile_id,p_capability,p_reason,s.updated_at) RETURNING id INTO result;
 PERFORM public.verification_event(result,'authority_review.requested',jsonb_build_object('purpose',p_purpose));
 PERFORM public.lifecycle_event(i.id,s.id,p_purpose||'.requested',jsonb_build_object('owner_profile_id',i.owner_profile_id),jsonb_build_object('application_id',result,'capability',p_capability),p_reason);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.start_staff_authority_review(uuid,text,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_staff_authority_review(uuid,text,text,jsonb,text) TO authenticated;
-- Only summaries are exposed to tenant administrators; reviewer contacts and
-- private evidence stay with the applicant and independent platform reviewer.
CREATE FUNCTION public.staff_authority_status(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.verification_actor();
 IF NOT public.is_institution_member(p_institution) THEN RAISE EXCEPTION 'institution unavailable' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'purpose',a.purpose,'status',a.status,'capability',a.requested_capability,'staff_id',a.target_staff_id,'created_at',a.created_at) ORDER BY a.created_at DESC),'[]')
 FROM public.institution_verification_applications a WHERE a.institution_id=p_institution AND a.purpose<>'initial'
 AND (public.setup_is_admin(p_institution) OR a.applicant_profile_id=public.current_profile_id()));
END $$;
REVOKE ALL ON FUNCTION public.staff_authority_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_authority_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_institution_application(p_id uuid, p_decision text, p_reason text,
  p_existence_verified boolean DEFAULT false, p_authority_verified boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications; applicant_auth uuid; evidence_ids uuid[];
BEGIN
  PERFORM public.verification_actor(p_id,true);
  PERFORM public.lock_staff_lifecycle((SELECT institution_id FROM public.institution_verification_applications WHERE id=p_id));
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF length(btrim(coalesce(p_reason,''))) < 20 OR p_decision IS NULL THEN
    RAISE EXCEPTION 'specific review reason required' USING ERRCODE = '22023';
  END IF;
  IF NOT ((a.status IN ('pending_manual_review','pending_institution_confirmation')
      AND p_decision IN ('needs_more_information','rejected','pending_institution_confirmation'))
    OR (a.status = 'pending_institution_confirmation' AND p_decision = 'approved')
    OR (a.status = 'approved' AND p_decision = 'revoked' AND a.purpose='initial')) THEN
    RAISE EXCEPTION 'invalid verification transition' USING ERRCODE = '42501';
  END IF;
  IF p_decision IN ('pending_institution_confirmation','approved') THEN
    IF EXISTS(SELECT 1 FROM unnest(ARRAY['authorization_letter','recognition_document','challenge_photo']) kind
      WHERE NOT EXISTS(SELECT 1 FROM public.institution_verification_evidence e
        WHERE e.application_id = a.id AND e.kind = kind AND e.deleted_at IS NULL AND e.retention_until > now()
          AND e.scan_state = 'clean' AND e.review_state = 'accepted' AND e.review_revision = a.revision)) THEN
      RAISE EXCEPTION 'all required evidence must be clean and accepted for this revision' USING ERRCODE = '42501';
    END IF;
    IF p_decision = 'pending_institution_confirmation' AND
      (p_existence_verified IS DISTINCT FROM true OR p_authority_verified IS DISTINCT FROM true) THEN
      RAISE EXCEPTION 'existence and authority require independent review' USING ERRCODE = '42501';
    END IF;
    IF p_decision = 'approved' THEN
      IF NOT a.existence_verified OR NOT a.authority_verified OR NOT EXISTS(
        SELECT 1 FROM public.institution_authority_confirmations WHERE application_id = a.id
          AND application_revision = a.revision AND confirmed) THEN
        RAISE EXCEPTION 'independent institution confirmation required' USING ERRCODE = '42501';
      END IF;
      SELECT auth_user_id INTO applicant_auth FROM public.profiles WHERE id = a.applicant_profile_id AND status = 'active';
      IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id = applicant_auth AND email_confirmed_at IS NOT NULL AND email = a.account_email)
        OR (SELECT count(*) FROM public.policy_versions WHERE active AND effective_at <= now()) <> 2
        OR EXISTS(SELECT 1 FROM public.policy_versions v WHERE active AND effective_at <= now()
          AND NOT EXISTS(SELECT 1 FROM public.user_policy_acceptances x WHERE x.user_id = applicant_auth AND x.policy_version_id = v.id))
        OR (a.purpose='initial' AND EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id = a.applicant_profile_id)) THEN
        RAISE EXCEPTION 'applicant identity, policies or membership changed; re-review required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF a.purpose<>'initial' AND p_decision='approved' THEN
    IF a.created_at<now()-interval '30 days' OR NOT public.recovery_candidate_valid(a.target_staff_id,a.institution_id)
      OR NOT EXISTS(SELECT 1 FROM public.staff_records WHERE id=a.target_staff_id AND updated_at=a.candidate_updated_at)
      OR NOT EXISTS(SELECT 1 FROM public.institutions i JOIN public.institution_verification_applications original ON original.id=i.verification_application_id
        WHERE i.id=a.institution_id AND i.status='active' AND i.owner_profile_id IS NOT DISTINCT FROM a.expected_owner_profile_id
         AND original.purpose='initial' AND original.status='approved' AND original.existence_verified AND original.authority_verified) THEN
      RAISE EXCEPTION 'successor, original verification or owner changed; fresh authority review required' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT array_agg(id ORDER BY id) INTO evidence_ids FROM public.institution_verification_evidence
    WHERE application_id = a.id AND review_state = 'accepted' AND review_revision = a.revision;
  UPDATE public.institution_verification_applications SET status = p_decision, reviewed_at = now(),
    reviewer = auth.uid(), decision_reason = p_reason, updated_at = now(),
    existence_verified = CASE WHEN p_decision = 'pending_institution_confirmation' THEN true
      WHEN p_decision IN ('needs_more_information','rejected','revoked') THEN false ELSE existence_verified END,
    authority_verified = CASE WHEN p_decision = 'pending_institution_confirmation' THEN true
      WHEN p_decision IN ('needs_more_information','rejected','revoked') THEN false ELSE authority_verified END,
    registry_confidence = CASE WHEN p_decision = 'approved' THEN 'verified'
      WHEN p_decision = 'rejected' THEN 'rejected' ELSE registry_confidence END
    WHERE id = a.id;
  IF p_decision='approved' AND a.purpose<>'initial' THEN
    PERFORM public.activate_reviewed_successor(a.target_staff_id,p_reason);
    IF a.requested_capability='institution_owner' THEN
      PERFORM public.apply_owner_succession(a.institution_id,a.target_staff_id,a.expected_owner_profile_id,p_reason);
    ELSE
      INSERT INTO public.staff_role_grants(institution_id,staff_id,role,valid_from,created_by,reason)
       VALUES(a.institution_id,a.target_staff_id,'institution_admin',public.setup_today(a.institution_id),public.current_profile_id(),p_reason)
       ON CONFLICT(staff_id,role) WHERE active DO NOTHING;
    END IF;
    -- Leadership metadata belongs to the new person; original representative
    -- application and the previous leader's record are never overwritten.
    UPDATE public.staff_records SET designation=a.designation,updated_at=now() WHERE id=a.target_staff_id;
  ELSIF p_decision = 'approved' THEN
    UPDATE public.institutions SET status = 'active', owner_profile_id = a.applicant_profile_id WHERE id = a.institution_id;
    INSERT INTO public.profile_institutions(profile_id,institution_id,status,activated_at)
      VALUES(a.applicant_profile_id,a.institution_id,'active',now());
    INSERT INTO public.profile_roles(profile_id,institution_id,role_code,assigned_by)
      VALUES(a.applicant_profile_id,a.institution_id,'admin',NULL);
    INSERT INTO public.institution_admin_onboarding(profile_id,institution_id) VALUES(a.applicant_profile_id,a.institution_id);
  ELSIF p_decision IN ('rejected','revoked') AND a.purpose='initial' THEN
    UPDATE public.institutions SET status = p_decision WHERE id = a.institution_id;
  END IF;
  INSERT INTO public.institution_verification_reviews(application_id,reviewer,decision,reason,evidence_references,application_revision)
    VALUES(a.id,auth.uid(),p_decision,p_reason,coalesce(evidence_ids,'{}'),a.revision);
  PERFORM public.verification_event(a.id,'application.' || p_decision);
  IF a.purpose<>'initial' THEN
    PERFORM public.lifecycle_event(a.institution_id,a.target_staff_id,a.purpose||'.'||p_decision,
     jsonb_build_object('status',a.status,'owner_profile_id',a.expected_owner_profile_id),
     jsonb_build_object('status',p_decision,'application_id',a.id,'capability',a.requested_capability),p_reason);
  END IF;
  RETURN p_decision;
END $$;


COMMIT;
