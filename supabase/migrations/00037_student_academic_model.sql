-- Canonical students retain their IDs. Academic placements are independent of
-- the legacy guardian/class projection; no attendance or message flow is started.
BEGIN;
ALTER TABLE public.students ALTER COLUMN parent_id DROP NOT NULL, ALTER COLUMN class_id DROP NOT NULL, ALTER COLUMN roll DROP NOT NULL;
ALTER TABLE public.students ALTER COLUMN status DROP NOT NULL;
ALTER TABLE public.students DROP CONSTRAINT students_enrollment_status_check;
ALTER TABLE public.students ADD CONSTRAINT students_enrollment_status_check CHECK(enrollment_status IN ('active','inactive','graduated','withdrawn','transferred_out','discontinued','suspended'));
CREATE FUNCTION public.student_identifier(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT nullif(lower(regexp_replace(btrim(normalize(coalesce(p,''),NFKC)),'[[:space:]]+',' ','g')),'');
$$;
DROP INDEX public.idx_students_tenant_admission;
-- Conflicting existing identifiers fail migration explicitly. Never merge or
-- renumber real students to make a uniqueness check pass.
CREATE UNIQUE INDEX idx_students_tenant_admission ON public.students(institution_id,public.student_identifier(admission_number)) WHERE public.student_identifier(admission_number) IS NOT NULL;
CREATE UNIQUE INDEX students_tenant_roll ON public.students(institution_id,public.student_identifier(roll)) WHERE public.student_identifier(roll) IS NOT NULL;
CREATE TABLE public.student_cohorts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id), program_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160), code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40),
 starts_on date NOT NULL, expected_ends_on date NOT NULL CHECK(expected_ends_on>=starts_on),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000), created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(institution_id,id), FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id)
);
CREATE UNIQUE INDEX student_cohort_code ON public.student_cohorts(institution_id,lower(code));
ALTER TABLE public.students ADD COLUMN admitted_on date, ADD COLUMN entry_type text CHECK(entry_type IN ('normal','lateral','transfer')),
 ADD COLUMN entry_term_id uuid, ADD COLUMN entry_cohort_id uuid, ADD COLUMN academic_version bigint NOT NULL DEFAULT 0,
 ADD COLUMN academic_managed boolean NOT NULL DEFAULT false,
 ADD COLUMN legacy_roster_linked boolean NOT NULL DEFAULT false,
 ADD FOREIGN KEY(institution_id,entry_term_id) REFERENCES public.academic_terms(institution_id,id),
 ADD FOREIGN KEY(institution_id,entry_cohort_id) REFERENCES public.student_cohorts(institution_id,id),
 ADD CHECK(NOT academic_managed OR (public.student_identifier(admission_number) IS NOT NULL AND admitted_on IS NOT NULL AND entry_type IS NOT NULL AND entry_term_id IS NOT NULL AND entry_cohort_id IS NOT NULL));
