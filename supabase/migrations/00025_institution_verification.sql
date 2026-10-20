-- New institutions remain non-operational until existence AND authority are
-- independently reviewed. Existing active tenants are not retroactively changed.
BEGIN;

CREATE FUNCTION public.normalize_institution_name(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(lower(normalize(coalesce(value, ''), NFKC)), '[^[:alnum:]]+', ' ', 'g'),
      '\m(univ|universitys)\M', 'university', 'g'),
      '\m(coll|colg)\M', 'college', 'g'),
      '\m(inst|instt)\M', 'institute', 'g'),
      '\mgovt\M', 'government', 'g'),
      '\mtech\M', 'technology', 'g'),
      '\mst\M', 'saint', 'g'),
      '\m(and|the|of)\M', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

CREATE TABLE public.institution_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 2 AND 200),
  normalized_name text GENERATED ALWAYS AS (public.normalize_institution_name(canonical_name)) STORED,
  institution_type text NOT NULL CHECK (length(institution_type) BETWEEN 2 AND 100),
  aishe_code text UNIQUE,
  ugc_identifier text,
  ugc_status text,
  aicte_identifier text,
  aicte_status text,
  state text NOT NULL CHECK (length(btrim(state)) BETWEEN 2 AND 100),
  city text,
  official_website text CHECK (official_website IS NULL OR official_website ~ '^https://[^/[:space:]]+'),
  official_domain text,
  source_updated_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX institution_registry_search ON public.institution_registry(normalized_name text_pattern_ops);
CREATE INDEX institution_registry_state ON public.institution_registry(state, active);
CREATE TABLE public.institution_registry_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_id uuid NOT NULL REFERENCES public.institution_registry(id),
  source text NOT NULL CHECK (source IN ('aishe','ugc','aicte')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 150),
  source_url text NOT NULL CHECK (source_url ~ '^https://[^/[:space:]]+'),
  source_updated_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  import_sha256 text NOT NULL CHECK (import_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL,
  UNIQUE(source, external_id),
  UNIQUE(registry_id, source)
);
CREATE TABLE public.institution_verification_reviewers (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  active boolean NOT NULL DEFAULT true,
  appointed_at timestamptz NOT NULL DEFAULT now(),
  appointment_reason text NOT NULL CHECK (length(btrim(appointment_reason)) >= 10)
);

ALTER TABLE public.institutions DROP CONSTRAINT institutions_status_check;
ALTER TABLE public.institutions ADD CONSTRAINT institutions_status_check CHECK (
  status IN ('active','inactive','suspended','pending_verification','rejected','revoked'));
ALTER TABLE public.institutions ADD COLUMN registry_id uuid REFERENCES public.institution_registry(id),
  ADD COLUMN owner_profile_id uuid REFERENCES public.profiles(id),
  ADD COLUMN verification_application_id uuid,
  ADD COLUMN state text;
CREATE UNIQUE INDEX institutions_registry_claim ON public.institutions(registry_id)
  WHERE registry_id IS NOT NULL AND status NOT IN ('rejected','revoked');

CREATE TABLE public.institution_verification_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL UNIQUE REFERENCES public.institutions(id),
  applicant_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  registry_id uuid REFERENCES public.institution_registry(id),
  institution_name text NOT NULL,
  institution_type text NOT NULL,
  state text NOT NULL,
  city text,
  claimed_aishe_code text,
  claimed_website text,
  claim_key text NOT NULL,
  applicant_name text NOT NULL,
  account_email text NOT NULL,
  applicant_phone text NOT NULL,
  official_email text,
  designation text NOT NULL,
  leadership_role text NOT NULL CHECK (leadership_role IN
    ('principal','director','registrar','secretary','authorized_representative')),
  signatory_name text NOT NULL,
  signatory_designation text NOT NULL,
  authorization_date date NOT NULL,
  authority_statement text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','submitted','registry_check','needs_more_information','pending_manual_review',
     'pending_institution_confirmation','approved','rejected','revoked')),
  registry_confidence text NOT NULL DEFAULT 'needs_review' CHECK (registry_confidence IN
    ('registry_match','cross_checked','needs_review','verified','rejected')),
  matched_sources text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0,
  photo_required boolean NOT NULL DEFAULT true,
  existence_verified boolean NOT NULL DEFAULT false,
  authority_verified boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer uuid REFERENCES auth.users(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.institutions ADD CONSTRAINT institutions_verification_application_fk
  FOREIGN KEY(verification_application_id) REFERENCES public.institution_verification_applications(id);
CREATE UNIQUE INDEX verification_applicant_open ON public.institution_verification_applications(applicant_profile_id)
  WHERE status NOT IN ('rejected','revoked');
CREATE UNIQUE INDEX verification_name_claim ON public.institution_verification_applications(claim_key)
  WHERE status NOT IN ('rejected','revoked');
CREATE INDEX verification_queue ON public.institution_verification_applications(status, submitted_at);

CREATE TABLE public.institution_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  challenge text NOT NULL UNIQUE DEFAULT ('ATTENDAI VERIFY ' || upper(left(replace(gen_random_uuid()::text,'-',''),10))),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at timestamptz,
  revoked_at timestamptz,
  UNIQUE(id, application_id)
);
CREATE TABLE public.institution_verification_evidence (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  institution_id uuid NOT NULL REFERENCES public.institutions(id),
  kind text NOT NULL CHECK (kind IN ('authorization_letter','recognition_document','challenge_photo')),
  object_path text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  challenge_id uuid,
  scan_state text NOT NULL DEFAULT 'quarantined' CHECK (scan_state IN ('quarantined','clean','rejected')),
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','accepted','rejected')),
  review_revision integer,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL,
  deleted_at timestamptz,
  storage_deleted_at timestamptz,
  FOREIGN KEY(challenge_id, application_id) REFERENCES public.institution_verification_challenges(id, application_id),
  CHECK ((kind = 'challenge_photo') = (challenge_id IS NOT NULL)),
  CHECK (kind <> 'challenge_photo' OR mime_type IN ('image/jpeg','image/png'))
);
CREATE UNIQUE INDEX verification_photo_no_reuse ON public.institution_verification_evidence(sha256)
  WHERE kind = 'challenge_photo';
