-- Phase 2A: institution setup, descriptive staff directory, independent roles
-- and dated academic responsibilities. No owner-transfer or staff-exit lifecycle.
BEGIN;
CREATE TABLE public.institution_settings (
  institution_id uuid PRIMARY KEY REFERENCES public.institutions(id),
  official_address text NOT NULL DEFAULT '' CHECK(length(official_address)<=2000),
  city text NOT NULL DEFAULT '' CHECK(length(city)<=120),
  state text NOT NULL DEFAULT '' CHECK(length(state)<=120),
  institution_type text NOT NULL DEFAULT '' CHECK(length(institution_type)<=100),
  academic_year text NOT NULL DEFAULT '' CHECK(length(academic_year)<=80),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  official_email text NOT NULL DEFAULT '', official_phone text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '', brand_name text NOT NULL DEFAULT '' CHECK(length(brand_name)<=120),
  brand_color text NOT NULL DEFAULT '#2563eb' CHECK(brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_bytes bytea CHECK(octet_length(logo_bytes)<=262144),
  logo_mime text CHECK(logo_mime IN ('image/png','image/jpeg')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((logo_bytes IS NULL)=(logo_mime IS NULL))
);
CREATE TABLE public.academic_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
  code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institution_id,id)
);
CREATE UNIQUE INDEX academic_department_code ON public.academic_departments(institution_id,lower(code));
CREATE TABLE public.academic_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  department_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
  code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(institution_id,id), FOREIGN KEY(institution_id,department_id) REFERENCES public.academic_departments(institution_id,id)
);
CREATE UNIQUE INDEX academic_program_code ON public.academic_programs(institution_id,lower(code));
CREATE TABLE public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  program_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  academic_year text NOT NULL CHECK(length(btrim(academic_year)) BETWEEN 2 AND 80),
  term_kind text NOT NULL CHECK(term_kind IN ('year','semester','term')),
  year_number integer CHECK(year_number BETWEEN 1 AND 30),
  starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(institution_id,id), UNIQUE(institution_id,program_id,academic_year,name),
  FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id)
);
CREATE TABLE public.academic_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  program_id uuid NOT NULL, term_id uuid NOT NULL, class_id uuid NOT NULL UNIQUE,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(institution_id,id), UNIQUE(institution_id,term_id,name),
  FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id),
  FOREIGN KEY(institution_id,term_id) REFERENCES public.academic_terms(institution_id,id),
  FOREIGN KEY(institution_id,class_id) REFERENCES public.classes(institution_id,id)
);
CREATE TABLE public.academic_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  program_id uuid NOT NULL, name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
  code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(institution_id,id),
  FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id)
);
CREATE UNIQUE INDEX academic_subject_code ON public.academic_subjects(institution_id,program_id,lower(code));
CREATE TABLE public.staff_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  profile_id uuid REFERENCES public.profiles(id),
  legacy_class_assignments boolean NOT NULL DEFAULT false,
  full_name text NOT NULL CHECK(length(btrim(full_name)) BETWEEN 2 AND 120),
  email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text NOT NULL DEFAULT '' CHECK(phone='' OR phone ~ '^\+?[0-9 ()-]{7,25}$'),
  staff_code text CHECK(length(btrim(staff_code)) BETWEEN 1 AND 80),
  primary_department_id uuid, designation text NOT NULL CHECK(length(btrim(designation)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','invited','active')),
  created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(institution_id,id), UNIQUE(institution_id,email),
  UNIQUE(institution_id,profile_id),
  FOREIGN KEY(institution_id,primary_department_id) REFERENCES public.academic_departments(institution_id,id)
);
CREATE UNIQUE INDEX staff_code_unique ON public.staff_records(institution_id,lower(staff_code)) WHERE staff_code IS NOT NULL;
CREATE TABLE public.staff_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL, staff_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('institution_admin','faculty','class_incharge','hod','coordinator','staff')),
  valid_from date NOT NULL, valid_until date CHECK(valid_until>=valid_from),
  active boolean NOT NULL DEFAULT true, closed_at timestamptz,
  reason text NOT NULL CHECK(length(btrim(reason))>=10),
  created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(institution_id,staff_id) REFERENCES public.staff_records(institution_id,id),
  CHECK(active=(closed_at IS NULL))
);
CREATE UNIQUE INDEX staff_current_role ON public.staff_role_grants(staff_id,role) WHERE active;
CREATE TABLE public.staff_responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL, staff_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('department_member','teaching','class_incharge','hod','coordinator')),
  department_id uuid NOT NULL, program_id uuid, term_id uuid, section_id uuid, subject_id uuid,
  academic_year text NOT NULL DEFAULT '' CHECK(length(academic_year)<=80),
  effective_from date NOT NULL, effective_until date NOT NULL CHECK(effective_until>=effective_from),
  active boolean NOT NULL DEFAULT true, closed_at timestamptz,
  reason text NOT NULL CHECK(length(btrim(reason))>=10),
  created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(institution_id,staff_id) REFERENCES public.staff_records(institution_id,id),
  FOREIGN KEY(institution_id,department_id) REFERENCES public.academic_departments(institution_id,id),
  FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id),
  FOREIGN KEY(institution_id,term_id) REFERENCES public.academic_terms(institution_id,id),
  FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id),
  FOREIGN KEY(institution_id,subject_id) REFERENCES public.academic_subjects(institution_id,id),
  CHECK(active=(closed_at IS NULL))
);
CREATE INDEX staff_responsibility_scope ON public.staff_responsibilities(staff_id,kind,effective_from,effective_until) WHERE active;
CREATE UNIQUE INDEX staff_class_incharge_current ON public.staff_responsibilities(section_id) WHERE kind='class_incharge' AND active;
CREATE TABLE public.staff_setup_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
  actor_profile_id uuid REFERENCES public.profiles(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  previous jsonb, current jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_setup_audit_tenant ON public.staff_setup_audit(institution_id,created_at);
CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL, staff_id uuid NOT NULL,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id), token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, superseded_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'link_generated' CHECK(delivery_status='link_generated'),
  FOREIGN KEY(institution_id,staff_id) REFERENCES public.staff_records(institution_id,id)
);
CREATE UNIQUE INDEX staff_invitation_current ON public.staff_invitations(staff_id) WHERE accepted_at IS NULL AND superseded_at IS NULL;