UPDATE public.students SET legacy_roster_linked=true WHERE class_id IS NOT NULL;
CREATE TABLE public.student_placements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL, student_id uuid NOT NULL, cohort_id uuid NOT NULL,
 department_id uuid NOT NULL, program_id uuid NOT NULL, term_id uuid NOT NULL, section_id uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on-1),
 change_type text NOT NULL CHECK(change_type IN ('entry','promotion','repeat','section_transfer','program_transfer','department_transfer','return_from_break','correction')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000), created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz, closed_by uuid REFERENCES public.profiles(id), close_reason text,
 UNIQUE(institution_id,id),
 FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id),
 FOREIGN KEY(institution_id,cohort_id) REFERENCES public.student_cohorts(institution_id,id),
 FOREIGN KEY(institution_id,department_id) REFERENCES public.academic_departments(institution_id,id),
 FOREIGN KEY(institution_id,program_id) REFERENCES public.academic_programs(institution_id,id),
 FOREIGN KEY(institution_id,term_id) REFERENCES public.academic_terms(institution_id,id),
 FOREIGN KEY(institution_id,section_id) REFERENCES public.academic_sections(institution_id,id)
);
CREATE UNIQUE INDEX student_latest_placement ON public.student_placements(student_id) WHERE closed_at IS NULL;
CREATE INDEX student_placement_history ON public.student_placements(institution_id,student_id,starts_on);
CREATE TABLE public.student_academic_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id), actor_profile_id uuid NOT NULL REFERENCES public.profiles(id),
 student_id uuid, batch_id uuid, action text NOT NULL, previous jsonb, current jsonb, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,student_id) REFERENCES public.students(institution_id,id)
);
CREATE TABLE public.student_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id), kind text NOT NULL CHECK(kind IN ('import','promotion')),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150), file_sha256 text CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 500),
 preview jsonb NOT NULL, result jsonb, revision integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed')),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(), committed_at timestamptz,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000)
);
CREATE FUNCTION public.student_academic_event(p_institution uuid,p_student uuid,p_batch uuid,p_action text,p_old jsonb,p_new jsonb,p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.student_academic_audit(institution_id,actor_profile_id,student_id,batch_id,action,previous,current,reason)
 VALUES(p_institution,public.current_profile_id(),p_student,p_batch,p_action,p_old,p_new,p_reason);
$$;
CREATE FUNCTION public.student_scope_allowed(p_institution uuid,p_section uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_institution_member(p_institution) AND public.has_current_policy_acceptance(auth.uid()) AND EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL)
 AND (public.setup_is_admin(p_institution) OR EXISTS(SELECT 1 FROM public.academic_sections s JOIN public.academic_programs p ON p.id=s.program_id AND p.institution_id=s.institution_id
 WHERE s.id=p_section AND s.institution_id=p_institution AND (
 public.can_manage_assigned_section(s.id) OR public.can_oversee_department(p.department_id)
 OR EXISTS(SELECT 1 FROM public.staff_responsibilities a JOIN public.academic_terms t ON t.id=s.term_id AND t.institution_id=s.institution_id
  WHERE a.institution_id=s.institution_id AND a.kind='coordinator' AND a.program_id=s.program_id AND a.active
   AND (a.term_id IS NULL OR a.term_id=s.term_id) AND (a.academic_year='' OR a.academic_year=t.academic_year)
   AND public.setup_today(s.institution_id) BETWEEN a.effective_from AND least(a.effective_until,coalesce(a.ended_on,a.effective_until))
   AND public.staff_has_role(a.staff_id,'coordinator',public.setup_today(s.institution_id)))
 OR (NOT p_write AND EXISTS(SELECT 1 FROM public.staff_responsibilities a WHERE a.section_id=s.id AND a.kind='teaching' AND public.can_mark_assigned_subject(s.id,a.subject_id,s.term_id))))));
$$;
CREATE FUNCTION public.student_academic_actor(p_institution uuid,p_section uuid DEFAULT NULL,p_admin boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.student_scope_allowed(p_institution,p_section,true) OR (p_admin AND NOT public.setup_is_admin(p_institution)) THEN
  RAISE EXCEPTION 'current institution administrator or matching academic responsibility required' USING ERRCODE='42501'; END IF;
 RETURN public.current_profile_id();
END $$;
CREATE FUNCTION public.can_read_academic_student(p_student uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.students s WHERE s.id=p_student AND public.is_institution_member(s.institution_id) AND public.has_current_policy_acceptance(auth.uid())
 AND (public.setup_is_admin(s.institution_id) OR EXISTS(SELECT 1 FROM public.student_placements p WHERE p.student_id=s.id AND public.setup_today(s.institution_id) BETWEEN p.starts_on AND p.ends_on AND public.student_scope_allowed(s.institution_id,p.section_id))));
$$;
CREATE FUNCTION public.validate_student_placement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE term public.academic_terms;
BEGIN
 PERFORM public.lock_staff_lifecycle(NEW.institution_id);
 SELECT * INTO term FROM public.academic_terms WHERE id=NEW.term_id AND institution_id=NEW.institution_id;
 IF NOT EXISTS(SELECT 1 FROM public.academic_programs WHERE id=NEW.program_id AND institution_id=NEW.institution_id AND department_id=NEW.department_id)
 OR term.program_id IS DISTINCT FROM NEW.program_id OR NEW.starts_on<term.starts_on OR NEW.ends_on>term.ends_on
 OR NOT EXISTS(SELECT 1 FROM public.academic_sections WHERE id=NEW.section_id AND institution_id=NEW.institution_id AND program_id=NEW.program_id AND term_id=NEW.term_id)
 OR NOT EXISTS(SELECT 1 FROM public.student_cohorts WHERE id=NEW.cohort_id AND institution_id=NEW.institution_id AND program_id=NEW.program_id) THEN
  RAISE EXCEPTION 'student placement department/program/term/section/cohort mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['ends_on','closed_at','closed_by','close_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['ends_on','closed_at','closed_by','close_reason'])
 OR NEW.ends_on>OLD.ends_on OR (OLD.closed_at IS NOT NULL AND (NEW.ends_on>=OLD.ends_on OR NEW.closed_at IS DISTINCT FROM OLD.closed_at))) THEN RAISE EXCEPTION 'historical placement is immutable; append a transition' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.student_placements p WHERE p.student_id=NEW.student_id AND p.id<>NEW.id
 AND daterange(p.starts_on,p.ends_on+1,'[)') && daterange(NEW.starts_on,NEW.ends_on+1,'[)')) THEN
  RAISE EXCEPTION 'overlapping student placements' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_placement_integrity BEFORE INSERT OR UPDATE ON public.student_placements FOR EACH ROW EXECUTE FUNCTION public.validate_student_placement();
