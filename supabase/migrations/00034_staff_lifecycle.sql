-- Phase 2B extends the Phase 2A model; no history rows are deleted.
BEGIN;
ALTER TABLE public.staff_records DROP CONSTRAINT staff_records_status_check;
ALTER TABLE public.staff_records ADD CONSTRAINT staff_records_status_check
 CHECK(status IN ('draft','invited','active','on_leave','inactive','left_institution'));
ALTER TABLE public.staff_records ADD COLUMN lifecycle_reason text, ADD COLUMN lifecycle_actor uuid REFERENCES public.profiles(id),
 ADD COLUMN lifecycle_at timestamptz;
ALTER TABLE public.institution_settings ADD COLUMN single_hod boolean NOT NULL DEFAULT false;
ALTER TABLE public.staff_role_grants ADD COLUMN ended_on date, ADD COLUMN end_reason text;
ALTER TABLE public.staff_responsibilities ADD COLUMN ended_on date, ADD COLUMN end_reason text,
 ADD COLUMN handover_from_id uuid REFERENCES public.staff_responsibilities(id),
 ADD COLUMN substitution_for_id uuid REFERENCES public.staff_responsibilities(id);
ALTER TABLE public.class_faculty ADD COLUMN closed_at timestamptz, ADD COLUMN closure_reason text, ADD COLUMN closed_by uuid REFERENCES public.profiles(id);
-- Preserve the actual recorded closure boundary for older Phase 2A rows.
-- Unknown contractual dates are never fabricated or replaced.
UPDATE public.staff_responsibilities a SET ended_on=least(a.effective_until,greatest(a.effective_from-1,
 (a.closed_at AT TIME ZONE coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=a.institution_id),'Asia/Kolkata'))::date-1)),end_reason=a.reason
 WHERE NOT a.active AND a.closed_at IS NOT NULL;
UPDATE public.staff_role_grants g SET ended_on=least(coalesce(g.valid_until,'infinity'::date),greatest(g.valid_from-1,
 (g.closed_at AT TIME ZONE coalesce((SELECT timezone FROM public.institution_settings WHERE institution_id=g.institution_id),'Asia/Kolkata'))::date-1)),end_reason=g.reason
 WHERE NOT g.active AND g.closed_at IS NOT NULL;