CREATE UNIQUE INDEX verification_challenge_once ON public.institution_verification_evidence(challenge_id)
  WHERE challenge_id IS NOT NULL;
CREATE INDEX verification_evidence_scope ON public.institution_verification_evidence(application_id, kind);
CREATE INDEX verification_evidence_retention ON public.institution_verification_evidence(retention_until)
  WHERE storage_deleted_at IS NULL;

CREATE TABLE public.institution_official_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  contact_value text NOT NULL CHECK (length(btrim(contact_value)) BETWEEN 5 AND 254),
  source_kind text NOT NULL CHECK (source_kind IN ('registry','official_website','official_directory')),
  source_url text NOT NULL CHECK (source_url ~ '^https://[^/[:space:]]+'),
  independence_note text NOT NULL CHECK (length(btrim(independence_note)) >= 20),
  sourced_by uuid NOT NULL REFERENCES auth.users(id),
  sourced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, application_id)
);
CREATE TABLE public.institution_authority_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  contact_id uuid NOT NULL,
  application_revision integer NOT NULL,
  confirmation_method text NOT NULL CHECK (confirmation_method IN ('manual_official_email','manual_official_phone')),
  confirmed_by text NOT NULL CHECK (length(btrim(confirmed_by)) >= 2),
  confirmer_designation text NOT NULL CHECK (length(btrim(confirmer_designation)) >= 2),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed boolean NOT NULL,
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) >= 10),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  FOREIGN KEY(contact_id, application_id) REFERENCES public.institution_official_contacts(id, application_id),
  UNIQUE(contact_id, evidence_reference)
);
CREATE TABLE public.institution_verification_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  reviewer uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  evidence_references uuid[] NOT NULL DEFAULT '{}',
  application_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.institution_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.institution_verification_applications(id),
  actor uuid REFERENCES auth.users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.is_verification_reviewer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.institution_verification_reviewers r
    JOIN auth.users u ON u.id = r.auth_user_id
    JOIN public.profiles p ON p.auth_user_id = u.id
    WHERE r.auth_user_id = auth.uid() AND r.active AND u.email_confirmed_at IS NOT NULL AND p.status = 'active');
$$;
CREATE FUNCTION public.can_access_verification_application(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.institution_verification_applications a
    WHERE a.id = p_id AND (a.applicant_profile_id = public.current_profile_id() OR public.is_verification_reviewer()));