-- Direct legacy writes cannot bypass preview, identity checks, history or audit.
CREATE POLICY student_academic_rpc_writes ON public.students AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY student_academic_no_delete ON public.students AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
CREATE FUNCTION public.guard_student_academic_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 -- SECURITY DEFINER academic/attendance RPCs run as their database owner.
 -- Direct legacy metric writes retain their existing class-scoped policy.
 IF current_user='authenticated' AND (
  NEW.academic_managed IS DISTINCT FROM OLD.academic_managed OR NEW.admitted_on IS DISTINCT FROM OLD.admitted_on
  OR NEW.entry_type IS DISTINCT FROM OLD.entry_type OR NEW.entry_term_id IS DISTINCT FROM OLD.entry_term_id OR NEW.entry_cohort_id IS DISTINCT FROM OLD.entry_cohort_id
  OR NEW.academic_version IS DISTINCT FROM OLD.academic_version
  OR NEW.legacy_roster_linked IS DISTINCT FROM OLD.legacy_roster_linked
  OR (OLD.academic_managed AND (to_jsonb(NEW)-ARRAY['status','attendance_rate','consecutive_absences','risk','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attendance_rate','consecutive_absences','risk','updated_at']))) THEN
  RAISE EXCEPTION 'academic identity and placement changes require audited RPCs' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER student_academic_columns BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.guard_student_academic_columns();
DO $$ DECLARE t text; f text;
BEGIN
 FOREACH t IN ARRAY ARRAY['student_cohorts','student_placements','student_academic_audit','student_import_batches'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('GRANT ALL ON public.%I TO service_role',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('student_academic_event','student_scope_allowed','student_academic_actor','can_read_academic_student','validate_student_placement') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.student_scope_allowed(uuid,uuid,boolean),public.can_read_academic_student(uuid) TO authenticated;
CREATE POLICY student_cohort_read ON public.student_cohorts FOR SELECT TO authenticated USING(public.is_institution_member(institution_id) AND public.has_current_policy_acceptance(auth.uid()) AND (public.setup_is_admin(institution_id) OR EXISTS(SELECT 1 FROM public.academic_sections s WHERE s.program_id=student_cohorts.program_id AND public.student_scope_allowed(institution_id,s.id))));
CREATE POLICY student_placement_read ON public.student_placements FOR SELECT TO authenticated USING(public.can_read_academic_student(student_id));
CREATE POLICY student_academic_audit_read ON public.student_academic_audit FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id) AND public.has_current_policy_acceptance(auth.uid()));
CREATE POLICY student_import_read ON public.student_import_batches FOR SELECT TO authenticated USING(created_by=public.current_profile_id() AND public.is_institution_member(institution_id) AND public.has_current_policy_acceptance(auth.uid()) AND (kind='promotion' OR public.setup_is_admin(institution_id)));
COMMIT;