CREATE FUNCTION public.setup_today(p_institution uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=p_institution),'Asia/Kolkata'))::date;
$$;
CREATE FUNCTION public.setup_is_admin(p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_institution_member(p_institution) AND (
  EXISTS(SELECT 1 FROM public.institutions WHERE id=p_institution AND owner_profile_id=public.current_profile_id())
  OR EXISTS(SELECT 1 FROM public.staff_records s JOIN public.staff_role_grants r ON r.staff_id=s.id AND r.institution_id=s.institution_id
    WHERE s.institution_id=p_institution AND s.profile_id=public.current_profile_id() AND s.status='active'
    AND r.role='institution_admin' AND r.active AND public.setup_today(p_institution)>=r.valid_from
    AND (r.valid_until IS NULL OR public.setup_today(p_institution)<=r.valid_until))
  OR (NOT EXISTS(SELECT 1 FROM public.staff_records WHERE institution_id=p_institution AND profile_id=public.current_profile_id())
    AND EXISTS(SELECT 1 FROM public.profile_roles WHERE institution_id=p_institution AND profile_id=public.current_profile_id() AND role_code='admin'))
 );
$$;
CREATE FUNCTION public.setup_actor(p_institution uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.setup_is_admin(p_institution) OR NOT public.has_current_policy_acceptance(auth.uid())
   OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'active owner/admin with verified identity and current policies required' USING ERRCODE='42501';
 END IF;
 RETURN public.current_profile_id();
END $$;
CREATE FUNCTION public.staff_has_role(p_staff uuid,p_role text,p_on date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_records s JOIN public.staff_role_grants r ON r.staff_id=s.id AND r.institution_id=s.institution_id
  JOIN public.profile_institutions m ON m.profile_id=s.profile_id AND m.institution_id=s.institution_id
  JOIN public.profiles p ON p.id=s.profile_id JOIN public.institutions i ON i.id=s.institution_id
  WHERE s.id=p_staff AND s.profile_id=public.current_profile_id() AND s.status='active' AND m.status='active'
    AND p.status='active' AND i.status='active' AND r.role=p_role AND r.active AND p_on>=r.valid_from AND (r.valid_until IS NULL OR p_on<=r.valid_until));
$$;
CREATE FUNCTION public.can_mark_assigned_subject(p_section uuid,p_subject uuid,p_term uuid,p_on date DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_responsibilities a
  JOIN public.academic_sections s ON s.id=a.section_id AND s.institution_id=a.institution_id AND s.term_id=a.term_id AND s.program_id=a.program_id
  JOIN public.academic_subjects u ON u.id=a.subject_id AND u.institution_id=a.institution_id AND u.program_id=a.program_id
  JOIN public.academic_terms t ON t.id=a.term_id AND t.institution_id=a.institution_id AND t.program_id=a.program_id
  WHERE a.section_id=p_section AND a.subject_id=p_subject AND a.term_id=p_term AND a.kind='teaching' AND a.active
    AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN a.effective_from AND a.effective_until
    AND coalesce(p_on,public.setup_today(a.institution_id)) BETWEEN t.starts_on AND t.ends_on
    AND public.staff_has_role(a.staff_id,'faculty',coalesce(p_on,public.setup_today(a.institution_id))));
$$;
CREATE FUNCTION public.can_view_setup_department(p_institution uuid,p_department uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.setup_is_admin(p_institution) OR (public.is_institution_member(p_institution) AND EXISTS(
  SELECT 1 FROM public.staff_records s WHERE s.institution_id=p_institution AND s.profile_id=public.current_profile_id() AND s.status='active'
   AND (s.primary_department_id=p_department OR EXISTS(
    SELECT 1 FROM public.staff_responsibilities a WHERE a.staff_id=s.id AND a.institution_id=p_institution AND a.department_id=p_department
      AND a.active AND public.setup_today(p_institution) BETWEEN a.effective_from AND a.effective_until))));
$$;
CREATE FUNCTION public.validate_setup_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p public.academic_programs; t public.academic_terms; s public.academic_sections; u public.academic_subjects;
BEGIN
 IF TG_TABLE_NAME='academic_sections' THEN
  SELECT * INTO t FROM public.academic_terms WHERE id=NEW.term_id AND institution_id=NEW.institution_id;
  IF t.program_id IS DISTINCT FROM NEW.program_id THEN RAISE EXCEPTION 'section term/program mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.kind IN ('department_member','hod') THEN
  IF NEW.program_id IS NOT NULL OR NEW.term_id IS NOT NULL OR NEW.section_id IS NOT NULL OR NEW.subject_id IS NOT NULL THEN
   RAISE EXCEPTION 'department responsibility has invalid scope' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO p FROM public.academic_programs WHERE id=NEW.program_id AND institution_id=NEW.institution_id;
  IF p.id IS NULL OR p.department_id IS DISTINCT FROM NEW.department_id THEN RAISE EXCEPTION 'responsibility department/program mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.term_id IS NOT NULL THEN
   SELECT * INTO t FROM public.academic_terms WHERE id=NEW.term_id AND institution_id=NEW.institution_id;
   IF t.program_id IS DISTINCT FROM NEW.program_id OR NEW.academic_year<>t.academic_year
     OR NEW.effective_from<t.starts_on OR NEW.effective_until>t.ends_on THEN RAISE EXCEPTION 'responsibility term/date mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.kind IN ('teaching','class_incharge') THEN
   SELECT * INTO s FROM public.academic_sections WHERE id=NEW.section_id AND institution_id=NEW.institution_id;
   IF s.id IS NULL OR s.program_id IS DISTINCT FROM NEW.program_id OR s.term_id IS DISTINCT FROM NEW.term_id THEN
    RAISE EXCEPTION 'responsibility section/term mismatch' USING ERRCODE='23514'; END IF;
   IF NEW.kind='teaching' THEN
    SELECT * INTO u FROM public.academic_subjects WHERE id=NEW.subject_id AND institution_id=NEW.institution_id;
    IF u.id IS NULL OR u.program_id IS DISTINCT FROM NEW.program_id THEN RAISE EXCEPTION 'teaching subject/program mismatch' USING ERRCODE='23514'; END IF;
   ELSIF NEW.subject_id IS NOT NULL THEN RAISE EXCEPTION 'class incharge is section scoped' USING ERRCODE='23514'; END IF;
  ELSIF NEW.section_id IS NOT NULL OR NEW.subject_id IS NOT NULL THEN RAISE EXCEPTION 'coordinator scope must be program/year/term' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER academic_section_scope BEFORE INSERT OR UPDATE ON public.academic_sections FOR EACH ROW EXECUTE FUNCTION public.validate_setup_scope();
CREATE TRIGGER staff_responsibility_scope BEFORE INSERT OR UPDATE ON public.staff_responsibilities FOR EACH ROW EXECUTE FUNCTION public.validate_setup_scope();

CREATE FUNCTION public.audit_setup_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE before_value jsonb; after_value jsonb; target uuid; inst uuid;
BEGIN
 before_value:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_value:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 inst:=coalesce((after_value->>'institution_id')::uuid,(before_value->>'institution_id')::uuid);
 target:=coalesce((after_value->>'id')::uuid,(before_value->>'id')::uuid,inst);
 -- Do not copy image bytes, invite hashes or authentication tokens into audit history.
 IF TG_TABLE_NAME='institution_settings' THEN before_value:=before_value-'logo_bytes';after_value:=after_value-'logo_bytes'; END IF;
 IF TG_TABLE_NAME='staff_invitations' THEN before_value:=before_value-'token_hash';after_value:=after_value-'token_hash'; END IF;
 INSERT INTO public.staff_setup_audit(institution_id,actor_profile_id,action,entity_type,entity_id,previous,current)
 VALUES(inst,public.current_profile_id(),lower(TG_OP),TG_TABLE_NAME,target,before_value,after_value);
 RETURN coalesce(NEW,OLD);
END $$;
DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['institution_settings','academic_departments','academic_programs','academic_terms','academic_sections','academic_subjects','staff_records','staff_role_grants','staff_responsibilities','staff_invitations'] LOOP
  EXECUTE format('CREATE TRIGGER setup_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_setup_change()',n);
 END LOOP;
END $$;
CREATE FUNCTION public.ensure_verified_owner_staff() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='active' AND NEW.owner_profile_id IS NOT NULL AND NEW.verification_application_id IS NOT NULL THEN
  INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,phone,designation,status,created_by)
   SELECT NEW.id,p.id,a.applicant_name,lower(p.email),a.applicant_phone,a.designation,'active',p.id
   FROM public.profiles p JOIN public.institution_verification_applications a ON a.id=NEW.verification_application_id
   WHERE p.id=NEW.owner_profile_id AND a.status='approved'
   ON CONFLICT(institution_id,profile_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verified_owner_staff AFTER INSERT OR UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.ensure_verified_owner_staff();
INSERT INTO public.staff_records(institution_id,profile_id,full_name,email,phone,designation,status,created_by)
 SELECT i.id,p.id,a.applicant_name,lower(p.email),a.applicant_phone,a.designation,'active',p.id
 FROM public.institutions i JOIN public.profiles p ON p.id=i.owner_profile_id
 JOIN public.institution_verification_applications a ON a.id=i.verification_application_id
 WHERE i.status='active' AND a.status='approved';

DO $$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['institution_settings','academic_departments','academic_programs','academic_terms','academic_sections','academic_subjects','staff_records','staff_role_grants','staff_responsibilities','staff_setup_audit','staff_invitations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',n);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['institution_settings','staff_records','staff_role_grants','staff_responsibilities','staff_setup_audit'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',n);
 END LOOP;
END $$;
CREATE POLICY setup_settings_read ON public.institution_settings FOR SELECT TO authenticated USING(public.is_institution_member(institution_id));
CREATE POLICY setup_staff_read ON public.staff_records FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id) OR (profile_id=public.current_profile_id() AND public.is_institution_member(institution_id)));
CREATE POLICY setup_role_read ON public.staff_role_grants FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id) OR EXISTS(SELECT 1 FROM public.staff_records s WHERE s.id=staff_id AND s.profile_id=public.current_profile_id() AND public.is_institution_member(s.institution_id)));
CREATE POLICY setup_assignment_read ON public.staff_responsibilities FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id) OR EXISTS(SELECT 1 FROM public.staff_records s WHERE s.id=staff_id AND s.profile_id=public.current_profile_id() AND public.is_institution_member(s.institution_id)));
CREATE POLICY setup_audit_read ON public.staff_setup_audit FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id));
CREATE POLICY setup_department_read ON public.academic_departments FOR SELECT TO authenticated USING(public.can_view_setup_department(institution_id,id));
CREATE POLICY setup_program_read ON public.academic_programs FOR SELECT TO authenticated USING(public.can_view_setup_department(institution_id,department_id));
CREATE POLICY setup_term_read ON public.academic_terms FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.academic_programs p WHERE p.id=program_id AND public.can_view_setup_department(institution_id,p.department_id)));
CREATE POLICY setup_section_read ON public.academic_sections FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.academic_programs p WHERE p.id=program_id AND public.can_view_setup_department(institution_id,p.department_id)));
CREATE POLICY setup_subject_read ON public.academic_subjects FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.academic_programs p WHERE p.id=program_id AND public.can_view_setup_department(institution_id,p.department_id)));
GRANT SELECT ON public.academic_departments,public.academic_programs,public.academic_terms,public.academic_sections,public.academic_subjects TO authenticated;
DO $$
DECLARE n text;
BEGIN
 FOR n IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public'
  AND p.proname IN ('setup_today','setup_is_admin','setup_actor','staff_has_role','can_mark_assigned_subject','can_view_setup_department','validate_setup_scope','audit_setup_change','ensure_verified_owner_staff') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||n||' FROM PUBLIC,anon,authenticated';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.setup_today(uuid),public.setup_is_admin(uuid),public.staff_has_role(uuid,text,date),public.can_mark_assigned_subject(uuid,uuid,uuid,date),public.can_view_setup_department(uuid,uuid) TO authenticated;
COMMIT;