$$;
CREATE FUNCTION public.verification_actor(p_application uuid DEFAULT NULL, p_reviewer boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE profile_id uuid;
BEGIN
  SELECT p.id INTO profile_id FROM public.profiles p JOIN auth.users u ON u.id = p.auth_user_id
    WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL AND p.status = 'active';
  IF profile_id IS NULL OR NOT public.has_current_policy_acceptance(auth.uid()) THEN
    RAISE EXCEPTION 'verified identity and current policies required' USING ERRCODE = '42501';
  END IF;
  IF p_reviewer AND (NOT public.is_verification_reviewer() OR EXISTS (
    SELECT 1 FROM public.institution_verification_applications WHERE id = p_application AND applicant_profile_id = profile_id)) THEN
    RAISE EXCEPTION 'independent platform reviewer required' USING ERRCODE = '42501';
  END IF;
  IF p_application IS NOT NULL AND NOT p_reviewer AND NOT EXISTS (
    SELECT 1 FROM public.institution_verification_applications WHERE id = p_application AND applicant_profile_id = profile_id) THEN
    RAISE EXCEPTION 'application unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN profile_id;
END $$;
CREATE FUNCTION public.verification_event(p_id uuid, p_action text, p_details jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.institution_verification_events(application_id, actor, action, details)
  VALUES (p_id, auth.uid(), p_action, p_details);
$$;

-- Direct table writes are never an applicant/reviewer API.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['institution_registry','institution_registry_sources','institution_verification_reviewers',
    'institution_verification_applications','institution_verification_challenges','institution_verification_evidence',
    'institution_official_contacts','institution_authority_confirmations','institution_verification_reviews',
    'institution_verification_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
CREATE POLICY verification_application_read ON public.institution_verification_applications
  FOR SELECT TO authenticated USING (applicant_profile_id = public.current_profile_id() OR public.is_verification_reviewer());
CREATE POLICY verification_evidence_read ON public.institution_verification_evidence
  FOR SELECT TO authenticated USING (public.can_access_verification_application(application_id));
CREATE POLICY verification_challenge_read ON public.institution_verification_challenges
  FOR SELECT TO authenticated USING (public.can_access_verification_application(application_id));
CREATE POLICY verification_contact_read ON public.institution_official_contacts
  FOR SELECT TO authenticated USING (public.is_verification_reviewer());
CREATE POLICY verification_confirmation_read ON public.institution_authority_confirmations
  FOR SELECT TO authenticated USING (public.is_verification_reviewer());
CREATE POLICY verification_review_read ON public.institution_verification_reviews
  FOR SELECT TO authenticated USING (public.is_verification_reviewer());
CREATE POLICY verification_event_read ON public.institution_verification_events
  FOR SELECT TO authenticated USING (public.is_verification_reviewer());
GRANT SELECT ON public.institution_verification_applications, public.institution_verification_evidence,
  public.institution_verification_challenges, public.institution_official_contacts,
  public.institution_authority_confirmations, public.institution_verification_reviews,
  public.institution_verification_events TO authenticated;

CREATE FUNCTION public.search_institution_registry(p_query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE q text := public.normalize_institution_name(left(p_query, 100)); result jsonb;
BEGIN
  IF length(q) < 3 THEN RETURN '[]'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(matches)), '[]') INTO result FROM (
    SELECT r.id, r.canonical_name, r.institution_type, r.state, r.city, r.aishe_code,
      r.ugc_identifier, r.ugc_status, r.aicte_identifier, r.aicte_status, r.official_website,
      r.source_updated_at,
      ARRAY(SELECT s.source FROM public.institution_registry_sources s WHERE s.registry_id = r.id ORDER BY s.source) AS sources
    FROM public.institution_registry r WHERE r.active
      AND (r.normalized_name LIKE '%' || replace(replace(q, '%', ''), '_', '') || '%'
        OR lower(r.aishe_code) = lower(btrim(p_query)))
    ORDER BY (r.normalized_name = q) DESC, r.canonical_name, r.state LIMIT 20
  ) matches;
  RETURN result;
END $$;

CREATE FUNCTION public.validate_verification_details(p jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF jsonb_typeof(p) <> 'object'
    OR length(btrim(coalesce(p->>'institution_name',''))) NOT BETWEEN 2 AND 200
    OR length(btrim(coalesce(p->>'institution_type',''))) NOT BETWEEN 2 AND 100
    OR length(btrim(coalesce(p->>'state',''))) NOT BETWEEN 2 AND 100
    OR length(btrim(coalesce(p->>'applicant_name',''))) NOT BETWEEN 2 AND 120
    OR coalesce(p->>'applicant_phone','') !~ '^\+?[0-9 ()-]{7,25}$'
    OR length(btrim(coalesce(p->>'designation',''))) NOT BETWEEN 2 AND 120
    OR coalesce(p->>'leadership_role','') NOT IN ('principal','director','registrar','secretary','authorized_representative')
    OR length(btrim(coalesce(p->>'signatory_name',''))) NOT BETWEEN 2 AND 120
    OR length(btrim(coalesce(p->>'signatory_designation',''))) NOT BETWEEN 2 AND 120
    OR coalesce(p->>'authorization_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    OR (p->>'authorization_date')::date > CURRENT_DATE
    OR length(btrim(coalesce(p->>'authority_statement',''))) NOT BETWEEN 20 AND 2000
    OR (nullif(p->>'official_email','') IS NOT NULL AND
      (length(p->>'official_email') > 254 OR p->>'official_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    OR (nullif(p->>'claimed_website','') IS NOT NULL AND p->>'claimed_website' !~ '^https://[^/[:space:]]+')
    OR length(coalesce(p->>'city','')) > 120 OR length(coalesce(p->>'claimed_aishe_code','')) > 100 THEN
    RAISE EXCEPTION 'registration details are incomplete or invalid' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE FUNCTION public.start_institution_verification(p_registry_id uuid, p_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid; app_id uuid := gen_random_uuid(); institution_id uuid := gen_random_uuid();
  r public.institution_registry; name_value text; state_value text; type_value text; city_value text; sources text[];
BEGIN
  actor_id := public.verification_actor();
  PERFORM 1 FROM public.profiles WHERE id = actor_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id = actor_id)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE id = actor_id AND student_id IS NOT NULL) THEN
    RAISE EXCEPTION 'existing members must use the authorized administrator recovery process' USING ERRCODE = '42501';
  END IF;
  PERFORM public.validate_verification_details(p_details);
  IF p_registry_id IS NOT NULL THEN
    SELECT * INTO r FROM public.institution_registry WHERE id = p_registry_id AND active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'registry entry unavailable' USING ERRCODE = '22023'; END IF;
    name_value := r.canonical_name; state_value := r.state; type_value := r.institution_type; city_value := r.city;
    SELECT array_agg(source ORDER BY source) INTO sources FROM public.institution_registry_sources WHERE registry_id = r.id;
  ELSE
    name_value := btrim(p_details->>'institution_name'); state_value := btrim(p_details->>'state');
    type_value := btrim(p_details->>'institution_type'); city_value := nullif(btrim(p_details->>'city'),'');
  END IF;
  IF EXISTS(SELECT 1 FROM public.institutions i WHERE i.status = 'active' AND
    ((p_registry_id IS NOT NULL AND i.registry_id = p_registry_id) OR
      (public.normalize_institution_name(i.name) = public.normalize_institution_name(name_value)
        AND (i.state IS NULL OR public.normalize_institution_name(i.state) = public.normalize_institution_name(state_value))))) THEN
    RAISE EXCEPTION 'INSTITUTION_ALREADY_REGISTERED: request authorized administrator recovery' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.institutions(id, name, code, status, registry_id, state)
    VALUES(institution_id, name_value, 'verification-' || app_id::text, 'pending_verification', p_registry_id, state_value);
  INSERT INTO public.institution_verification_applications(
    id, institution_id, applicant_profile_id, registry_id, institution_name, institution_type, state, city,
    claimed_aishe_code, claimed_website, claim_key, applicant_name, account_email, applicant_phone, official_email,
    designation, leadership_role, signatory_name, signatory_designation, authorization_date, authority_statement,
    registry_confidence, matched_sources)
  VALUES(app_id, institution_id, actor_id, p_registry_id, name_value, type_value, state_value, city_value,
    nullif(p_details->>'claimed_aishe_code',''), nullif(p_details->>'claimed_website',''),
    public.normalize_institution_name(name_value) || '|' || public.normalize_institution_name(state_value),
    btrim(p_details->>'applicant_name'), (SELECT email FROM auth.users WHERE id = auth.uid()),
    p_details->>'applicant_phone', nullif(lower(p_details->>'official_email'),''),
    btrim(p_details->>'designation'), p_details->>'leadership_role', btrim(p_details->>'signatory_name'),
    btrim(p_details->>'signatory_designation'), (p_details->>'authorization_date')::date, btrim(p_details->>'authority_statement'),
    CASE WHEN cardinality(sources) >= 2 THEN 'cross_checked' WHEN cardinality(sources) = 1 THEN 'registry_match' ELSE 'needs_review' END,
    coalesce(sources, '{}'));
  UPDATE public.institutions SET verification_application_id = app_id WHERE id = institution_id;
  PERFORM public.verification_event(app_id, 'draft.created', jsonb_build_object('registry_id', p_registry_id));
  RETURN app_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'INSTITUTION_ALREADY_REGISTERED_OR_CLAIMED: continue your application or request authorized administrator recovery' USING ERRCODE = '23505';
END $$;

CREATE FUNCTION public.save_institution_verification(p_id uuid, p_details jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications;
BEGIN
  PERFORM public.verification_actor(p_id);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF a.status NOT IN ('draft','needs_more_information') THEN RAISE EXCEPTION 'application is not editable' USING ERRCODE = '42501'; END IF;
  PERFORM public.validate_verification_details(p_details);
  -- Institution identity is locked after the draft claim; new identity requires a new reviewed claim.
  IF p_details->>'institution_name' <> a.institution_name OR p_details->>'state' <> a.state THEN
    RAISE EXCEPTION 'institution identity cannot be changed on an existing claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.institution_verification_applications SET
    account_email = (SELECT email FROM auth.users WHERE id = auth.uid()),
    applicant_name = btrim(p_details->>'applicant_name'), applicant_phone = p_details->>'applicant_phone',
    official_email = nullif(lower(p_details->>'official_email'),''), designation = btrim(p_details->>'designation'),
    leadership_role = p_details->>'leadership_role', signatory_name = btrim(p_details->>'signatory_name'),
    signatory_designation = btrim(p_details->>'signatory_designation'), authorization_date = (p_details->>'authorization_date')::date,
    authority_statement = btrim(p_details->>'authority_statement'), claimed_aishe_code = nullif(p_details->>'claimed_aishe_code',''),
    claimed_website = nullif(p_details->>'claimed_website',''), existence_verified = false, authority_verified = false,
    revision = revision + 1, updated_at = now() WHERE id = p_id;
  PERFORM public.verification_event(p_id, 'draft.updated');
END $$;

CREATE FUNCTION public.issue_institution_verification_challenge(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications; c public.institution_verification_challenges;
BEGIN
  PERFORM public.verification_actor(p_id);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF a.status NOT IN ('draft','needs_more_information') THEN RAISE EXCEPTION 'application is not editable' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.institution_verification_challenges WHERE application_id = p_id AND issued_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'challenge request limit reached' USING ERRCODE = '22023';
  END IF;
  UPDATE public.institution_verification_challenges SET revoked_at = now()
    WHERE application_id = p_id AND consumed_at IS NULL AND revoked_at IS NULL;
  INSERT INTO public.institution_verification_challenges(application_id) VALUES(p_id) RETURNING * INTO c;
  PERFORM public.verification_event(p_id, 'challenge.issued', jsonb_build_object('challenge_id', c.id));
  RETURN jsonb_build_object('id', c.id, 'challenge', c.challenge, 'expires_at', c.expires_at);
END $$;

CREATE FUNCTION public.verification_upload_context(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications;
BEGIN
  PERFORM public.verification_actor(p_id);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id;
  IF a.status NOT IN ('draft','needs_more_information') THEN RAISE EXCEPTION 'application is not editable' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('id', a.id, 'institution_id', a.institution_id);
END $$;

-- Called only by the authenticated server upload proxy, after byte validation
-- and a successful private storage write. Client-supplied metadata is not trusted.
CREATE FUNCTION public.register_institution_verification_evidence(
  p_actor uuid, p_application uuid, p_id uuid, p_kind text, p_path text, p_name text,
  p_mime text, p_size bigint, p_sha256 text, p_challenge uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications; c public.institution_verification_challenges;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server upload proxy required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_application FOR UPDATE;
  IF NOT FOUND OR a.status NOT IN ('draft','needs_more_information') OR NOT EXISTS(
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.auth_user_id
    WHERE p.id = a.applicant_profile_id AND u.id = p_actor AND u.email_confirmed_at IS NOT NULL AND p.status = 'active') THEN
    RAISE EXCEPTION 'upload unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_path <> (a.institution_id::text || '/' || a.id::text || '/' || p_id::text ||
      (CASE p_mime WHEN 'application/pdf' THEN '.pdf' WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '' END))
    OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id = 'institution-verification'
      AND name = p_path AND (metadata->>'size')::bigint = p_size AND metadata->>'mimetype' = p_mime)
    OR length(p_name) NOT BETWEEN 1 AND 150
    OR (SELECT count(*) FROM public.institution_verification_evidence WHERE application_id = a.id AND deleted_at IS NULL) >= 20
    OR (SELECT count(*) FROM public.institution_verification_evidence WHERE application_id = a.id) >= 100
    OR (SELECT count(*) FROM public.institution_verification_evidence WHERE application_id = a.id AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'invalid evidence object' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'challenge_photo' THEN
    SELECT * INTO c FROM public.institution_verification_challenges WHERE id = p_challenge AND application_id = a.id FOR UPDATE;
    IF NOT FOUND OR c.consumed_at IS NOT NULL OR c.revoked_at IS NOT NULL OR c.expires_at <= now() THEN
      RAISE EXCEPTION 'photo challenge expired or already used' USING ERRCODE = '22023';
    END IF;
    UPDATE public.institution_verification_challenges SET consumed_at = now() WHERE id = c.id;
  END IF;
  INSERT INTO public.institution_verification_evidence(
    id, application_id, institution_id, kind, object_path, original_name, mime_type, size_bytes, sha256, challenge_id, retention_until)
  VALUES(p_id, a.id, a.institution_id, p_kind, p_path, p_name, p_mime, p_size, p_sha256, p_challenge,
    now() + CASE WHEN p_kind = 'challenge_photo' THEN interval '30 days' ELSE interval '90 days' END);
  UPDATE public.institution_verification_applications SET revision = revision + 1,
    existence_verified = false, authority_verified = false, updated_at = now() WHERE id = a.id;
  INSERT INTO public.institution_verification_events(application_id,actor,action,details)
    VALUES(a.id,p_actor,'evidence.uploaded',jsonb_build_object('evidence_id',p_id,'kind',p_kind));
  RETURN p_id;
END $$;

CREATE FUNCTION public.submit_institution_verification(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications;
BEGIN
  PERFORM public.verification_actor(p_id);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF a.status NOT IN ('draft','needs_more_information') THEN RAISE EXCEPTION 'application is not editable' USING ERRCODE = '42501'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['authorization_letter','recognition_document','challenge_photo']) kind
    WHERE NOT EXISTS(SELECT 1 FROM public.institution_verification_evidence e
      WHERE e.application_id = a.id AND e.kind = kind AND e.deleted_at IS NULL AND e.retention_until > now())) THEN
    RAISE EXCEPTION 'authorization letter, recognition document and fresh challenge photo are required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.institution_verification_applications SET status = 'submitted', submitted_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.verification_event(p_id, 'application.submitted');
  UPDATE public.institution_verification_applications SET status = 'registry_check' WHERE id = p_id;
  PERFORM public.verification_event(p_id, 'registry.checked', jsonb_build_object('confidence',a.registry_confidence,'sources',a.matched_sources));
  UPDATE public.institution_verification_applications SET status = 'pending_manual_review' WHERE id = p_id;
  PERFORM public.verification_event(p_id, 'manual_review.pending');
  RETURN 'pending_manual_review';
END $$;

CREATE FUNCTION public.review_institution_evidence(p_id uuid, p_scan text, p_accept boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.institution_verification_evidence; a public.institution_verification_applications;
BEGIN
  SELECT * INTO e FROM public.institution_verification_evidence WHERE id = p_id;
  PERFORM public.verification_actor(e.application_id, true);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = e.application_id FOR UPDATE;
  IF a.status NOT IN ('pending_manual_review','pending_institution_confirmation')
    OR e.deleted_at IS NOT NULL OR e.retention_until <= now() OR p_scan NOT IN ('clean','rejected')
    OR p_scan IS NULL OR p_accept IS NULL OR length(btrim(coalesce(p_reason,''))) < 20
    OR (p_accept AND p_scan <> 'clean') THEN RAISE EXCEPTION 'invalid evidence review' USING ERRCODE = '22023'; END IF;
  UPDATE public.institution_verification_evidence SET scan_state = p_scan,
    review_state = CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,
    review_revision = a.revision, reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_id;
  INSERT INTO public.institution_verification_reviews(application_id,reviewer,decision,reason,evidence_references,application_revision)
    VALUES(a.id,auth.uid(),'evidence.' || CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END,p_reason,ARRAY[p_id],a.revision);
  PERFORM public.verification_event(a.id, 'evidence.reviewed', jsonb_build_object('evidence_id',p_id));
END $$;

CREATE FUNCTION public.record_institution_official_contact(p_id uuid, p_kind text, p_value text,
  p_source_kind text, p_source_url text, p_independence_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE contact_id uuid; a public.institution_verification_applications;
BEGIN
  PERFORM public.verification_actor(p_id, true);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF a.status NOT IN ('pending_manual_review','pending_institution_confirmation') THEN
    RAISE EXCEPTION 'application is not under review' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'email' AND p_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_kind = 'phone' AND p_value !~ '^\+?[0-9 ()-]{7,25}$' THEN
    RAISE EXCEPTION 'invalid contact' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.institution_official_contacts(application_id,kind,contact_value,source_kind,source_url,independence_note,sourced_by)
    VALUES(p_id,p_kind,p_value,p_source_kind,p_source_url,p_independence_note,auth.uid()) RETURNING id INTO contact_id;
  PERFORM public.verification_event(p_id,'official_contact.sourced',jsonb_build_object('contact_id',contact_id));
  RETURN contact_id;
END $$;

CREATE FUNCTION public.record_institution_authority_confirmation(p_id uuid, p_contact uuid, p_method text,
  p_confirmer text, p_designation text, p_confirmed boolean, p_reference text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications; c public.institution_official_contacts; confirmation_id uuid;
BEGIN
  PERFORM public.verification_actor(p_id,true);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  SELECT * INTO c FROM public.institution_official_contacts WHERE id = p_contact AND application_id = p_id;
  IF a.status <> 'pending_institution_confirmation' OR c.id IS NULL
    OR (c.kind = 'email' AND p_method <> 'manual_official_email')
    OR (c.kind = 'phone' AND p_method <> 'manual_official_phone') THEN
    RAISE EXCEPTION 'independently sourced official contact required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.institution_authority_confirmations(application_id,contact_id,application_revision,
    confirmation_method,confirmed_by,confirmer_designation,confirmed,evidence_reference,recorded_by)
  VALUES(p_id,p_contact,a.revision,p_method,p_confirmer,p_designation,p_confirmed,p_reference,auth.uid())
  RETURNING id INTO confirmation_id;
  PERFORM public.verification_event(p_id,'authority.confirmed',jsonb_build_object('confirmation_id',confirmation_id,'confirmed',p_confirmed));
  RETURN confirmation_id;
END $$;

CREATE FUNCTION public.review_institution_application(p_id uuid, p_decision text, p_reason text,
  p_existence_verified boolean DEFAULT false, p_authority_verified boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.institution_verification_applications; applicant_auth uuid; evidence_ids uuid[];
BEGIN
  PERFORM public.verification_actor(p_id,true);
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = p_id FOR UPDATE;
  IF length(btrim(coalesce(p_reason,''))) < 20 OR p_decision IS NULL THEN
    RAISE EXCEPTION 'specific review reason required' USING ERRCODE = '22023';
  END IF;
  IF NOT ((a.status IN ('pending_manual_review','pending_institution_confirmation')
      AND p_decision IN ('needs_more_information','rejected','pending_institution_confirmation'))
    OR (a.status = 'pending_institution_confirmation' AND p_decision = 'approved')
    OR (a.status = 'approved' AND p_decision = 'revoked')) THEN
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
        OR EXISTS(SELECT 1 FROM public.profile_institutions WHERE profile_id = a.applicant_profile_id) THEN
        RAISE EXCEPTION 'applicant identity, policies or membership changed; re-review required' USING ERRCODE = '42501';
      END IF;
    END IF;
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
  IF p_decision = 'approved' THEN
    UPDATE public.institutions SET status = 'active', owner_profile_id = a.applicant_profile_id WHERE id = a.institution_id;
    INSERT INTO public.profile_institutions(profile_id,institution_id,status,activated_at)
      VALUES(a.applicant_profile_id,a.institution_id,'active',now());
    INSERT INTO public.profile_roles(profile_id,institution_id,role_code,assigned_by)
      VALUES(a.applicant_profile_id,a.institution_id,'admin',NULL);
    INSERT INTO public.institution_admin_onboarding(profile_id,institution_id) VALUES(a.applicant_profile_id,a.institution_id);
  ELSIF p_decision IN ('rejected','revoked') THEN
    UPDATE public.institutions SET status = p_decision WHERE id = a.institution_id;
  END IF;
  INSERT INTO public.institution_verification_reviews(application_id,reviewer,decision,reason,evidence_references,application_revision)
    VALUES(a.id,auth.uid(),p_decision,p_reason,coalesce(evidence_ids,'{}'),a.revision);
  PERFORM public.verification_event(a.id,'application.' || p_decision);
  RETURN p_decision;
END $$;

-- Even trusted maintenance code cannot activate a pending verification claim
-- without the atomic approval transaction; clients have no institution write policy.
CREATE FUNCTION public.guard_institution_verification_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.verification_application_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.institution_verification_applications a WHERE a.id = NEW.verification_application_id
      AND a.institution_id = NEW.id AND a.status = 'approved' AND a.existence_verified AND a.authority_verified) THEN
    RAISE EXCEPTION 'institution verification approval required' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.verification_application_id IS NOT NULL AND
    NEW.verification_application_id IS DISTINCT FROM OLD.verification_application_id THEN
    RAISE EXCEPTION 'verification claim cannot be detached' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER institution_verification_activation BEFORE INSERT OR UPDATE ON public.institutions
  FOR EACH ROW EXECUTE FUNCTION public.guard_institution_verification_activation();

-- Close both the public legacy RPC and its renamed policy-wrapper implementation.
CREATE OR REPLACE FUNCTION public.provision_my_new_institution()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'institution verification approval is required' USING ERRCODE = '42501'; END $$;
CREATE OR REPLACE FUNCTION public.provision_my_new_institution_after_policy()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'legacy institution provisioning is disabled' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.provision_my_new_institution_after_policy() FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('institution-verification','institution-verification',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png'];
-- A restrictive policy also defeats unrelated broad storage policies. All
-- uploads/downloads go through the audited authenticated server proxy.
CREATE POLICY institution_verification_private_objects ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon,authenticated USING(bucket_id <> 'institution-verification')
  WITH CHECK(bucket_id <> 'institution-verification');
CREATE FUNCTION public.guard_verification_bucket()
RETURNS trigger LANGUAGE plpgsql SET search_path = public,pg_temp AS $$
BEGIN
  IF NEW.id = 'institution-verification' AND (NEW.public IS DISTINCT FROM false
    OR NEW.file_size_limit IS NULL OR NEW.file_size_limit <= 0 OR NEW.file_size_limit > 5242880
    OR NEW.allowed_mime_types IS NULL OR NOT NEW.allowed_mime_types <@ ARRAY['application/pdf','image/jpeg','image/png']::text[]) THEN
    RAISE EXCEPTION 'verification storage must remain private and restricted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verification_bucket_private BEFORE INSERT OR UPDATE ON storage.buckets
  FOR EACH ROW EXECUTE FUNCTION public.guard_verification_bucket();

CREATE FUNCTION public.access_institution_verification_evidence(p_id uuid, p_delete boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE e public.institution_verification_evidence; a public.institution_verification_applications;
BEGIN
  IF p_delete IS NULL THEN RAISE EXCEPTION 'explicit evidence action required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM public.institution_verification_evidence WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'evidence unavailable' USING ERRCODE = '42501'; END IF;
  IF public.is_verification_reviewer() THEN PERFORM public.verification_actor(e.application_id,true);
  ELSE PERFORM public.verification_actor(e.application_id); END IF;
  SELECT * INTO a FROM public.institution_verification_applications WHERE id = e.application_id FOR UPDATE;
  SELECT * INTO e FROM public.institution_verification_evidence WHERE id = p_id FOR UPDATE;
  IF NOT p_delete AND (e.deleted_at IS NOT NULL OR e.retention_until <= now()) THEN
    RAISE EXCEPTION 'evidence expired or deleted' USING ERRCODE = '42501';
  END IF;
  IF p_delete THEN
    IF NOT public.is_verification_reviewer() AND a.status NOT IN ('draft','needs_more_information','rejected','revoked') THEN
      RAISE EXCEPTION 'submitted evidence cannot be changed during review' USING ERRCODE = '42501';
    END IF;
    UPDATE public.institution_verification_evidence SET deleted_at = coalesce(deleted_at,now()) WHERE id = p_id;
    IF a.status IN ('draft','needs_more_information') THEN
      UPDATE public.institution_verification_applications SET revision = revision + 1,
        existence_verified = false, authority_verified = false WHERE id = a.id;
    END IF;
  END IF;
  PERFORM public.verification_event(a.id, CASE WHEN p_delete THEN 'evidence.deletion_requested' ELSE 'evidence.accessed' END,
    jsonb_build_object('evidence_id',e.id));
  RETURN jsonb_build_object('object_path',e.object_path,'original_name',e.original_name,'mime_type',e.mime_type,'id',e.id);
END $$;
CREATE FUNCTION public.finish_verification_evidence_deletion(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public,pg_temp AS $$
DECLARE e public.institution_verification_evidence;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'retention worker required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.institution_verification_evidence WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (e.deleted_at IS NULL AND e.retention_until > now())
    OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id = 'institution-verification' AND name = e.object_path) THEN
    RAISE EXCEPTION 'physical deletion not complete or retention not due' USING ERRCODE = '42501';
  END IF;
  UPDATE public.institution_verification_evidence SET deleted_at = coalesce(deleted_at,now()), storage_deleted_at = now() WHERE id = p_id;
  PERFORM public.verification_event(e.application_id,'evidence.deleted',jsonb_build_object('evidence_id',p_id));
END $$;

-- Grant a deliberately small RPC API; internal SECURITY DEFINER helpers are not callable.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('normalize_institution_name','is_verification_reviewer','can_access_verification_application','verification_actor',
      'verification_event','search_institution_registry','validate_verification_details','start_institution_verification',
      'save_institution_verification','issue_institution_verification_challenge','verification_upload_context',
      'register_institution_verification_evidence','submit_institution_verification','review_institution_evidence',
      'record_institution_official_contact','record_institution_authority_confirmation','review_institution_application',
      'guard_institution_verification_activation','guard_verification_bucket','access_institution_verification_evidence',
      'finish_verification_evidence_deletion') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role', f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.normalize_institution_name(text), public.search_institution_registry(text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.is_verification_reviewer(), public.can_access_verification_application(uuid),
  public.start_institution_verification(uuid,jsonb), public.save_institution_verification(uuid,jsonb),
  public.issue_institution_verification_challenge(uuid), public.verification_upload_context(uuid),
  public.submit_institution_verification(uuid), public.review_institution_evidence(uuid,text,boolean,text),
  public.record_institution_official_contact(uuid,text,text,text,text,text),
  public.record_institution_authority_confirmation(uuid,uuid,text,text,text,boolean,text),
  public.review_institution_application(uuid,text,text,boolean,boolean),
  public.access_institution_verification_evidence(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_institution_verification_evidence(uuid,uuid,uuid,text,text,text,text,bigint,text,uuid),
  public.finish_verification_evidence_deletion(uuid) TO service_role;

COMMIT;