-- Original contractual dates/reasons remain immutable. ended_on is the actual
-- inclusive cutoff, including a day before the start for cancelled future work.
ALTER TABLE public.staff_role_grants ADD CHECK(ended_on IS NULL OR ended_on>=valid_from-1);
ALTER TABLE public.staff_responsibilities ADD CHECK(ended_on IS NULL OR ended_on>=effective_from-1);
DROP INDEX public.staff_class_incharge_current;
CREATE TABLE public.staff_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL REFERENCES public.institutions(id),
 actor_profile_id uuid NOT NULL REFERENCES public.profiles(id), target_staff_id uuid REFERENCES public.staff_records(id),
 action text NOT NULL, previous jsonb, current jsonb, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.staff_leave_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), institution_id uuid NOT NULL, staff_id uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL CHECK(ends_on>=starts_on),
 reason text NOT NULL, created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 returned_at timestamptz, FOREIGN KEY(institution_id,staff_id) REFERENCES public.staff_records(institution_id,id)
);
CREATE TABLE public.institution_succession_settings (
 institution_id uuid PRIMARY KEY REFERENCES public.institutions(id), nominee_staff_id uuid,
 reason text NOT NULL, updated_by uuid NOT NULL REFERENCES public.profiles(id), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(institution_id,nominee_staff_id) REFERENCES public.staff_records(institution_id,id)
);
-- Serializes operations across staff records and prevents concurrent exclusive
-- responsibility claims, including under repeatable-read isolation.
CREATE TABLE public.staff_lifecycle_mutex(institution_id uuid PRIMARY KEY REFERENCES public.institutions(id), revision bigint NOT NULL DEFAULT 0);
CREATE FUNCTION public.lock_staff_lifecycle(p_institution uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_institution IS NULL THEN RAISE EXCEPTION 'institution unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.staff_lifecycle_mutex(institution_id) VALUES(p_institution) ON CONFLICT DO NOTHING;
 UPDATE public.staff_lifecycle_mutex SET revision=revision+1 WHERE institution_id=p_institution;
END $$;
CREATE FUNCTION public.lifecycle_event(p_institution uuid,p_target uuid,p_action text,p_previous jsonb,p_current jsonb,p_reason text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO public.staff_lifecycle_events(institution_id,actor_profile_id,target_staff_id,action,previous,current,reason)
 VALUES(p_institution,public.current_profile_id(),p_target,p_action,p_previous,p_current,p_reason);
$$;
CREATE FUNCTION public.lifecycle_owner(p_institution uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=public.setup_actor(p_institution);
 IF NOT EXISTS(SELECT 1 FROM public.institutions WHERE id=p_institution AND owner_profile_id=actor) THEN
  RAISE EXCEPTION 'current institution owner required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION public.lifecycle_current_policies(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_user IS NOT NULL AND (SELECT count(*) FROM public.policy_versions WHERE active AND effective_at<=now() AND policy_type IN ('terms','privacy'))=2
 AND NOT EXISTS(SELECT 1 FROM public.policy_versions v WHERE active AND effective_at<=now()
 AND NOT EXISTS(SELECT 1 FROM public.user_policy_acceptances a WHERE a.user_id=p_user AND a.policy_version_id=v.id));
$$;
CREATE FUNCTION public.lifecycle_eligible_staff(p_staff uuid,p_institution uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.staff_records s JOIN public.profiles p ON p.id=s.profile_id
 JOIN auth.users u ON u.id=p.auth_user_id JOIN public.profile_institutions m ON m.profile_id=p.id AND m.institution_id=s.institution_id
 JOIN public.institutions i ON i.id=s.institution_id
 WHERE s.id=p_staff AND s.institution_id=p_institution AND s.status='active' AND p.status='active' AND p.student_id IS NULL
 AND m.status='active' AND i.status='active' AND u.email_confirmed_at IS NOT NULL AND lower(u.email)=s.email
 AND public.lifecycle_current_policies(u.id));
$$;
-- A stale active membership can never authorize an ended/leave staff record.
CREATE OR REPLACE FUNCTION public.is_institution_member(target_institution_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profile_institutions m JOIN public.profiles p ON p.id=m.profile_id
 JOIN public.institutions i ON i.id=m.institution_id WHERE m.profile_id=public.current_profile_id() AND m.institution_id=target_institution_id
 AND m.status='active' AND p.status='active' AND i.status='active'
 AND NOT EXISTS(SELECT 1 FROM public.staff_records s WHERE s.profile_id=p.id AND s.institution_id=i.id AND s.status<>'active'));
$$;
CREATE FUNCTION public.guard_lifecycle_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.lock_staff_lifecycle(NEW.institution_id);
 IF EXISTS(SELECT 1 FROM public.staff_records WHERE id=NEW.staff_id AND status IN ('on_leave','inactive','left_institution'))
  AND (TG_OP='INSERT' OR (NEW.active AND NOT OLD.active)) THEN
  RAISE EXCEPTION 'reactivate staff explicitly before assigning duties' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['active','closed_at','ended_on','end_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','closed_at','ended_on','end_reason'])
  OR (NOT OLD.active AND NEW.active)
  OR (OLD.ended_on IS NOT NULL AND (NEW.ended_on IS NULL OR NEW.ended_on>OLD.ended_on))) THEN
  RAISE EXCEPTION 'append responsibility transitions; historical scope/dates are immutable' USING ERRCODE='42501'; END IF;
 IF (NEW.kind='class_incharge' OR (NEW.kind='hod' AND EXISTS(SELECT 1 FROM public.institution_settings WHERE institution_id=NEW.institution_id AND single_hod))) AND EXISTS(
  SELECT 1 FROM public.staff_responsibilities a WHERE a.id<>NEW.id AND a.institution_id=NEW.institution_id AND a.kind=NEW.kind
  AND CASE WHEN NEW.kind='hod' THEN a.department_id=NEW.department_id ELSE a.section_id=NEW.section_id END
  AND daterange(a.effective_from,least(a.effective_until,coalesce(a.ended_on,a.effective_until)),'[]') &&
   daterange(NEW.effective_from,least(NEW.effective_until,coalesce(NEW.ended_on,NEW.effective_until)),'[]')) THEN
  RAISE EXCEPTION 'overlapping exclusive responsibility' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_assignment_guard BEFORE INSERT OR UPDATE ON public.staff_responsibilities FOR EACH ROW EXECUTE FUNCTION public.guard_lifecycle_assignment();
CREATE FUNCTION public.guard_lifecycle_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.lock_staff_lifecycle(NEW.institution_id);
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['active','closed_at','ended_on','end_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['active','closed_at','ended_on','end_reason'])
  OR (NOT OLD.active AND NEW.active)
  OR (OLD.ended_on IS NOT NULL AND NEW.ended_on IS DISTINCT FROM OLD.ended_on)) THEN
  RAISE EXCEPTION 'append role grants; historical values are immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lifecycle_role_guard BEFORE INSERT OR UPDATE ON public.staff_role_grants FOR EACH ROW EXECUTE FUNCTION public.guard_lifecycle_role();
CREATE OR REPLACE FUNCTION public.set_staff_roles(p_staff uuid,p_roles text[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid; r text; old_roles jsonb; day date;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff;
 PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);day:=public.setup_today(s.institution_id);
 IF s.status NOT IN ('draft','invited','active') THEN RAISE EXCEPTION 'reactivate staff explicitly before changing roles' USING ERRCODE='42501'; END IF;
 IF p_roles IS NULL OR cardinality(p_roles) NOT BETWEEN 1 AND 6 OR array_position(p_roles,NULL) IS NOT NULL
 OR NOT p_roles <@ ARRAY['institution_admin','faculty','class_incharge','hod','coordinator','staff']::text[]
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'valid roles and specific reason required' USING ERRCODE='22023'; END IF;
 IF ('institution_admin'=ANY(p_roles)) IS DISTINCT FROM EXISTS(SELECT 1 FROM public.staff_role_grants WHERE staff_id=s.id AND role='institution_admin' AND active AND (valid_until IS NULL OR valid_until>=day)) THEN
  PERFORM public.lifecycle_owner(s.institution_id);
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') INTO old_roles FROM public.staff_role_grants g WHERE staff_id=s.id AND active;
 UPDATE public.staff_role_grants SET active=false,closed_at=now(),ended_on=coalesce(ended_on,greatest(valid_from-1,day-1)),end_reason=p_reason
 WHERE staff_id=s.id AND active AND (NOT role=ANY(p_roles) OR valid_until<day OR ended_on<day);
 FOREACH r IN ARRAY p_roles LOOP
  INSERT INTO public.staff_role_grants(institution_id,staff_id,role,valid_from,created_by,reason)
  VALUES(s.institution_id,s.id,r,day,actor,p_reason) ON CONFLICT(staff_id,role) WHERE active DO NOTHING;
 END LOOP;
 PERFORM public.lifecycle_event(s.institution_id,s.id,'roles.changed',old_roles,jsonb_build_object('roles',p_roles),p_reason);
END $$;
CREATE FUNCTION public.end_staff_assignment(p_id uuid,p_last_day date,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.staff_responsibilities;
BEGIN
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id;
 PERFORM public.lock_staff_lifecycle(a.institution_id);
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id FOR UPDATE;
 PERFORM public.setup_actor(a.institution_id);
 IF NOT a.active OR (a.ended_on IS NOT NULL AND p_last_day>=a.ended_on) OR p_last_day IS NULL OR p_last_day<greatest(a.effective_from-1,public.setup_today(a.institution_id)-1)
 OR p_last_day>a.effective_until OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION 'valid current/future cutoff and specific closure reason required' USING ERRCODE='22023'; END IF;
 UPDATE public.staff_responsibilities SET ended_on=p_last_day,active=p_last_day>=public.setup_today(a.institution_id),
  closed_at=CASE WHEN p_last_day<public.setup_today(a.institution_id) THEN now() END,end_reason=p_reason WHERE id=p_id;
 PERFORM public.lifecycle_event(a.institution_id,a.staff_id,'responsibility.closed',to_jsonb(a),jsonb_build_object('ended_on',p_last_day),p_reason);
END $$;
CREATE OR REPLACE FUNCTION public.close_staff_responsibility(p_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.staff_responsibilities;
BEGIN
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id;
 PERFORM public.end_staff_assignment(p_id,greatest(a.effective_from-1,public.setup_today(a.institution_id)-1),p_reason);
END $$;
CREATE FUNCTION public.handover_staff_responsibility(p_id uuid,p_successor uuid,p_starts date,p_reason text,p_substitute_until date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.staff_responsibilities; result uuid; actor uuid; role_value text; last_day date;
BEGIN
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id;
 PERFORM public.lock_staff_lifecycle(a.institution_id);
 SELECT * INTO a FROM public.staff_responsibilities WHERE id=p_id FOR UPDATE;
 actor:=public.setup_actor(a.institution_id);
 IF NOT public.lifecycle_eligible_staff(p_successor,a.institution_id) OR p_successor=a.staff_id OR p_starts IS NULL
 OR p_starts<greatest(a.effective_from,public.setup_today(a.institution_id)) OR p_starts>least(a.effective_until,coalesce(a.ended_on,a.effective_until))
 OR (p_substitute_until IS NOT NULL AND (p_substitute_until<p_starts OR p_substitute_until>=least(a.effective_until,coalesce(a.ended_on,a.effective_until)))) THEN
  RAISE EXCEPTION 'verified active same-institution successor and valid transition dates required' USING ERRCODE='42501'; END IF;
 role_value:=CASE a.kind WHEN 'teaching' THEN 'faculty' WHEN 'department_member' THEN 'staff' ELSE a.kind END;
 IF a.kind<>'department_member' AND NOT EXISTS(SELECT 1 FROM public.staff_role_grants WHERE staff_id=p_successor AND role=role_value AND active
  AND valid_from<=p_starts AND least(coalesce(ended_on,'infinity'::date),coalesce(valid_until,'infinity'::date))>=coalesce(p_substitute_until,a.effective_until)) THEN
  RAISE EXCEPTION 'successor role must cover the handover dates' USING ERRCODE='42501'; END IF;
 last_day:=least(a.effective_until,coalesce(a.ended_on,a.effective_until));
 PERFORM public.end_staff_assignment(a.id,p_starts-1,p_reason);
 INSERT INTO public.staff_responsibilities(institution_id,staff_id,kind,department_id,program_id,term_id,section_id,subject_id,academic_year,
 effective_from,effective_until,created_by,reason,handover_from_id,substitution_for_id)
 VALUES(a.institution_id,p_successor,a.kind,a.department_id,a.program_id,a.term_id,a.section_id,a.subject_id,a.academic_year,
 p_starts,coalesce(p_substitute_until,last_day),actor,p_reason,a.id,CASE WHEN p_substitute_until IS NOT NULL THEN a.id END) RETURNING id INTO result;
 IF p_substitute_until IS NOT NULL THEN
  INSERT INTO public.staff_responsibilities(institution_id,staff_id,kind,department_id,program_id,term_id,section_id,subject_id,academic_year,
   effective_from,effective_until,created_by,reason,handover_from_id)
  VALUES(a.institution_id,a.staff_id,a.kind,a.department_id,a.program_id,a.term_id,a.section_id,a.subject_id,a.academic_year,
   p_substitute_until+1,last_day,actor,p_reason,a.id);
 END IF;
 PERFORM public.lifecycle_event(a.institution_id,a.staff_id,CASE WHEN p_substitute_until IS NULL THEN 'responsibility.transferred' ELSE 'responsibility.substituted' END,
  to_jsonb(a),jsonb_build_object('successor',p_successor,'new_assignment',result,'starts_on',p_starts,'substitute_until',p_substitute_until),p_reason);
 RETURN result;
END $$;
CREATE FUNCTION public.change_staff_lifecycle(p_staff uuid,p_status text,p_reason text,p_decisions jsonb,p_close_roles boolean,p_leave_until date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid; a public.staff_responsibilities; choice jsonb; day date; legacy record;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff;
 PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);day:=public.setup_today(s.institution_id);
 IF p_status IS NULL OR p_status NOT IN ('on_leave','inactive','left_institution') OR s.status NOT IN ('active','draft','invited','on_leave','inactive') OR s.status=p_status
 OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 OR p_close_roles IS DISTINCT FROM true
 OR jsonb_typeof(p_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_decisions)>500 THEN
  RAISE EXCEPTION 'explicit lifecycle state, role closure and specific reason required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.institutions WHERE id=s.institution_id AND owner_profile_id=s.profile_id) THEN
  RAISE EXCEPTION 'owner must transfer ownership first or complete reviewed emergency recovery' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_role_grants WHERE staff_id=s.id AND role='institution_admin' AND active) THEN PERFORM public.lifecycle_owner(s.institution_id); END IF;
 IF p_status='on_leave' AND (s.status<>'active' OR p_leave_until IS NULL OR p_leave_until<day OR p_leave_until>day+730) THEN
  RAISE EXCEPTION 'active staff and bounded leave dates required' USING ERRCODE='22023'; END IF;
 FOR legacy IN SELECT cf.id FROM public.class_faculty cf JOIN public.faculty f ON f.id=cf.faculty_id AND f.institution_id=cf.institution_id
  WHERE f.user_id=s.profile_id AND f.institution_id=s.institution_id AND s.legacy_class_assignments AND cf.closed_at IS NULL LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) x WHERE x->>'id'=legacy.id::text AND x->>'action'='close') THEN
   RAISE EXCEPTION 'legacy whole-class mapping requires explicit closure; no subject or term may be inferred' USING ERRCODE='42501'; END IF;
  UPDATE public.class_faculty SET closed_at=now(),closure_reason=p_reason,closed_by=actor WHERE id=legacy.id;
 END LOOP;
 FOR a IN SELECT * FROM public.staff_responsibilities WHERE staff_id=s.id AND active AND coalesce(ended_on,effective_until)>=day FOR UPDATE LOOP
  SELECT x INTO choice FROM jsonb_array_elements(p_decisions) x WHERE x->>'id'=a.id::text;
  IF choice IS NULL OR choice->>'action' NOT IN ('close','transfer','substitute') THEN
   RAISE EXCEPTION 'every active or future responsibility requires reassignment or explicit closure' USING ERRCODE='42501'; END IF;
  IF choice->>'action'='close' THEN
   PERFORM public.end_staff_assignment(a.id,greatest(day-1,a.effective_from-1),p_reason);
  ELSE
   IF choice->>'action'='substitute' AND p_status<>'on_leave' THEN RAISE EXCEPTION 'substitution requires temporary leave' USING ERRCODE='22023'; END IF;
   PERFORM public.handover_staff_responsibility(a.id,(choice->>'to_staff')::uuid,greatest(day,a.effective_from),p_reason,
    CASE WHEN choice->>'action'='substitute' THEN p_leave_until END);
  END IF;
 END LOOP;
 UPDATE public.staff_responsibilities SET active=false,closed_at=now(),end_reason=p_reason,ended_on=coalesce(ended_on,effective_until)
 WHERE staff_id=s.id AND active AND coalesce(ended_on,effective_until)<day;
 UPDATE public.staff_role_grants SET active=false,closed_at=now(),ended_on=coalesce(ended_on,greatest(valid_from-1,day-1)),end_reason=p_reason WHERE staff_id=s.id AND active;
 UPDATE public.staff_invitations SET superseded_at=now() WHERE staff_id=s.id AND accepted_at IS NULL AND superseded_at IS NULL;
 UPDATE public.profile_institutions SET status='inactive',revoked_at=now() WHERE profile_id=s.profile_id AND institution_id=s.institution_id;
 UPDATE public.staff_records SET status=p_status,legacy_class_assignments=false,lifecycle_reason=p_reason,lifecycle_actor=actor,lifecycle_at=now(),updated_at=now() WHERE id=s.id;
 IF p_status='on_leave' THEN INSERT INTO public.staff_leave_periods(institution_id,staff_id,starts_on,ends_on,reason,created_by)
  VALUES(s.institution_id,s.id,day,p_leave_until,p_reason,actor); END IF;
 PERFORM public.lifecycle_event(s.institution_id,s.id,'staff.'||p_status,to_jsonb(s),jsonb_build_object('status',p_status,'decisions',p_decisions,'leave_until',p_leave_until),p_reason);
END $$;
CREATE FUNCTION public.reactivate_staff(p_staff uuid,p_roles text[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.staff_records; actor uuid;
BEGIN
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff;
 PERFORM public.lock_staff_lifecycle(s.institution_id);
 SELECT * INTO s FROM public.staff_records WHERE id=p_staff FOR UPDATE;
 actor:=public.setup_actor(s.institution_id);
 IF s.status NOT IN ('on_leave','inactive','left_institution') OR s.profile_id IS NULL OR length(btrim(coalesce(p_reason,'')))<10
 OR NOT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.auth_user_id WHERE p.id=s.profile_id AND p.status='active'
  AND u.email_confirmed_at IS NOT NULL AND lower(u.email)=s.email AND public.lifecycle_current_policies(u.id)) THEN
  RAISE EXCEPTION 'explicit reactivation requires verified original identity and current policies' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_leave_periods WHERE staff_id=s.id AND returned_at IS NULL AND ends_on>=public.setup_today(s.institution_id)) THEN
  RAISE EXCEPTION 'leave is still in progress; reactivation is available after its recorded end' USING ERRCODE='42501'; END IF;
 UPDATE public.staff_records SET status='active',lifecycle_reason=p_reason,lifecycle_actor=actor,lifecycle_at=now(),updated_at=now() WHERE id=s.id;
 UPDATE public.profile_institutions SET status='active',revoked_at=NULL,activated_at=now() WHERE profile_id=s.profile_id AND institution_id=s.institution_id;
 PERFORM public.set_staff_roles(s.id,p_roles,p_reason);
 UPDATE public.staff_leave_periods SET returned_at=now() WHERE staff_id=s.id AND returned_at IS NULL;
 PERFORM public.lifecycle_event(s.institution_id,s.id,'staff.reactivated',to_jsonb(s),jsonb_build_object('roles',p_roles),p_reason);
END $$;
CREATE FUNCTION public.apply_owner_succession(p_institution uuid,p_successor uuid,p_expected_owner uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.institutions; s public.staff_records;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 SELECT * INTO i FROM public.institutions WHERE id=p_institution FOR UPDATE;
 SELECT * INTO s FROM public.staff_records WHERE id=p_successor FOR UPDATE;
 IF i.owner_profile_id IS DISTINCT FROM p_expected_owner OR s.profile_id IS NOT DISTINCT FROM i.owner_profile_id
 OR NOT public.lifecycle_eligible_staff(p_successor,p_institution) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 2000 THEN
  RAISE EXCEPTION 'owner changed or successor is not a verified active staff member' USING ERRCODE='42501'; END IF;
 UPDATE public.institutions SET owner_profile_id=s.profile_id WHERE id=i.id;
 -- Legacy ownership-derived permissions must not survive a transfer.
 DELETE FROM public.profile_roles WHERE institution_id=i.id AND profile_id=i.owner_profile_id AND role_code='admin';
 DELETE FROM public.institution_succession_settings WHERE institution_id=i.id;
 PERFORM public.lifecycle_event(i.id,s.id,'ownership.transferred',jsonb_build_object('owner_profile_id',i.owner_profile_id),jsonb_build_object('owner_profile_id',s.profile_id),p_reason);
END $$;
CREATE FUNCTION public.transfer_institution_ownership(p_institution uuid,p_successor uuid,p_expected_owner uuid,p_confirmation text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE email_value text;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);
 PERFORM public.lifecycle_owner(p_institution);
 SELECT email INTO email_value FROM public.staff_records WHERE id=p_successor AND institution_id=p_institution;
 IF p_confirmation IS DISTINCT FROM 'TRANSFER '||email_value OR email_value IS NULL THEN
  RAISE EXCEPTION 'type TRANSFER followed by the exact successor email to confirm' USING ERRCODE='22023'; END IF;
 PERFORM public.apply_owner_succession(p_institution,p_successor,p_expected_owner,p_reason);
END $$;
CREATE FUNCTION public.save_owner_succession(p_institution uuid,p_nominee uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);actor:=public.lifecycle_owner(p_institution);
 IF p_nominee IS NOT NULL AND (NOT public.lifecycle_eligible_staff(p_nominee,p_institution) OR EXISTS(SELECT 1 FROM public.staff_records WHERE id=p_nominee AND profile_id=actor)) THEN RAISE EXCEPTION 'verified active successor nominee required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.institution_succession_settings(institution_id,nominee_staff_id,reason,updated_by) VALUES(p_institution,p_nominee,p_reason,actor)
 ON CONFLICT(institution_id) DO UPDATE SET nominee_staff_id=EXCLUDED.nominee_staff_id,reason=EXCLUDED.reason,updated_by=actor,updated_at=now();
 PERFORM public.lifecycle_event(p_institution,p_nominee,'succession.settings_changed',NULL,jsonb_build_object('nominee',p_nominee),p_reason);
END $$;
CREATE FUNCTION public.rollover_staff_term(p_institution uuid,p_term uuid,p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.staff_responsibilities; n integer:=0; day date;
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);PERFORM public.setup_actor(p_institution);day:=public.setup_today(p_institution);
 IF NOT EXISTS(SELECT 1 FROM public.academic_terms WHERE id=p_term AND institution_id=p_institution AND ends_on<day) THEN
  RAISE EXCEPTION 'only a completed institution term may be rolled over' USING ERRCODE='42501'; END IF;
 FOR a IN SELECT * FROM public.staff_responsibilities WHERE institution_id=p_institution AND term_id=p_term AND active LOOP
  UPDATE public.staff_responsibilities SET active=false,closed_at=now(),ended_on=coalesce(ended_on,effective_until),end_reason=p_reason WHERE id=a.id;n:=n+1;
 END LOOP;
 PERFORM public.lifecycle_event(p_institution,NULL,'term.rolled_over',jsonb_build_object('term_id',p_term),jsonb_build_object('assignments_closed',n),p_reason);
 RETURN n;
END $$;
CREATE FUNCTION public.staff_responsibility_history(p_institution uuid,p_on date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.setup_actor(p_institution);
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('staff_name',s.full_name)),'[]') FROM public.staff_responsibilities a
  JOIN public.staff_records s ON s.id=a.staff_id WHERE a.institution_id=p_institution AND p_on BETWEEN a.effective_from AND least(a.effective_until,coalesce(a.ended_on,a.effective_until)));
END $$;
CREATE FUNCTION public.staff_lifecycle_overview(p_institution uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.setup_actor(p_institution);
 RETURN jsonb_build_object('candidates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'profile_id',s.profile_id,'name',s.full_name,'email',s.email,'designation',s.designation)),'[]')
 FROM public.staff_records s WHERE public.lifecycle_eligible_staff(s.id,p_institution)),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC),'[]') FROM (SELECT * FROM public.staff_lifecycle_events WHERE institution_id=p_institution ORDER BY created_at DESC,id LIMIT 100) e),
 'succession',(SELECT to_jsonb(s) FROM public.institution_succession_settings s WHERE institution_id=p_institution),
 'single_hod',coalesce((SELECT single_hod FROM public.institution_settings WHERE institution_id=p_institution),false),
 'legacy_duties',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',cf.id,'staff_id',s.id,'class_name',c.full_name)),'[]')
 FROM public.staff_records s JOIN public.faculty f ON f.user_id=s.profile_id AND f.institution_id=s.institution_id
 JOIN public.class_faculty cf ON cf.faculty_id=f.id AND cf.institution_id=f.institution_id JOIN public.classes c ON c.id=cf.class_id
 WHERE s.institution_id=p_institution AND s.legacy_class_assignments AND cf.closed_at IS NULL));
END $$;
CREATE FUNCTION public.set_staff_responsibility_rules(p_institution uuid,p_single_hod boolean,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.lock_staff_lifecycle(p_institution);PERFORM public.lifecycle_owner(p_institution);
 IF p_single_hod IS NULL THEN RAISE EXCEPTION 'explicit HOD rule required' USING ERRCODE='22023'; END IF;
 IF p_single_hod AND EXISTS(SELECT 1 FROM public.staff_responsibilities a JOIN public.staff_responsibilities b
 ON a.id<b.id AND a.institution_id=b.institution_id AND a.department_id=b.department_id AND a.kind='hod' AND b.kind='hod' AND a.active AND b.active
 WHERE a.institution_id=p_institution AND daterange(a.effective_from,least(a.effective_until,coalesce(a.ended_on,a.effective_until)),'[]') && daterange(b.effective_from,least(b.effective_until,coalesce(b.ended_on,b.effective_until)),'[]')) THEN
  RAISE EXCEPTION 'resolve overlapping HOD duties before enabling single HOD' USING ERRCODE='23505'; END IF;
 INSERT INTO public.institution_settings(institution_id,single_hod) VALUES(p_institution,p_single_hod)
 ON CONFLICT(institution_id) DO UPDATE SET single_hod=EXCLUDED.single_hod;
 PERFORM public.lifecycle_event(p_institution,NULL,'responsibility.rules_changed',NULL,jsonb_build_object('single_hod',p_single_hod),p_reason);
END $$;
DO $$
DECLARE t text; f text;
BEGIN
 FOREACH t IN ARRAY ARRAY['staff_lifecycle_events','staff_leave_periods','institution_succession_settings','staff_lifecycle_mutex'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['staff_lifecycle_events','staff_leave_periods','institution_succession_settings'] LOOP
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('CREATE POLICY lifecycle_read ON public.%I FOR SELECT TO authenticated USING(public.setup_is_admin(institution_id) AND public.has_current_policy_acceptance(auth.uid()))',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('lock_staff_lifecycle','lifecycle_event','lifecycle_owner','lifecycle_current_policies','lifecycle_eligible_staff','guard_lifecycle_assignment','guard_lifecycle_role','apply_owner_succession',
  'end_staff_assignment','handover_staff_responsibility','change_staff_lifecycle','reactivate_staff','transfer_institution_ownership','save_owner_succession','rollover_staff_term','staff_responsibility_history','staff_lifecycle_overview','set_staff_responsibility_rules') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC,anon,authenticated';
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('end_staff_assignment','handover_staff_responsibility','change_staff_lifecycle','reactivate_staff','transfer_institution_ownership','save_owner_succession','rollover_staff_term','staff_responsibility_history','staff_lifecycle_overview','set_staff_responsibility_rules') LOOP
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated';
 END LOOP;
END $$;
COMMIT;
